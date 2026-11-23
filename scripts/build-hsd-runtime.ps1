param(
  [string]$NodeExe = 'C:\Program Files\nodejs\node.exe',
  [string]$HsdDir = (Join-Path $env:APPDATA 'npm\node_modules\hsd'),
  [string]$OutDir = (Join-Path $PSScriptRoot '..\release'),
  [string]$SevenZip = (Join-Path $PSScriptRoot '..\node_modules\7zip-bin\win\x64\7za.exe')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $NodeExe)) { throw "node.exe not found: $NodeExe" }
if (-not (Test-Path (Join-Path $HsdDir 'bin\hsd'))) { throw "hsd not found: $HsdDir" }
if (-not (Test-Path $SevenZip)) { throw "7za.exe not found: $SevenZip" }

$nodeVersion = (& $NodeExe --version).Trim().TrimStart('v')
$hsdPackage = Get-Content (Join-Path $HsdDir 'package.json') -Raw | ConvertFrom-Json
$hsdVersion = $hsdPackage.version
$runtimeName = "Handess-HSD-Runtime-$hsdVersion-win-x64"
$stageRoot = Join-Path $env:TEMP "handess-runtime-stage-$([guid]::NewGuid().ToString('N'))"
$stage = Join-Path $stageRoot $runtimeName
$zipPath = Join-Path $OutDir "$runtimeName.zip"

try {
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  Copy-Item $NodeExe (Join-Path $stage 'node.exe')
  Copy-Item $HsdDir (Join-Path $stage 'hsd') -Recurse
  Copy-Item (Join-Path $HsdDir 'LICENSE') (Join-Path $stage 'LICENSE-HSD.txt')

  $nodeLicense = Join-Path $PSScriptRoot '..\resources\runtime\LICENSE-Node.txt'
  if (Test-Path $nodeLicense) {
    Copy-Item $nodeLicense (Join-Path $stage 'LICENSE-Node.txt')
  }

  $notices = Join-Path $PSScriptRoot '..\THIRD_PARTY_NOTICES.md'
  if (Test-Path $notices) {
    Copy-Item $notices (Join-Path $stage 'THIRD_PARTY_NOTICES.md')
  }

  @{
    name = 'Handess HSD Runtime'
    node = $nodeVersion
    hsd = $hsdVersion
    platform = 'win32-x64'
    builtAt = (Get-Date).ToUniversalTime().ToString('o')
    purpose = 'Private Node.js + hsd runtime downloaded by Handess Wallet setup'
  } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $stage 'VERSION.json')

  @'
Handess HSD Runtime
===================

This optional runtime contains Node.js and hsd for Handess Wallet's setup wizard.
It is not part of the Handess Wallet MSI. It is downloaded only when the user
chooses "New to Handshake" or needs a private hsd runtime.

Run a quick check:
  node.exe hsd\bin\hsd --version

Node.js and hsd remain under their own licenses. See LICENSE-Node.txt,
hsd\LICENSE, and THIRD_PARTY_NOTICES.md.
'@ | Set-Content -Encoding UTF8 (Join-Path $stage 'README.txt')

  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  Push-Location $stage
  try {
    & $SevenZip a -tzip -mx=9 $zipPath '*' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "7za failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }

  $hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash
  $size = (Get-Item $zipPath).Length
  "$hash  $runtimeName.zip" | Set-Content -Encoding ASCII "$zipPath.sha256"

  [pscustomobject]@{
    File = $zipPath
    Bytes = $size
    MB = [math]::Round($size / 1MB, 1)
    SHA256 = $hash
    Node = $nodeVersion
    Hsd = $hsdVersion
  } | Format-List
} finally {
  if (Test-Path $stageRoot) { Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
