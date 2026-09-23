Add-Type -AssemblyName System.Drawing

$downloads = "C:\Users\user\Downloads"
$srcFile = Get-ChildItem $downloads -Filter "ChatGPT Image 2026*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $srcFile) { Write-Host "source not found"; exit 1 }
Write-Host "source:" $srcFile.FullName

$src = [System.Drawing.Bitmap]::FromFile($srcFile.FullName)
Write-Host "source size:" $src.Width "x" $src.Height

# crop centered region (inset enough to avoid the source's own rounded-corner black cutouts)
$side = 840
$crop = New-Object System.Drawing.Bitmap($side, $side)
$g = [System.Drawing.Graphics]::FromImage($crop)
$srcX = [int](($src.Width - $side) / 2)
$srcY = [int](($src.Height - $side) / 2)
$dstRect = New-Object System.Drawing.Rectangle(0, 0, $side, $side)
$srcRect = New-Object System.Drawing.Rectangle($srcX, $srcY, $side, $side)
$g.DrawImage($src, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$src.Dispose()

# rounded-corner mask, upscale to 1024
$out = New-Object System.Drawing.Bitmap(1024, 1024)
$g2 = [System.Drawing.Graphics]::FromImage($out)
$g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.Clear([System.Drawing.Color]::Transparent)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 285
$path.AddArc(0, 0, $r, $r, 180, 90)
$path.AddArc(1024 - $r, 0, $r, $r, 270, 90)
$path.AddArc(1024 - $r, 1024 - $r, $r, $r, 0, 90)
$path.AddArc(0, 1024 - $r, $r, $r, 90, 90)
$path.CloseFigure()
$g2.SetClip($path)
$g2.DrawImage($crop, 0, 0, 1024, 1024)
$g2.Dispose()
$crop.Dispose()

$out.Save("D:\Projects\memoPad\scripts\app-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$out.Dispose()
Write-Host "icon written"
