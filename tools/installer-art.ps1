# Draws the NSIS installer artwork from the generated art (run from anywhere):
#   build/installerSidebar.bmp  164x314  welcome / finish pages: her at the cafe door (art/installer.png)
#   build/installerHeader.bmp   150x57   top-right of the other pages: the cat emblem (img/emblem.png, see ui-art.ps1)
# NSIS wants plain 24-bit BMPs.
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent

function New-Canvas($w, $h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  return $bmp, $g
}
function Color($hex, $a = 255) { $c = [System.Drawing.ColorTranslator]::FromHtml($hex); return [System.Drawing.Color]::FromArgb($a, $c) }

# ---- sidebar: a full-height strip of the doorway picture, centred on her
$src = [System.Drawing.Image]::FromFile((Join-Path $root 'art\installer.png'))
$bmp, $g = New-Canvas 164 314
$cw = [int]($src.Height * 164 / 314); $cx = [Math]::Max(0, [Math]::Min($src.Width - $cw, 490 - [int]($cw / 2)))
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, 164, 314), $cx, 0, $cw, $src.Height, [System.Drawing.GraphicsUnit]::Pixel)
$bmp.Save((Join-Path $root 'build\installerSidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $bmp.Dispose(); $src.Dispose()

# ---- header: the emblem on the page colour with a few sakura dots
$em = [System.Drawing.Image]::FromFile((Join-Path $root 'img\emblem.png'))
$bmp, $g = New-Canvas 150 57
$g.Clear((Color '#fff5f9'))
$glow = New-Object System.Drawing.Drawing2D.GraphicsPath; $glow.AddEllipse(78, -14, 86, 86)
$pg = New-Object System.Drawing.Drawing2D.PathGradientBrush $glow
$pg.CenterColor = Color '#f9c6d8' 150; $pg.SurroundColors = @((Color '#f9c6d8' 0))
$g.FillPath($pg, $glow)
$h = 50; $w = [int]($em.Width * $h / $em.Height)
$g.DrawImage($em, (New-Object System.Drawing.Rectangle (146 - $w), 4, $w, $h))
$g.FillEllipse((New-Object System.Drawing.SolidBrush (Color '#f4a3c0')), 40, 24, 6, 6)
$g.FillEllipse((New-Object System.Drawing.SolidBrush (Color '#f9c6d8')), 54, 32, 4, 4)
$g.FillEllipse((New-Object System.Drawing.SolidBrush (Color '#d8b46a' 170)), 64, 20, 3, 3)
$bmp.Save((Join-Path $root 'build\installerHeader.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose(); $bmp.Dispose(); $em.Dispose()
