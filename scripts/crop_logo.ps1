Add-Type -AssemblyName System.Drawing

$src = "C:\Users\sherr\Downloads\NightCity\frontend\public\nightcity-logo.png"
$dst = $src

$img = [System.Drawing.Image]::FromFile($src)
$bmp = New-Object System.Drawing.Bitmap $img
$w = $bmp.Width
$h = $bmp.Height

$minX = $w
$minY = $h
$maxX = 0
$maxY = 0
$found = $false

for ($y = 0; $y -lt $h; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    $p = $bmp.GetPixel($x, $y)
    # Content = non-transparent AND not near-black background
    $isContent = ($p.A -gt 12) -and (($p.R + $p.G + $p.B) -gt 40)
    if ($isContent) {
      $found = $true
      if ($x -lt $minX) { $minX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}

if (-not $found) {
  Write-Error "No content pixels found"
  exit 1
}

Write-Host "size=${w}x${h}"
Write-Host "content=(${minX},${minY})-(${maxX},${maxY})"
Write-Host "top=$minY bottom=$($h - 1 - $maxY) left=$minX right=$($w - 1 - $maxX)"

$pad = 24
$minX = [Math]::Max(0, $minX - $pad)
$minY = [Math]::Max(0, $minY - $pad)
$maxX = [Math]::Min($w - 1, $maxX + $pad)
$maxY = [Math]::Min($h - 1, $maxY + $pad)

$cw = $maxX - $minX + 1
$ch = $maxY - $minY + 1
Write-Host "crop=${cw}x${ch} from (${minX},${minY})"

$cropped = New-Object System.Drawing.Bitmap $cw, $ch
$g = [System.Drawing.Graphics]::FromImage($cropped)
$srcRect = New-Object System.Drawing.Rectangle $minX, $minY, $cw, $ch
$g.DrawImage($bmp, 0, 0, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()

$img.Dispose()
$bmp.Dispose()

$cropped.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
$cropped.Dispose()
Write-Host "saved $dst"
