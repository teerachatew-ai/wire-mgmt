param(
  [Parameter(Mandatory=$true)][string]$In,
  [Parameter(Mandatory=$true)][string]$Out
)
$ErrorActionPreference = "Stop"
$xl = $null
$wb = $null
try {
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false
  $xl.DisplayAlerts = $false
  $wb = $xl.Workbooks.Open($In, $false, $true)  # ReadOnly
  # export เฉพาะชีตฟอร์ม = ชีตที่ 2 (จับด้วย index กันปัญหาชื่อภาษาไทย)
  $ws = $null
  foreach ($s in $wb.Worksheets) { if ($s.Name -like "*Form*") { $ws = $s; break } }
  if ($ws -eq $null -and $wb.Worksheets.Count -ge 2) { $ws = $wb.Worksheets.Item(2) }
  if ($ws -ne $null) {
    $ws.Activate() | Out-Null
    # ใช้ค่า page setup จากไฟล์ (fitToWidth=1, fitToHeight=0 = กว้าง 1 หน้า สูงไหลหลายหน้า)
    # 0 = xlTypePDF
    $ws.ExportAsFixedFormat(0, $Out)
  } else {
    $wb.ExportAsFixedFormat(0, $Out)
  }
  Write-Output "OK"
} finally {
  if ($wb -ne $null) { $wb.Close($false) | Out-Null }
  if ($xl -ne $null) { $xl.Quit() | Out-Null }
  if ($wb -ne $null) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null }
  if ($xl -ne $null) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($xl) | Out-Null }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
