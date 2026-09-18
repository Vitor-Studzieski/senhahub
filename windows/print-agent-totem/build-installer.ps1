$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$AgentProject = Join-Path $Root "SenhaHub.PrintAgent.Totem.csproj"
$SetupProject = Join-Path $Root "installer\SenhaHub.PrintAgent.Totem.Setup.csproj"
$AgentOutput = Join-Path $Root "bin\Release\SenhaHub.PrintAgent.Totem.exe"
$AgentVersion = "1.0.0"
$ArtifactsDirectory = Join-Path $Root "artifacts"
$VersionedAgentOutput = Join-Path $ArtifactsDirectory "SenhaHub.PrintAgent.Totem-mp4000-v$AgentVersion.exe"
$PayloadDirectory = Join-Path $Root "installer\payload"
$SetupOutput = Join-Path $Root "installer\bin\Release\SenhaHub.PrintAgent.Totem.Setup.exe"
$VersionedSetupOutput = Join-Path $ArtifactsDirectory "SenhaHub.PrintAgent.Totem.Setup-mp4000-v$AgentVersion.exe"

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
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o agente do totem." }
if (-not (Test-Path $AgentOutput)) { throw "Saída do agente não encontrada: $AgentOutput" }

New-Item -ItemType Directory -Force -Path $PayloadDirectory | Out-Null
Copy-Item $AgentOutput (Join-Path $PayloadDirectory "SenhaHub.PrintAgent.Totem.exe") -Force

& $MsBuild $SetupProject /t:Build /p:Configuration=Release /p:Platform=x86 /v:minimal
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o instalador do totem." }
if (-not (Test-Path $SetupOutput)) { throw "Instalador não encontrado: $SetupOutput" }

New-Item -ItemType Directory -Force -Path $ArtifactsDirectory | Out-Null
Copy-Item $AgentOutput $VersionedAgentOutput -Force
Copy-Item $SetupOutput $VersionedSetupOutput -Force

Write-Host "Agente criado em: $AgentOutput"
Write-Host "Instalador criado em: $SetupOutput"
Write-Host "Agente versionado criado em: $VersionedAgentOutput"
Write-Host "Instalador versionado criado em: $VersionedSetupOutput"
