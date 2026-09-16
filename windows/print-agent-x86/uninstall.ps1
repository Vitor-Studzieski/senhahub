param([string]$ServiceName = "SenhaHubPrintAgentX86")

$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Abra o PowerShell como Administrador." }
& sc.exe stop $ServiceName 2>$null | Out-Null
& sc.exe delete $ServiceName 2>$null | Out-Null
Write-Host "Serviço do agente x86 removido do início automático."
