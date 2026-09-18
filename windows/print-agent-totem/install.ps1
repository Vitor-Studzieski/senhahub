param(
  [string]$AgentDirectory = $PSScriptRoot,
  [string]$ServiceName = "SenhaHubPrintAgentTotem"
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Abra o PowerShell como Administrador e execute novamente."
  }
}

Assert-Administrator
$AgentDirectory = (Resolve-Path $AgentDirectory).Path
$Executable = Join-Path $AgentDirectory "SenhaHub.PrintAgent.Totem.exe"
$Config = Join-Path $AgentDirectory "agent.env"
$Release = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" -ErrorAction SilentlyContinue).Release

if (-not (Test-Path $Executable)) { throw "Executável não encontrado: $Executable" }
if (-not (Test-Path $Config)) { throw "Crie agent.env a partir de agent.env.example antes de instalar." }
if ($Release -and $Release -lt 528040) { throw ".NET Framework 4.8 ou superior é necessário." }

$stateDirectory = Join-Path $AgentDirectory "data\print-agent-totem"
New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
& icacls $Config /inheritance:r /grant:r "*S-1-5-18:(R)" "*S-1-5-32-544:(R)" | Out-Null
& icacls $stateDirectory /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)(F)" "*S-1-5-32-544:(OI)(CI)(F)" /T | Out-Null

& sc.exe stop $ServiceName 2>$null | Out-Null
& sc.exe delete $ServiceName 2>$null | Out-Null
Start-Sleep -Seconds 1
$BinPath = '"' + $Executable + '" --service'
& sc.exe create $ServiceName "binPath= $BinPath" "start= auto" "obj= LocalSystem" "DisplayName= SenhaHub Print Agent Totem MP-4000 TH FI" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Não foi possível criar o serviço $ServiceName." }
& sc.exe description $ServiceName "Serviço de impressão do Totem SenhaHub para Bematech MP-4000 TH FI." | Out-Null
& sc.exe start $ServiceName | Out-Null
Write-Host "Agente do totem instalado e iniciado."
Write-Host "Logs: $stateDirectory\print-agent-totem.log"
