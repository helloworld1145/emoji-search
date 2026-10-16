# 生成品牌启动图：渐变背景 + 笑脸 + 应用名，覆盖各密度 splash.png
Add-Type -AssemblyName System.Drawing

$resDir = "android\app\src\main\res"
$sizes = @{
    "drawable"                = @{ W = 480;  H = 320 }
    "drawable-land-mdpi"      = @{ W = 480;  H = 320 }
    "drawable-land-hdpi"      = @{ W = 800;  H = 480 }
    "drawable-land-xhdpi"     = @{ W = 1280; H = 720 }
    "drawable-land-xxhdpi"    = @{ W = 1600; H = 960 }
    "drawable-land-xxxhdpi"   = @{ W = 1920; H = 1280 }
    "drawable-port-mdpi"      = @{ W = 320;  H = 480 }
    "drawable-port-hdpi"      = @{ W = 480;  H = 800 }
    "drawable-port-xhdpi"     = @{ W = 720;  H = 1280 }
    "drawable-port-xxhdpi"    = @{ W = 960;  H = 1600 }
    "drawable-port-xxxhdpi"   = @{ W = 1280; H = 1920 }
}

$c1 = [System.Drawing.Color]::FromArgb(255, 255, 107, 107)
$c2 = [System.Drawing.Color]::FromArgb(255, 255, 142, 83)
$white = [System.Drawing.Color]::White

$fontCandidates = @("Microsoft YaHei", "微软雅黑", "SimHei", "Arial")
$fontName = $fontCandidates | Where-Object {
    (Get-ChildItem "C:\Windows\Fonts" -Filter "$_*.tt*" -ErrorAction SilentlyContinue) -or
    (Get-ChildItem "C:\Windows\Fonts" -Filter "$_*.ttc" -ErrorAction SilentlyContinue)
} | Select-Object -First 1
if (-not $fontName) { $fontName = "Arial" }
Write-Host "using font: $fontName"

function New-Splash {
    param([int]$W, [int]$H, [string]$OutPath)

    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Rectangle(0, 0, $W, $H)), $c1, $c2, 45)
    $g.FillRectangle($brush, 0, 0, $W, $H)
    $brush.Dispose()

    $unit = [Math]::Min($W, $H)

    # 笑脸
    $cx = [int]($W / 2)
    $cy = [int]($H * 0.42)
    $eyeR = [Math]::Max(3, [int]($unit * 0.018))
    $eyeDx = [int]($unit * 0.075)
    $eyeY = [int]($cy - $unit * 0.045)
    $wb = New-Object System.Drawing.SolidBrush($white)
    $g.FillEllipse($wb, ($cx - $eyeDx - $eyeR), ($eyeY - $eyeR), ($eyeR * 2), ($eyeR * 2))
    $g.FillEllipse($wb, ($cx + $eyeDx - $eyeR), ($eyeY - $eyeR), ($eyeR * 2), ($eyeR * 2))
    $penW = [Math]::Max(3, [int]($unit * 0.018))
    $pen = New-Object System.Drawing.Pen($white, $penW)
    $mouth = New-Object System.Drawing.Rectangle(
        ($cx - [int]($unit * 0.10)), ($cy - [int]($unit * 0.075)),
        [int]($unit * 0.20), [int]($unit * 0.15))
    $g.DrawArc($pen, $mouth, 15, 150)
    $pen.Dispose()

    # 应用名
    $fontSize = [Math]::Max(14, [int]($unit * 0.075))
    $font = New-Object System.Drawing.Font($fontName, $fontSize, [System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textRect = New-Object System.Drawing.RectangleF(0, [float]($H * 0.66), $W, [float]($H * 0.2))
    $g.DrawString("表情搜搜", $font, $wb, $textRect, $sf)
    $font.Dispose()
    $wb.Dispose()

    $g.Dispose()
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "generated: $OutPath ${W}x${H}"
}

foreach ($dir in $sizes.Keys) {
    $outDir = Join-Path $resDir $dir
    if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
    New-Splash -W $sizes[$dir].W -H $sizes[$dir].H -OutPath (Join-Path $outDir "splash.png")
}
Write-Host "done"
