# Prepares the UI art in img/ from the generated originals in art/ (run from anywhere):
#   img/bg_night.jpg, img/bg_day.jpg     page backgrounds
#   img/loading.png, img/peek_*.png      chibi / peeking cut-outs
#   img/st_*.png                         stickers (welcome card, toasts)
#   img/fx.png                           particle atlas, 8 cells of 96 px (order = FX_SPRITES in app.js)
#   img/emblem.png, img/charm.png        title emblem / bubble charm
#   img/pattern.png                      white line motifs for the panels
#   build/tray.png, build/tray@2x.png    tray icon
# The originals are not shipped; only img/ is.
$root = Split-Path $PSScriptRoot -Parent
Add-Type -Path (Join-Path $PSScriptRoot 'Img.cs') -ReferencedAssemblies System.Drawing
$art = Join-Path $root 'art'; $img = Join-Path $root 'img'
New-Item -ItemType Directory -Force $img | Out-Null

function Cutout($name) {
  $p = [Px]::Load((Join-Path $art "$name.png"))
  $p.Levels(10, 245); [void]$p.Despeckle(40, 300)
  $r = $p.Bounds(0); return [Px]::Crop($p, $r)
}
function Fit($p, $w, $h) {   # scale to fit w x h (either may be 0 = free)
  $k = 1e9; if ($w) { $k = [Math]::Min($k, $w / $p.W) }; if ($h) { $k = [Math]::Min($k, $h / $p.H) }
  return [Px]::Resize($p, [int][Math]::Round($p.W * $k), [int][Math]::Round($p.H * $k))
}

foreach ($b in @(@('bg', 'bg_night'), @('bg_day', 'bg_day'))) {
  [Px]::SaveJpeg([Px]::Load((Join-Path $art "$($b[0]).png")), (Join-Path $img "$($b[1]).jpg"), 84)
}
(Fit (Cutout 'loading') 0 320).Save((Join-Path $img 'loading.png'))
(Fit (Cutout 'settings_peek') 400 0).Save((Join-Path $img 'peek_settings.png'))
(Fit (Cutout 'chat_peek') 440 0).Save((Join-Path $img 'peek_chat.png'))
foreach ($s in 'happy', 'pout', 'think', 'shy') { (Fit (Cutout "sticker_$s") 240 240).Save((Join-Path $img "st_$s.png")) }
$em = Cutout 'emblem'
(Fit $em 128 128).Save((Join-Path $img 'emblem.png'))
(Fit $em 16 16).Save((Join-Path $root 'build\tray.png'))
(Fit $em 32 32).Save((Join-Path $root 'build\tray@2x.png'))
(Fit (Cutout 'charm') 96 96).Save((Join-Path $img 'charm.png'))

# particles: 4 x 2 grid on a 1536 x 1024 sheet; the soft glow around each one is cut away
$sheet = [Px]::Load((Join-Path $art 'particles.png')); $sheet.Levels(120, 235)
$fx = [Px]::Blank(96 * 8, 96)
for ($i = 0; $i -lt 8; $i++) {
  $cell = [Px]::Crop($sheet, (New-Object System.Drawing.Rectangle (($i % 4) * 384), ([Math]::Floor($i / 4) * 512), 384, 512))
  [void]$cell.Despeckle(40, 300)
  $fx.Blit([Px]::Crop($cell, $cell.Bounds(0)), $i * 96, 0, 96, 96, 4)
}
$fx.Save((Join-Path $img 'fx.png'))

$pat = Fit ([Px]::Load((Join-Path $art 'pattern.png'))) 512 512
$pat.Save((Join-Path $img 'pattern.png'))
Get-ChildItem $img | ForEach-Object { '{0,-20} {1,8:N0}' -f $_.Name, $_.Length }
