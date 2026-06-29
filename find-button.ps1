param([string]$Path,[double]$rx0=0,[double]$ry0=0,[double]$rx1=1,[double]$ry1=1,[int]$tr=37,[int]$tg=99,[int]$tb=235,[int]$tol=45)
Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile($Path)
$W = $bmp.Width; $H = $bmp.Height
$x0=[int]($rx0*$W); $x1=[int]($rx1*$W); $y0=[int]($ry0*$H); $y1=[int]($ry1*$H)
$rect = New-Object System.Drawing.Rectangle 0,0,$W,$H
$data = $bmp.LockBits($rect,[System.Drawing.Imaging.ImageLockMode]::ReadOnly,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = [int]$data.Stride
$len = $stride*$H
$bytes = [byte[]]::new($len)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0,$bytes,0,$len)
$bmp.UnlockBits($data); $bmp.Dispose()
$minX=$W;$minY=$H;$maxX=0;$maxY=0;$cnt=0
for($y=$y0;$y -lt $y1;$y++){
  $row=$y*$stride
  for($x=$x0;$x -lt $x1;$x++){
    $i=$row+$x*4
    $b=$bytes[$i];$g=$bytes[$i+1];$r=$bytes[$i+2]
    if([math]::Abs($r-$tr)-le $tol -and [math]::Abs($g-$tg)-le $tol -and [math]::Abs($b-$tb)-le $tol){
      if($x-lt$minX){$minX=$x}; if($x-gt$maxX){$maxX=$x}
      if($y-lt$minY){$minY=$y}; if($y-gt$maxY){$maxY=$y}; $cnt++
    }
  }
}
if($cnt -lt 30){ Write-Output "NONE count=$cnt"; return }
$padX=[int]($W*0.006); $padY=[int]($H*0.008)
$bx=[math]::Max(0,$minX-$padX); $by=[math]::Max(0,$minY-$padY)
$bw=[math]::Min($W,$maxX+$padX)-$bx; $bh=[math]::Min($H,$maxY+$padY)-$by
$lp=[math]::Round($bx/$W*100,1); $tp=[math]::Round($by/$H*100,1)
$wp=[math]::Round($bw/$W*100,1); $hp=[math]::Round($bh/$H*100,1)
Write-Output "left:$lp% top:$tp% width:$wp% height:$hp% (count=$cnt)"
