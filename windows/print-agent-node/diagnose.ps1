param(
  [string]$InstallPath = (Join-Path $env:ProgramData "SenhaHub\PrintAgent"),
  [switch]$LocalOnly,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
$InstallPath = [IO.Path]::GetFullPath($InstallPath)
$AgentPath = Join-Path $InstallPath "SenhaHub.PrintAgent.Node.exe"

if (-not (Test-Path -LiteralPath $AgentPath -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $PSScriptRoot "SenhaHub.PrintAgent.Node.exe") -PathType Leaf)) {
  $InstallPath = $PSScriptRoot
  $AgentPath = Join-Path $InstallPath "SenhaHub.PrintAgent.Node.exe"
}
if (-not (Test-Path -LiteralPath $AgentPath -PathType Leaf)) {
  throw "Executável não encontrado em $AgentPath. Instale pelo pacote standalone ou informe -InstallPath."
}

$arguments = @("--diagnose")
if ($LocalOnly) { $arguments += "--local-only" }
if ($Json) { $arguments += "--json" }
Push-Location $InstallPath
try {
  & $AgentPath @arguments
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
