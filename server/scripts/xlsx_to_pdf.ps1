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
  # export ทั้งเวิร์กบุ๊ก (ไฟล์ถูกลบชีตที่ไม่ต้องการออกแล้ว เหลือเฉพาะหน้าที่ต้องการ
  #  — ใบวางบิล/ใบแจ้งหนี้ = 1 หน้า, ใบเสร็จ = 2 หน้า ต้นฉบับ/คู่ฉบับ)
  # 0 = xlTypePDF
  $wb.ExportAsFixedFormat(0, $Out)
  Write-Output "OK"
} finally {
  if ($wb -ne $null) { $wb.Close($false) | Out-Null }
  if ($xl -ne $null) { $xl.Quit() | Out-Null }
  if ($wb -ne $null) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null }
  if ($xl -ne $null) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($xl) | Out-Null }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
