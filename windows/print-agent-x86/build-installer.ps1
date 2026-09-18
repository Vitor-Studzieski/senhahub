$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$AgentProject = Join-Path $Root "SenhaHub.PrintAgent.X86.csproj"
$SetupProject = Join-Path $Root "installer\SenhaHub.PrintAgent.Setup.csproj"
$AgentOutput = Join-Path $Root "bin\Release\SenhaHub.PrintAgent.X86.exe"
$AgentVersion = "1.2.5"
$ArtifactsDirectory = Join-Path $Root "artifacts"
$VersionedAgentOutput = Join-Path $ArtifactsDirectory "SenhaHub.PrintAgent-x86-v$AgentVersion.exe"
$PayloadDirectory = Join-Path $Root "installer\payload"
$SetupOutput = Join-Path $Root "installer\bin\Release\SenhaHub.PrintAgent.Setup.exe"
$VersionedSetupOutput = Join-Path $ArtifactsDirectory "SenhaHub.PrintAgent.Setup-x86-v$AgentVersion.exe"
$BematechDriverName = "Bematech_USBCOM_v4.0.2_2018-09-05.exe"
$BematechDriverUrl = "https://raw.githubusercontent.com/ElginDeveloperCommunity/Impressoras/master/Impressoras%20N%C3%A3o%20Fiscais/Utilit%C3%A1rios%20Bematech/MP-4200%20TH/Drivers/$BematechDriverName"
$BematechSpoolerDriverName = "BematechSpoolerDrivers_x86_v5.0.0.4.exe"
$BematechSpoolerDriverUrl = "https://raw.githubusercontent.com/ElginDeveloperCommunity/Impressoras/master/Impressoras%20N%C3%A3o%20Fiscais/Utilit%C3%A1rios%20Bematech/MP-4200%20TH/Drivers/Spooler_Bematech/$BematechSpoolerDriverName"

function Find-MSBuild {
  $fromPath = Get-Command msbuild.exe -ErrorAction SilentlyContinue
  if ($fromPath) { return $fromPath.Path }

  $vsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vsWhere) {
    $found = & $vsWhere -latest -products * -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\MSBuild.exe | Select-Object -First 1
    if ($found) { return $found }
  }

  throw "MSBuild não encontrado. Execute este script em um Windows com Visual Studio ou Build Tools instalados."
}

$MsBuild = Find-MSBuild
& $MsBuild $AgentProject /t:Build /p:Configuration=Release /p:Platform=x86 /v:minimal
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o agente x86." }
if (-not (Test-Path $AgentOutput)) { throw "Saída do agente não encontrada: $AgentOutput" }

if (Test-Path -LiteralPath $PayloadDirectory) {
  Remove-Item -LiteralPath $PayloadDirectory -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $PayloadDirectory | Out-Null
Copy-Item $AgentOutput (Join-Path $PayloadDirectory "SenhaHub.PrintAgent.X86.exe") -Force
$BematechDriverOutput = Join-Path $PayloadDirectory $BematechDriverName
Invoke-WebRequest -UseBasicParsing -Uri $BematechDriverUrl -OutFile $BematechDriverOutput
if (-not (Test-Path $BematechDriverOutput)) { throw "Driver Bematech não foi baixado: $BematechDriverOutput" }
$BematechSpoolerDriverOutput = Join-Path $PayloadDirectory $BematechSpoolerDriverName
Invoke-WebRequest -UseBasicParsing -Uri $BematechSpoolerDriverUrl -OutFile $BematechSpoolerDriverOutput
if (-not (Test-Path $BematechSpoolerDriverOutput)) { throw "Driver Spooler Bematech não foi baixado: $BematechSpoolerDriverOutput" }

& $MsBuild $SetupProject /t:Build /p:Configuration=Release /p:Platform=x86 /v:minimal
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o instalador." }
if (-not (Test-Path $SetupOutput)) { throw "Instalador não encontrado: $SetupOutput" }

New-Item -ItemType Directory -Force -Path $ArtifactsDirectory | Out-Null
Copy-Item $AgentOutput $VersionedAgentOutput -Force
Copy-Item $SetupOutput $VersionedSetupOutput -Force

Write-Host "Instalador criado em: $SetupOutput"
Write-Host "Agente versionado criado em: $VersionedAgentOutput"
Write-Host "Instalador versionado criado em: $VersionedSetupOutput"
