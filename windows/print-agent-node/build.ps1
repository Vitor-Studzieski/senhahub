param(
  [string]$ProjectPath = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$OutputPath = (Join-Path $PSScriptRoot "artifacts\SenhaHub.PrintAgent.Node.exe"),
  [string]$SetupPath = (Join-Path $PSScriptRoot "artifacts\SenhaHub.PrintAgent.Node-Setup.zip"),
  [string]$PairingCode = ""
)

$ErrorActionPreference = "Stop"
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$SetupPath = [IO.Path]::GetFullPath($SetupPath)
$InstallerProjectPath = Join-Path $PSScriptRoot "installer\SenhaHub.PrintAgent.Node.Setup.csproj"
$InstallerPayloadPath = Join-Path $PSScriptRoot "installer\payload\SenhaHub.PrintAgent.Node.exe"
$InstallerOutputPath = Join-Path $PSScriptRoot "installer\bin\Release\SenhaHub.PrintAgent.Node-Setup.exe"
$InstallerArtifactPath = Join-Path $PSScriptRoot "artifacts\SenhaHub.PrintAgent.Node-Setup.exe"
$OutputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

Push-Location $ProjectPath
try {
  $Npx = Get-Command npx.cmd -ErrorAction Stop
  & $Npx.Source --yes "@yao-pkg/pkg@6.22.0" scripts/print-agent.js `
    --config windows/print-agent-node/package.json `
    --targets node24-win-x64 `
    --output $OutputPath `
    --no-bytecode `
    --public
  if ($LASTEXITCODE -ne 0) { throw "O empacotamento terminou com o código $LASTEXITCODE." }
} finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $OutputPath)) { throw "O executável não foi criado em $OutputPath." }
if (-not (Test-Path -LiteralPath (Join-Path $ProjectPath ".env.print-agent.example"))) { throw "O modelo .env.print-agent.example não foi encontrado no repositório." }
if (-not [string]::IsNullOrWhiteSpace($PairingCode) -and $PairingCode -notmatch '^[A-Za-z0-9_-]{32}$') { throw "O código de pareamento precisa ter 32 caracteres." }

$MsBuildPath = (Get-Command msbuild.exe -ErrorAction SilentlyContinue).Source
if (-not $MsBuildPath) {
  $vsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path -LiteralPath $vsWhere) {
    $found = & $vsWhere -latest -products * -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\MSBuild.exe | Select-Object -First 1
    if ($found) { $MsBuildPath = $found }
  }
}
if (-not $MsBuildPath) { throw "MSBuild não encontrado. Execute em Windows com Visual Studio ou Build Tools instalados para criar o instalador gráfico." }

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallerPayloadPath) | Out-Null
Copy-Item -LiteralPath $OutputPath -Destination $InstallerPayloadPath -Force
$PairingCodeResourcePath = Join-Path $PSScriptRoot "installer\pairing-code.txt"
[IO.File]::WriteAllText($PairingCodeResourcePath, $PairingCode, [Text.UTF8Encoding]::new($false))
try {
  & $MsBuildPath $InstallerProjectPath /t:Build /p:Configuration=Release /p:Platform=x64 /v:minimal
  if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o instalador gráfico Node." }
  if (-not (Test-Path -LiteralPath $InstallerOutputPath)) { throw "Instalador gráfico não encontrado: $InstallerOutputPath" }
  Copy-Item -LiteralPath $InstallerOutputPath -Destination $InstallerArtifactPath -Force
} finally {
  if (Test-Path -LiteralPath $InstallerPayloadPath) { Remove-Item -LiteralPath $InstallerPayloadPath -Force }
  if (Test-Path -LiteralPath $PairingCodeResourcePath) { Remove-Item -LiteralPath $PairingCodeResourcePath -Force }
}

$StagePath = Join-Path $env:TEMP ("SenhaHub.PrintAgent.Node.Setup." + [guid]::NewGuid().ToString("N"))
try {
  New-Item -ItemType Directory -Force -Path $StagePath | Out-Null
  Copy-Item -LiteralPath $OutputPath -Destination (Join-Path $StagePath "SenhaHub.PrintAgent.Node.exe")
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "install.ps1") -Destination (Join-Path $StagePath "install.ps1")
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "diagnose.ps1") -Destination (Join-Path $StagePath "diagnose.ps1")
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "README.md") -Destination (Join-Path $StagePath "LEIA-ME.md")
  Copy-Item -LiteralPath (Join-Path $ProjectPath ".env.print-agent.example") -Destination (Join-Path $StagePath ".env.print-agent.example")
  $SetupDirectory = Split-Path -Parent $SetupPath
  New-Item -ItemType Directory -Force -Path $SetupDirectory | Out-Null
  Compress-Archive -Path (Join-Path $StagePath "*") -DestinationPath $SetupPath -CompressionLevel Optimal -Force
} finally {
  if (Test-Path -LiteralPath $StagePath) { Remove-Item -LiteralPath $StagePath -Recurse -Force }
}

$hash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash
$zipHash = (Get-FileHash -LiteralPath $SetupPath -Algorithm SHA256).Hash
Write-Host "Executável: $OutputPath"
Write-Host "SHA-256: $hash"
Write-Host "Instalador gráfico: $InstallerArtifactPath"
Write-Host "Pacote autônomo: $SetupPath"
Write-Host "SHA-256 do pacote: $zipHash"
