#
# Local icon generator.
# src-tauri/icons/icon-source.png is the single source of truth (supplied by
# TOM as the app artwork). This script only re-derives every required size
# (32x32, 128x128, .ico, .icns, tray, etc.) from that source — it must never
# draw a placeholder icon itself, or a future icon-source.png swap would get
# silently overwritten by an old procedurally-drawn design again.
#
#   bun run icons     # via package.json script
#   # OR directly
#   pwsh ./scripts/generate-icons.ps1
#
$ErrorActionPreference = 'Stop'
Set-Location -Path (Split-Path $PSScriptRoot -Parent)

$source = "src-tauri/icons/icon-source.png"
if (-not (Test-Path $source)) {
  throw "Missing $source — place the source artwork there before running this script."
}

# Use Tauri CLI to generate every required size from the source.
# Requires `bun install` to have completed.
& bun x tauri icon $source
Write-Host "All Tauri icon sizes generated from $source."
