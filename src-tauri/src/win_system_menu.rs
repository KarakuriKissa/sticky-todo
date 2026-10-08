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

use tauri::{WebviewWindow, Window};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, EnumDisplayMonitors, HDC, HMONITOR, MONITORINFO,
    MonitorFromRect, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CallWindowProcW, DefWindowProcW, GetCursorPos, GetSystemMenu, GetWindowLongPtrW,
    GetWindowRect, SetWindowLongPtrW, SetWindowPos, GWLP_WNDPROC, MF_SEPARATOR, MF_STRING,
    SC_RESTORE, SWP_NOACTIVATE, SWP_NOZORDER, WM_DISPLAYCHANGE, WM_DPICHANGED,
    WM_EXITSIZEMOVE, WM_NCDESTROY, WM_SETTINGCHANGE, WM_SYSCOMMAND, WNDPROC,
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

/// Check the real native window rectangle after Windows/Tauri has applied DPI
/// conversion. Saved positions are logical pixels, while Win32 monitor work
/// areas are physical pixels, so comparing the saved values directly is wrong
/// on mixed-DPI multi-monitor setups.
pub fn ensure_window_reachable(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else { return };
    unsafe { ensure_hwnd_reachable(hwnd); }
}

/// Same native check for Tauri's global window-event callback.
pub fn ensure_tauri_window_reachable(window: &Window) {
    let Ok(hwnd) = window.hwnd() else { return };
    unsafe { ensure_hwnd_reachable(hwnd); }
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

    let result = match orig_ptr {
        Some(ptr) if ptr != 0 => {
            let orig: WNDPROC = std::mem::transmute(ptr);
            CallWindowProcW(orig, hwnd, msg, wparam, lparam)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    };

    // Monitor removal, taskbar/work-area changes, DPI changes, and the end of
    // a user move can all leave only a few pixels visible. Run after the
    // original procedure so WM_DPICHANGED has already applied its suggested
    // rectangle. SetWindowPos does not generate WM_EXITSIZEMOVE recursively.
    if matches!(msg, WM_DISPLAYCHANGE | WM_SETTINGCHANGE | WM_DPICHANGED | WM_EXITSIZEMOVE)
        || (msg == WM_SYSCOMMAND && (wparam.0 & 0xFFF0) == SC_RESTORE as usize)
    {
        ensure_hwnd_reachable(hwnd);
    }
    result
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

fn intersection_size(a: &RECT, b: &RECT) -> (i32, i32) {
    ((a.right.min(b.right) - a.left.max(b.left)).max(0),
     (a.bottom.min(b.bottom) - a.top.max(b.top)).max(0))
}

/// A frameless note is draggable from its top toolbar. Merely intersecting a
/// monitor by one pixel is therefore insufficient: enough of that top strip
/// must be visible to grab and move the window.
fn has_reachable_grab_area(window: &RECT, work: &RECT) -> bool {
    let width = (window.right - window.left).max(1);
    let height = (window.bottom - window.top).max(1);
    let grab = RECT {
        left: window.left,
        top: window.top,
        right: window.right,
        bottom: window.top + height.min(48),
    };
    let (visible_w, visible_h) = intersection_size(&grab, work);
    visible_w >= width.min(96) && visible_h >= height.min(24)
}

fn clamp_rect_to_work_area(window: &RECT, work: &RECT) -> RECT {
    let work_w = (work.right - work.left).max(1);
    let work_h = (work.bottom - work.top).max(1);
    let width = (window.right - window.left).max(1).min(work_w);
    let height = (window.bottom - window.top).max(1).min(work_h);
    let left = window.left.clamp(work.left, work.right - width);
    let top = window.top.clamp(work.top, work.bottom - height);
    RECT { left, top, right: left + width, bottom: top + height }
}

unsafe fn ensure_hwnd_reachable(hwnd: HWND) {
    let mut window = RECT::default();
    if GetWindowRect(hwnd, &mut window).is_err() {
        return;
    }

    let mut ctx = EnumCtx { target: window, found: false };
    let _ = EnumDisplayMonitors(None, None, Some(enum_monitor_proc), LPARAM(&mut ctx as *mut EnumCtx as isize));
    if ctx.found {
        return;
    }

    let monitor = MonitorFromRect(&window, MONITOR_DEFAULTTONEAREST);
    let Some(work) = monitor_work_area(monitor) else { return };
    let corrected = clamp_rect_to_work_area(&window, &work);
    let _ = SetWindowPos(
        hwnd,
        None,
        corrected.left,
        corrected.top,
        corrected.right - corrected.left,
        corrected.bottom - corrected.top,
        SWP_NOZORDER | SWP_NOACTIVATE,
    );
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
        if has_reachable_grab_area(&ctx.target, &work) {
            ctx.found = true;
            return BOOL(0); // stop enumeration, we have our answer
        }
    }
    BOOL(1) // keep going
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::core::w;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, WINDOW_EX_STYLE, WS_POPUP,
    };

    fn rect(left: i32, top: i32, width: i32, height: i32) -> RECT {
        RECT { left, top, right: left + width, bottom: top + height }
    }

    #[test]
    fn one_visible_corner_is_not_considered_reachable() {
        let work = rect(0, 0, 1920, 1040);
        assert!(!has_reachable_grab_area(&rect(1900, 1020, 420, 520), &work));
    }

    #[test]
    fn visible_top_grab_strip_is_reachable() {
        let work = rect(0, 0, 1920, 1040);
        assert!(has_reachable_grab_area(&rect(1820, 300, 420, 520), &work));
    }

    #[test]
    fn title_above_monitor_is_not_reachable_even_if_body_intersects() {
        let work = rect(0, 0, 1920, 1040);
        assert!(!has_reachable_grab_area(&rect(300, -40, 420, 520), &work));
    }

    #[test]
    fn clamp_keeps_complete_window_in_negative_coordinate_monitor() {
        let work = rect(-1920, 0, 1920, 1040);
        let fixed = clamp_rect_to_work_area(&rect(-2400, -200, 420, 520), &work);
        assert_eq!((fixed.left, fixed.top, fixed.right, fixed.bottom), (-1920, 0, -1500, 520));
    }

    #[test]
    fn clamp_shrinks_oversized_window_to_work_area() {
        let work = rect(0, 0, 1280, 680);
        let fixed = clamp_rect_to_work_area(&rect(-50, -50, 2000, 1000), &work);
        assert_eq!((fixed.left, fixed.top, fixed.right, fixed.bottom), (0, 0, 1280, 680));
    }

    #[test]
    fn native_window_is_repaired_from_an_unreachable_position() {
        unsafe {
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                w!("PetaMemo off-screen QA"),
                WS_POPUP,
                30_000,
                30_000,
                420,
                520,
                None,
                None,
                None,
                None,
            )
            .expect("native QA window should be created");

            ensure_hwnd_reachable(hwnd);
            let mut repaired = RECT::default();
            GetWindowRect(hwnd, &mut repaired).expect("native QA window rect should be readable");
            assert!(repaired.left < 30_000 && repaired.top < 30_000);
            assert!(MonitorFromRect(&repaired, MONITOR_DEFAULTTONEAREST).is_invalid() == false);
            DestroyWindow(hwnd).expect("native QA window should be destroyed");
        }
    }
}
