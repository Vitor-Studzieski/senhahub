$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$AgentProject = Join-Path $Root "SenhaHub.PrintAgent.X86.csproj"
$SetupProject = Join-Path $Root "installer\SenhaHub.PrintAgent.Setup.csproj"
$AgentOutput = Join-Path $Root "bin\Release\SenhaHub.PrintAgent.X86.exe"
$PayloadDirectory = Join-Path $Root "installer\payload"
$SetupOutput = Join-Path $Root "installer\bin\Release\SenhaHub.PrintAgent.Setup.exe"
$BematechDriverName = "Bematech_USBCOM_v4.0.2_2018-09-05.exe"
$BematechDriverUrl = "https://raw.githubusercontent.com/ElginDeveloperCommunity/Impressoras/master/Impressoras%20N%C3%A3o%20Fiscais/Utilit%C3%A1rios%20Bematech/MP-4200%20TH/Drivers/$BematechDriverName"

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

New-Item -ItemType Directory -Force -Path $PayloadDirectory | Out-Null
Copy-Item $AgentOutput (Join-Path $PayloadDirectory "SenhaHub.PrintAgent.X86.exe") -Force
$BematechDriverOutput = Join-Path $PayloadDirectory $BematechDriverName
Invoke-WebRequest -UseBasicParsing -Uri $BematechDriverUrl -OutFile $BematechDriverOutput
if (-not (Test-Path $BematechDriverOutput)) { throw "Driver Bematech não foi baixado: $BematechDriverOutput" }

& $MsBuild $SetupProject /t:Build /p:Configuration=Release /p:Platform=x86 /v:minimal
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o instalador." }
if (-not (Test-Path $SetupOutput)) { throw "Instalador não encontrado: $SetupOutput" }

Write-Host "Instalador criado em: $SetupOutput"
