<#
  给 Mozi 的 Windows 产物做自签名，消除“未知发布者”。

  为什么需要它：Windows 只根据 Authenticode 签名判断发布者。未签名的 exe
  一定显示“未知发布者”，这不是打包错误。要让发布者显示为可信名称，只有两条路：
    1) 购买代码签名证书（OV/EV），把证书交给 CI 自动签名 —— 正式发布走这条；
    2) 用本脚本自签名，并在自己机器上信任该证书 —— 适合个人/内网自用。

  自签名能做什么：在本机（信任了该证书）上，发布者显示为证书主体，
  UAC/SmartScreen 不再以“未知发布者”拦载。
  自签名不能做什么：不会积累 SmartScreen 信誉，别人的机器上仍然是未知发布者。

  用法（在 Windows PowerShell 中，项目根目录执行）：
    # 1. 生成自签名证书并信任（当前用户，无需管理员）
    powershell -ExecutionPolicy Bypass -File tools/sign-windows.ps1 -CreateCert -Trust

    # 2. 给 release/ 下的 exe 签名
    powershell -ExecutionPolicy Bypass -File tools/sign-windows.ps1 -Path release

    # 3. 校验
    powershell -ExecutionPolicy Bypass -File tools/sign-windows.ps1 -VerifyOnly

    # 信任到本机所有用户（需要管理员）
    powershell -ExecutionPolicy Bypass -File tools/sign-windows.ps1 -CreateCert -Trust -AllUsers
#>
[CmdletBinding()]
param(
  [string]$Path = "release",
  [string]$Subject = "CN=Mozi contributors, O=Mozi, C=CN",
  [string]$PfxPath = "$PSScriptRoot\..\.cache\mozi-selfsigned.pfx",
  [string]$PfxPassword = "mozi",
  [switch]$CreateCert,
  [switch]$Trust,
  [switch]$AllUsers,
  [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"

function Get-SigningCert {
  param([string]$SubjectName)
  $found = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq $SubjectName -and $_.HasPrivateKey } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1
  return $found
}

function New-SigningCert {
  param([string]$SubjectName, [string]$OutPfx, [string]$Password)
  Write-Host "创建自签名代码签名证书：$SubjectName"
  $cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $SubjectName `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -NotAfter (Get-Date).AddYears(5) `
    -TextExtension @("2.5.29.19={text}")

  $dir = Split-Path -Parent $OutPfx
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
  Export-PfxCertificate -Cert $cert -FilePath $OutPfx -Password $secure | Out-Null
  Export-Certificate -Cert $cert -FilePath ([IO.Path]::ChangeExtension($OutPfx, ".cer")) | Out-Null
  Write-Host "已导出：$OutPfx"
  return $cert
}

function Install-Trust {
  param([System.Security.Cryptography.X509Certificates.X509Certificate2]$Cert, [bool]$Machine)
  $scope = if ($Machine) { "LocalMachine" } else { "CurrentUser" }
  Write-Host "把证书加入受信任的根证书颁发机构和受信任的发布者（$scope）"
  $cer = [IO.Path]::ChangeExtension($PfxPath, ".cer")
  foreach ($store in @("Root", "TrustedPublisher")) {
    $location = "Cert:\$scope\$store"
    Import-Certificate -FilePath $cer -CertStoreLocation $location | Out-Null
    Write-Host "  + $location"
  }
  if (-not $Machine) {
    Write-Host "提示：当前用户范围无需管理员；如需整机生效请加 -AllUsers（需管理员）"
  }
}

function Invoke-Sign {
  param([string]$Dir, [System.Security.Cryptography.X509Certificates.X509Certificate2]$Cert)
  if (-not (Test-Path $Dir)) { throw "找不到目录：$Dir（先运行 npm run dist:win）" }
  $files = Get-ChildItem -Path $Dir -Recurse -Include *.exe,*.dll
  $files = $files | Where-Object { $_.FullName -notmatch 'app\.asar\.unpacked' }
  if (-not $files) { throw "$Dir 下没有可签名的文件" }
  foreach ($file in $files) {
    $result = Set-AuthenticodeSignature -FilePath $file.FullName -Certificate $Cert -HashAlgorithm SHA256
    $status = $result.Status
    Write-Host ("  {0,-6} {1}" -f $status, $file.FullName)
  }
}

function Invoke-Verify {
  param([string]$Dir)
  $files = Get-ChildItem -Path $Dir -Recurse -Include *.exe | Select-Object -First 20
  foreach ($file in $files) {
    $sig = Get-AuthenticodeSignature -FilePath $file.FullName
    Write-Host ("  {0,-12} {1}" -f $sig.Status, $file.Name)
  }
}

$cert = Get-SigningCert -SubjectName $Subject

if ($CreateCert -or (-not $cert -and -not $VerifyOnly)) {
  if (-not $cert) { $cert = New-SigningCert -SubjectName $Subject -OutPfx $PfxPath -Password $PfxPassword }
  else { Write-Host "复用已有证书：$($cert.Thumbprint)" }
}
if ($Trust) {
  if (-not $cert) { throw "没有可用证书，先加 -CreateCert" }
  Install-Trust -Cert $cert -Machine:$AllUsers
}

if ($VerifyOnly) {
  Write-Host "校验签名："
  Invoke-Verify -Dir $Path
  return
}

if ($cert) {
  Write-Host "签名 $Path 下的产物…"
  Invoke-Sign -Dir $Path -Cert $cert
  Write-Host "完成。证书指纹：$($cert.Thumbprint)"
  Write-Host "注意：自签名只在本机（信任了该证书的机器）上消除“未知发布者”，不会积累 SmartScreen 信誉。"
}
