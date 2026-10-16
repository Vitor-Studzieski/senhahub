param(
  [string]$ProjectPath = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$OutputPath = (Join-Path $PSScriptRoot "installer\payload\SenhaHub.PrintAgent.Node.exe"),
  [string]$PairingCode = ""
)

$ErrorActionPreference = "Stop"
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$InstallerProjectPath = Join-Path $PSScriptRoot "installer\SenhaHub.PrintAgent.Node.Setup.csproj"
$InstallerPayloadPath = Join-Path $PSScriptRoot "installer\payload\SenhaHub.PrintAgent.Node.exe"
$InstallerOutputPath = Join-Path $PSScriptRoot "installer\bin\Release\SenhaHub.PrintAgent.Node-Setup.exe"
$InstallerArtifactPath = Join-Path $PSScriptRoot "artifacts\SenhaHub.PrintAgent.Node-Setup.exe"
$DriverDirectory = Join-Path $PSScriptRoot "installer\driver"
$OutputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

if ([string]::IsNullOrWhiteSpace($PairingCode)) { throw "Informe um código temporário válido com -PairingCode. O instalador de distribuição não será gerado com o campo de pareamento vazio." }
if ($PairingCode -notmatch '^[A-Za-z0-9_-]{32}$') { throw "O código de pareamento precisa ter 32 caracteres." }
foreach ($driverFile in @("bematech-usbcom.inf", "bematech-usbcom.cat", "bematech-usbcom.sys")) {
  if (-not (Test-Path -LiteralPath (Join-Path $DriverDirectory $driverFile))) { throw "Arquivo do driver x64 não encontrado: $driverFile" }
}

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
if ([IO.Path]::GetFullPath($OutputPath) -ne [IO.Path]::GetFullPath($InstallerPayloadPath)) {
  Copy-Item -LiteralPath $OutputPath -Destination $InstallerPayloadPath -Force
}
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

$hash = (Get-FileHash -LiteralPath $InstallerArtifactPath -Algorithm SHA256).Hash
Write-Host "Instalador autônomo: $InstallerArtifactPath"
Write-Host "SHA-256: $hash"
