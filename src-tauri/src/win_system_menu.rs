// Windows-only: adds "Move to screen center" to a window's native system
// menu — the same menu opened via Alt+Space, right-clicking the title bar,
// and (crucially) right-clicking the window's taskbar button. That taskbar
// path is the rescue route for a window that has drifted fully off-screen
// (e.g. after unplugging a second monitor) and can no longer be dragged
// back with the mouse.
//
// Win32 has no "menu item clicked" callback we can hook through Tauri's
// normal WindowEvent stream (WM_SYSCOMMAND isn't one of the events Tauri
// forwards), so we subclass the window procedure directly: save the
// existing WNDPROC via GWLP_WNDPROC, install our own, and forward every
// message we don't care about to the original.
//
// This module is only compiled on Windows — see the `#[cfg(windows)] mod
// win_system_menu;` declaration in lib.rs.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::WebviewWindow;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, EnumDisplayMonitors, HDC, HMONITOR, MONITORINFO,
    MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTOPRIMARY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CallWindowProcW, DefWindowProcW, GetCursorPos, GetSystemMenu, GetWindowLongPtrW,
    GetWindowRect, SetWindowLongPtrW, SetWindowPos, GWLP_WNDPROC, MF_SEPARATOR, MF_STRING,
    SWP_NOACTIVATE, SWP_NOZORDER, WM_NCDESTROY, WM_SYSCOMMAND, WNDPROC,
};
use windows::core::{BOOL, PCWSTR};

// Custom command ID appended to the system menu. Must stay below 0xF000 —
// that range is reserved for Windows' own SC_* system commands.
const IDM_MOVE_TO_CENTER: usize = 0x1000;

// Original window procedures, keyed by raw HWND value, so our subclass can
// forward anything it doesn't handle. One process → a single global map.
static ORIGINAL_PROCS: Mutex<Option<HashMap<isize, isize>>> = Mutex::new(None);

/// Adds the "Move to screen center" item to `window`'s system menu and
/// installs the WNDPROC hook that handles it. Call once per window, right
/// after creation. No-op (silently) if the native handle can't be obtained.
pub fn install(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else { return };
    unsafe {
        let menu = GetSystemMenu(hwnd, false);
        if !menu.is_invalid() {
            let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());
            // Bilingual label: the system menu has no access to this app's
            // in-page i18n state, so both languages are shown together.
            let label: Vec<u16> = "画面の中心に移動 / Move to screen center\0"
                .encode_utf16()
                .collect();
            let _ = AppendMenuW(menu, MF_STRING, IDM_MOVE_TO_CENTER, PCWSTR(label.as_ptr()));
        }

        let orig = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
        if orig != 0 {
            ORIGINAL_PROCS
                .lock()
                .unwrap()
                .get_or_insert_with(HashMap::new)
                .insert(hwnd.0 as isize, orig);
            SetWindowLongPtrW(hwnd, GWLP_WNDPROC, wnd_proc as *const () as isize);
        }
    }
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // The low 4 bits of wParam are used internally by Windows for WM_SYSCOMMAND
    // (per MSDN); mask them off before comparing against our custom ID.
    if msg == WM_SYSCOMMAND && (wparam.0 & 0xFFF0) == IDM_MOVE_TO_CENTER {
        move_to_cursor_monitor_center(hwnd);
        return LRESULT(0);
    }

    let orig_ptr = {
        let map = ORIGINAL_PROCS.lock().unwrap();
        map.as_ref().and_then(|m| m.get(&(hwnd.0 as isize)).copied())
    };

    if msg == WM_NCDESTROY {
        if let Ok(mut map) = ORIGINAL_PROCS.lock() {
            if let Some(m) = map.as_mut() {
                m.remove(&(hwnd.0 as isize));
            }
        }
    }

    match orig_ptr {
        Some(ptr) if ptr != 0 => {
            let orig: WNDPROC = std::mem::transmute(ptr);
            CallWindowProcW(orig, hwnd, msg, wparam, lparam)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

/// Moves `hwnd` to the center of the work area of whichever monitor the
/// mouse cursor is currently on. Size is kept unless it's larger than the
/// destination monitor's work area, in which case it's clamped to fit.
unsafe fn move_to_cursor_monitor_center(hwnd: HWND) {
    let mut cursor = POINT::default();
    if GetCursorPos(&mut cursor).is_err() {
        return;
    }
    let hmon = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
    let Some(work) = monitor_work_area(hmon) else { return };

    let mut win_rect = RECT::default();
    if GetWindowRect(hwnd, &mut win_rect).is_err() {
        return;
    }

    let work_w = work.right - work.left;
    let work_h = work.bottom - work.top;
    let win_w = (win_rect.right - win_rect.left).min(work_w).max(1);
    let win_h = (win_rect.bottom - win_rect.top).min(work_h).max(1);

    let x = work.left + (work_w - win_w) / 2;
    let y = work.top + (work_h - win_h) / 2;

    let _ = SetWindowPos(hwnd, None, x, y, win_w, win_h, SWP_NOZORDER | SWP_NOACTIVATE);
}

unsafe fn monitor_work_area(hmon: HMONITOR) -> Option<RECT> {
    if hmon.is_invalid() {
        return None;
    }
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if GetMonitorInfoW(hmon, &mut info).as_bool() {
        Some(info.rcWork)
    } else {
        None
    }
}

fn rects_intersect(a: &RECT, b: &RECT) -> bool {
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

struct EnumCtx {
    target: RECT,
    found: bool,
}

unsafe extern "system" fn enum_monitor_proc(
    hmon: HMONITOR,
    _hdc: HDC,
    _rc: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    let ctx = &mut *(lparam.0 as *mut EnumCtx);
    if let Some(work) = monitor_work_area(hmon) {
        if rects_intersect(&ctx.target, &work) {
            ctx.found = true;
            return BOOL(0); // stop enumeration, we have our answer
        }
    }
    BOOL(1) // keep going
}

/// Startup rescue: if the saved window rect (x, y, width, height) doesn't
/// intersect any connected monitor's work area (e.g. a monitor was
/// unplugged since last run), returns a corrected position centered on the
/// primary monitor instead. Otherwise returns the position unchanged.
/// Size is never touched here — only the launch position.
pub fn rescue_position_if_offscreen(x: f64, y: f64, width: f64, height: f64) -> (f64, f64) {
    let target = RECT {
        left: x as i32,
        top: y as i32,
        right: (x + width) as i32,
        bottom: (y + height) as i32,
    };
    let mut ctx = EnumCtx { target, found: false };
    unsafe {
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(enum_monitor_proc),
            LPARAM(&mut ctx as *mut EnumCtx as isize),
        );
        if ctx.found {
            return (x, y);
        }
        // (0, 0) is always inside the primary monitor by Windows convention,
        // so MONITOR_DEFAULTTOPRIMARY reliably resolves it without needing
        // to enumerate monitors again.
        let primary = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        if let Some(work) = monitor_work_area(primary) {
            let work_w = work.right - work.left;
            let work_h = work.bottom - work.top;
            let cx = work.left + (work_w - width as i32).max(0) / 2;
            let cy = work.top + (work_h - height as i32).max(0) / 2;
            return (cx as f64, cy as f64);
        }
    }
    (x, y)
}
