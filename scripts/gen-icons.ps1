# 生成表情搜搜应用图标：渐变圆角方形 + 笑脸，输出到各密度 mipmap 目录
Add-Type -AssemblyName System.Drawing

$resDir = "android\app\src\main\res"
$densities = @{
    "mipmap-mdpi"    = 48
    "mipmap-hdpi"    = 72
    "mipmap-xhdpi"   = 96
    "mipmap-xxhdpi"  = 144
    "mipmap-xxxhdpi" = 192
}

$c1 = [System.Drawing.Color]::FromArgb(255, 255, 107, 107)  # #FF6B6B
$c2 = [System.Drawing.Color]::FromArgb(255, 255, 142, 83)   # #FF8E53
$face = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)

function New-Icon {
    param(
        [int]$Size,
        [bool]$Round,
        [string]$OutPath
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # 背景：渐变圆角方形或圆形
    $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect, $c1, $c2, [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
    if ($Round) {
        $g.FillEllipse($brush, $rect)
    } else {
        $radius = [int]($Size * 0.22)
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddArc(0, 0, $radius * 2, $radius * 2, 180, 90)
        $path.AddArc($Size - $radius * 2, 0, $radius * 2, $radius * 2, 270, 90)
        $path.AddArc($Size - $radius * 2, $Size - $radius * 2, $radius * 2, $radius * 2, 0, 90)
        $path.AddArc(0, $Size - $radius * 2, $radius * 2, $radius * 2, 90, 90)
        $path.CloseFigure()
        $g.FillPath($brush, $path)
        $path.Dispose()
    }
    $brush.Dispose()

    # 笑脸：眼睛 + 嘴
    $eyeR = [Math]::Max(2, [int]($Size * 0.055))
    $eyeY = [int]($Size * 0.38)
    $eyeDx = [int]($Size * 0.20)
    $cx = [int]($Size / 2)
    $eyeBrush = New-Object System.Drawing.SolidBrush($face)
    $g.FillEllipse($eyeBrush, ($cx - $eyeDx - $eyeR), ($eyeY - $eyeR), ($eyeR * 2), ($eyeR * 2))
    $g.FillEllipse($eyeBrush, ($cx + $eyeDx - $eyeR), ($eyeY - $eyeR), ($eyeR * 2), ($eyeR * 2))

    # 微笑弧线
    $penW = [Math]::Max(2, [int]($Size * 0.05))
    $pen = New-Object System.Drawing.Pen($face, $penW)
    $mouthRect = New-Object System.Drawing.Rectangle(
        [int]($Size * 0.28), [int]($Size * 0.42), [int]($Size * 0.44), [int]($Size * 0.34))
    $g.DrawArc($pen, $mouthRect, 15, 150)
    $pen.Dispose()
    $eyeBrush.Dispose()

    $g.Dispose()
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "generated: $OutPath ($Size px)"
}

foreach ($dir in $densities.Keys) {
    $size = $densities[$dir]
    $outDir = Join-Path $resDir $dir
    if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
    New-Icon -Size $size -Round $false -OutPath (Join-Path $outDir "ic_launcher.png")
    New-Icon -Size $size -Round $true  -OutPath (Join-Path $outDir "ic_launcher_round.png")
}

# 自适应图标（API 26+）：前景 + 背景
$anydpi = Join-Path $resDir "mipmap-anydpi-v26"
if (-not (Test-Path $anydpi)) { New-Item -ItemType Directory -Path $anydpi -Force | Out-Null }
Write-Host "done"
