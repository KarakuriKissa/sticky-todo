#
# Local icon generator — same logic as the GitHub Actions workflow.
# Run once after `bun install` so cargo can find src-tauri/icons/icon.ico etc.
#
#   bun run icons     # via package.json script
#   # OR directly
#   pwsh ./scripts/generate-icons.ps1
#
$ErrorActionPreference = 'Stop'
Set-Location -Path (Split-Path $PSScriptRoot -Parent)

New-Item -ItemType Directory -Force "src-tauri/icons" | Out-Null
Add-Type -AssemblyName System.Drawing

$size = 1240
$bmp  = New-Object System.Drawing.Bitmap $size, $size
$g    = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# Sticky-note yellow background
$g.Clear([System.Drawing.Color]::FromArgb(254, 240, 138))

# White inner card
$white = New-Object System.Drawing.SolidBrush(
  [System.Drawing.Color]::FromArgb(220, 255, 255, 255))
$g.FillRectangle($white, 155, 200, 930, 840)

# Three task lines
$linePen = New-Object System.Drawing.Pen(
  [System.Drawing.Color]::FromArgb(30, 30, 46), 52)
$linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$linePen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($linePen, 300, 420, 980, 420)
$g.DrawLine($linePen, 300, 570, 900, 570)
$g.DrawLine($linePen, 300, 720, 760, 720)

# Checkboxes (one filled)
$cbPen = New-Object System.Drawing.Pen(
  [System.Drawing.Color]::FromArgb(99, 102, 241), 38)
$g.DrawRectangle($cbPen, 230, 394, 52, 52)
$filled = New-Object System.Drawing.SolidBrush(
  [System.Drawing.Color]::FromArgb(99, 102, 241))
$g.FillRectangle($filled, 234, 544, 44, 44)
$g.DrawRectangle($cbPen, 230, 694, 52, 52)

$g.Dispose()
$bmp.Save("src-tauri/icons/icon-source.png",
  [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "Source PNG written to src-tauri/icons/icon-source.png"

# Use Tauri CLI to generate every required size from the source.
# Requires `bun install` to have completed.
& bun x tauri icon "src-tauri/icons/icon-source.png"
Write-Host "All Tauri icon sizes generated."
