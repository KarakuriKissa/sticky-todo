#
# build-clean.ps1 — recovers from the most common Bun + Vite + Windows build
# failures by wiping every regen-able artifact and reinstalling deps fresh.
#
#   pwsh ./scripts/build-clean.ps1            # default: full reset + build
#   pwsh ./scripts/build-clean.ps1 -SkipTauri # skip Rust/Tauri build (faster)
#
param(
    [switch]$SkipTauri
)

$ErrorActionPreference = 'Stop'
Set-Location -Path (Split-Path $PSScriptRoot -Parent)

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# ── 1. Clean every generated folder ─────────────────────────────────────────
Step '1. Removing generated folders'
$toRemove = @('dist', 'node_modules', 'src-tauri/target', 'bun.lock')
foreach ($p in $toRemove) {
    if (Test-Path $p) {
        Write-Host "   - rm $p"
        Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
    }
}

# ── 2. bun install fresh ────────────────────────────────────────────────────
Step '2. bun install'
$bun = "$env:USERPROFILE\.bun\bin\bun.exe"
if (-not (Test-Path $bun)) { $bun = 'bun' }
& $bun install
if ($LASTEXITCODE -ne 0) { throw 'bun install failed' }

# ── 3. Generate Tauri icons (System.Drawing → PNG → all sizes) ──────────────
Step '3. Generating icons'
& pwsh -ExecutionPolicy Bypass -File ./scripts/generate-icons.ps1
if ($LASTEXITCODE -ne 0) { throw 'icon generation failed' }

# ── 4. TypeScript + vite build ──────────────────────────────────────────────
Step '4. bun run build (tsc + vite)'
& $bun run build
if ($LASTEXITCODE -ne 0) { throw 'web build failed' }

# ── 5. Tests ────────────────────────────────────────────────────────────────
Step '5. bun test tests/'
& $bun test tests/
if ($LASTEXITCODE -ne 0) { throw 'tests failed' }

# ── 6. Optional: full Tauri release bundle ──────────────────────────────────
if (-not $SkipTauri) {
    Step '6. bun run tauri build (Rust + bundle)'
    & $bun run tauri build
    if ($LASTEXITCODE -ne 0) { throw 'tauri build failed' }

    Write-Host "`n✅ Tauri bundle ready:" -ForegroundColor Green
    Get-ChildItem -Path 'src-tauri/target/release/bundle' -Recurse `
        -Include '*.exe', '*.msi' | ForEach-Object {
        Write-Host ('   - ' + $_.FullName)
    }
} else {
    Write-Host "`n⚠ Skipped tauri build (-SkipTauri)" -ForegroundColor Yellow
}

Write-Host "`n✅ Clean build complete." -ForegroundColor Green
