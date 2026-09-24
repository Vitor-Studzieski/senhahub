param(
  [string]$InstallPath = (Join-Path $env:ProgramData "SenhaHub\PrintAgent"),
  [string]$TaskName = "SenhaHub - Agente de Impressao"
)

$ErrorActionPreference = "Stop"
$PackagePath = $PSScriptRoot
$AgentPath = $null
$ConfigPath = $null
$StatePath = $null
$InstallLog = $null

function Write-InstallLog {
  param([string]$Message)
  $line = "$(Get-Date -Format o) $Message"
  Write-Host $Message
  if ($InstallLog) { Add-Content -LiteralPath $InstallLog -Value $line -Encoding UTF8 }
}

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Abra o PowerShell como Administrador e execute install.ps1 novamente."
  }
}

function Find-PackageFile {
  param([string]$Name)
  $candidates = @(
    (Join-Path $PackagePath $Name),
    (Join-Path (Join-Path $PackagePath "artifacts") $Name)
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  return $null
}

function Set-ConfigValue {
  param([string]$FilePath, [string]$Name, [string]$Value)
  $lines = @(Get-Content -LiteralPath $FilePath -Encoding UTF8)
  $found = $false
  $updated = foreach ($line in $lines) {
    if ($line -match "^\s*$Name\s*=") {
      if (-not $found) { "$Name=$Value"; $found = $true }
    } else { $line }
  }
  if (-not $found) { $updated += "$Name=$Value" }
  [IO.File]::WriteAllLines($FilePath, [string[]]$updated, [System.Text.UTF8Encoding]::new($false))
}

function Configure-FirstRun {
  param([string]$FilePath)
  $apiUrl = Read-Host "URL HTTPS base do SenhaHub [https://senhahub.vercel.app]"
  if ([string]::IsNullOrWhiteSpace($apiUrl)) { $apiUrl = "https://senhahub.vercel.app" }
  $apiUrl = $apiUrl.Trim().TrimEnd('/')
  $parsedApiUrl = $null
  if (-not [Uri]::TryCreate($apiUrl, [UriKind]::Absolute, [ref]$parsedApiUrl) -or $parsedApiUrl.Scheme -ne "https") {
    throw "A URL precisa ser absoluta e usar HTTPS. Corrija PRINT_API_URL e execute novamente."
  }

  $printerPort = Read-Host "Porta serial da Bematech [COM4]"
  if ([string]::IsNullOrWhiteSpace($printerPort)) { $printerPort = "COM4" }
  $printerPort = $printerPort.Trim().ToUpperInvariant()
  if ($printerPort -notmatch '^COM\d+$') { throw "Informe uma porta válida no formato COM4, COM5 etc." }

  Set-ConfigValue -FilePath $FilePath -Name "PRINT_API_URL" -Value $apiUrl
  Set-ConfigValue -FilePath $FilePath -Name "KIOSK_PRINTER_PORT" -Value $printerPort
}

function Read-ConfiguredStateDirectory {
  param([string]$FilePath, [string]$Root)
  $line = Get-Content -LiteralPath $FilePath -Encoding UTF8 | Where-Object { $_ -match '^\s*PRINT_AGENT_STATE_DIR\s*=' } | Select-Object -Last 1
  $value = if ($line) { ($line -split '=', 2)[1].Trim() } else { Join-Path $Root 'data\print-agent' }
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if ([IO.Path]::IsPathRooted($value)) { return [IO.Path]::GetFullPath($value) }
  return [IO.Path]::GetFullPath((Join-Path $Root $value))
}

function Set-EnrollmentCode {
  param([string]$FilePath)
  Write-InstallLog "Primeira instalação: gere um código temporário novo no console SenhaHub agora. O código não será gravado no log."
  $secureCode = Read-Host "Cole o código atual do console (válido por 30 minutos)" -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureCode)
  try { $code = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  if ([string]::IsNullOrWhiteSpace($code)) { throw "Código de pareamento não informado. Gere um código novo no console e execute a instalação novamente." }
  if ($code -notmatch '^[A-Za-z0-9_-]{32}$') { throw "O código não tem o formato esperado. Gere outro no console SenhaHub e cole-o novamente." }

  Set-ConfigValue -FilePath $FilePath -Name "PRINT_ENROLLMENT_CODE" -Value $code
}

function Set-RestrictedAcl {
  param([string]$Path, [string[]]$AclArguments, [switch]$Recurse)
  $arguments = @($Path, "/inheritance:r", "/grant:r") + $AclArguments
  if ($Recurse) { $arguments += @("/T", "/C") }
  & icacls @arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível restringir as permissões de $Path (icacls $LASTEXITCODE). Use uma unidade NTFS local." }
}

function Invoke-AgentCommand {
  param([string[]]$Arguments, [string]$Description)
  Write-InstallLog "$Description..."
  $output = & $AgentPath @Arguments 2>&1
  $result = $LASTEXITCODE
  foreach ($line in $output) { if ([string]$line) { Write-InstallLog ([string]$line) } }
  if ($result -ne 0) { throw "$Description falhou com código $result." }
}

function Invoke-PreinstallDiagnostic {
  $arguments = @("--diagnose", "--local-only", "--preinstall", "--json")
  Write-InstallLog "Executando diagnóstico local antes de instalar a tarefa..."
  $output = & $AgentPath @arguments 2>&1
  $result = $LASTEXITCODE
  $text = ($output | ForEach-Object { [string]$_ }) -join "`n"
  $jsonStart = $text.IndexOf('{')
  $jsonEnd = $text.LastIndexOf('}')
  if ($jsonStart -lt 0 -or $jsonEnd -lt $jsonStart) { throw "O executável não retornou JSON de diagnóstico. Saída: $text" }
  $diagnostic = $text.Substring($jsonStart, $jsonEnd - $jsonStart + 1) | ConvertFrom-Json
  foreach ($finding in $diagnostic.findings) {
    if ($finding.level) { Write-InstallLog "[$($finding.level)] $($finding.title): $($finding.detail)" }
  }
  if ($result -ne 0) { throw "O diagnóstico local encontrou erros. Corrija os itens marcados antes da instalação." }
  $hasSession = @($diagnostic.findings | Where-Object { $_.title -eq "Sessão pareada" -and $_.level -eq "OK" }).Count -gt 0
  $hasLocalToken = @($diagnostic.findings | Where-Object { $_.title -eq "Credencial local" -and $_.level -eq "OK" }).Count -gt 0
  return ($hasSession -or $hasLocalToken)
}

function Get-LastBootstrap {
  param([string]$LogPath, [DateTime]$SinceUtc)
  if (-not (Test-Path -LiteralPath $LogPath)) { return $false }
  foreach ($line in (Get-Content -LiteralPath $LogPath -Tail 60)) {
    if ($line -match '^(?<timestamp>\S+) INFO Agente v2 iniciado\.') {
      try { if ([DateTime]::Parse($Matches.timestamp).ToUniversalTime() -ge $SinceUtc) { return $true } } catch { }
    }
  }
  return $false
}

try {
  Assert-Administrator
  $InstallPath = [IO.Path]::GetFullPath($InstallPath)
  $sourceAgent = Find-PackageFile "SenhaHub.PrintAgent.Node.exe"
  if (-not $sourceAgent) { throw "SenhaHub.PrintAgent.Node.exe não está ao lado do instalador nem na subpasta artifacts." }
  $sourceInstaller = Find-PackageFile "install.ps1"
  $sourceDiagnostic = Find-PackageFile "diagnose.ps1"
  $sourceExample = Find-PackageFile ".env.print-agent.example"
  if (-not $sourceExample) { $sourceExample = Join-Path (Split-Path -Parent (Split-Path -Parent $PackagePath)) ".env.print-agent.example" }
  if (-not (Test-Path -LiteralPath $sourceExample -PathType Leaf)) { throw "O modelo .env.print-agent.example não foi encontrado no pacote." }

  New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
  $AgentPath = Join-Path $InstallPath "SenhaHub.PrintAgent.Node.exe"
  $ConfigPath = Join-Path $InstallPath ".env.print-agent"
  if ([IO.Path]::GetFullPath($sourceAgent) -ine [IO.Path]::GetFullPath($AgentPath)) {
    Copy-Item -LiteralPath $sourceAgent -Destination $AgentPath -Force
  }
  $installedExample = Join-Path $InstallPath ".env.print-agent.example"
  if ([IO.Path]::GetFullPath($sourceExample) -ine [IO.Path]::GetFullPath($installedExample)) {
    Copy-Item -LiteralPath $sourceExample -Destination $installedExample -Force
  }
  if ($sourceInstaller -and [IO.Path]::GetFullPath($sourceInstaller) -ne [IO.Path]::GetFullPath((Join-Path $InstallPath "install.ps1"))) {
    Copy-Item -LiteralPath $sourceInstaller -Destination (Join-Path $InstallPath "install.ps1") -Force
  }
  $installedDiagnostic = Join-Path $InstallPath "diagnose.ps1"
  if ($sourceDiagnostic -and [IO.Path]::GetFullPath($sourceDiagnostic) -ine [IO.Path]::GetFullPath($installedDiagnostic)) {
    Copy-Item -LiteralPath $sourceDiagnostic -Destination $installedDiagnostic -Force
  }

  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    $sourceConfig = Find-PackageFile ".env.print-agent"
    if ($sourceConfig) { Copy-Item -LiteralPath $sourceConfig -Destination $ConfigPath }
    else { Copy-Item -LiteralPath (Join-Path $InstallPath ".env.print-agent.example") -Destination $ConfigPath }
    Configure-FirstRun -FilePath $ConfigPath
  }

  $configuredUrl = (Get-Content -LiteralPath $ConfigPath -Encoding UTF8 | Where-Object { $_ -match '^\s*PRINT_API_URL\s*=' } | Select-Object -Last 1) -split '=', 2 | Select-Object -Last 1
  $machineUrl = [Environment]::GetEnvironmentVariable("PRINT_API_URL", "Machine")
  if (-not [string]::IsNullOrWhiteSpace($machineUrl) -and $machineUrl.Trim().TrimEnd('/') -ne $configuredUrl.Trim().TrimEnd('/')) {
    throw "A variável de máquina PRINT_API_URL sobrescreve .env.print-agent. Corrija a variável de máquina ou deixe-a vazia antes de instalar."
  }

  $StatePath = Read-ConfiguredStateDirectory -FilePath $ConfigPath -Root $InstallPath
  New-Item -ItemType Directory -Force -Path $StatePath | Out-Null
  $InstallLog = Join-Path $StatePath "install.log"
  Write-InstallLog "Instalação autônoma do agente Node iniciada em $InstallPath."
  Write-InstallLog "O totem não precisa do código-fonte, Node.js, npm ou node_modules."

  Push-Location $InstallPath
  try { $hasCredential = Invoke-PreinstallDiagnostic }
  finally { Pop-Location }

  $runPrinterTest = Read-Host "Imprimir agora um cupom físico de teste? [s/N]"
  if ($runPrinterTest -match '^(s|sim)$') {
    Push-Location $InstallPath
    try { Invoke-AgentCommand -Arguments @("--test-printer") -Description "Imprimindo cupom de teste" }
    finally { Pop-Location }
  }

  if ($hasCredential) {
    Write-InstallLog "Credencial de dispositivo já encontrada; pareamento e journal serão preservados."
  } else {
    Set-EnrollmentCode -FilePath $ConfigPath
  }

  Set-RestrictedAcl -Path $InstallPath -AclArguments @("*S-1-5-18:(OI)(CI)(F)", "*S-1-5-32-544:(OI)(CI)(F)") -Recurse
  Set-RestrictedAcl -Path $ConfigPath -AclArguments @("*S-1-5-18:(R)", "*S-1-5-32-544:(M)")
  Set-RestrictedAcl -Path $StatePath -AclArguments @("*S-1-5-18:(OI)(CI)(F)", "*S-1-5-32-544:(OI)(CI)(F)") -Recurse

  $Action = New-ScheduledTaskAction -Execute $AgentPath -WorkingDirectory $InstallPath
  $Trigger = New-ScheduledTaskTrigger -AtStartup
  $Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $Settings = New-ScheduledTaskSettingsSet `
    -RestartCount 20 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

  Write-InstallLog "Registrando tarefa automática '$TaskName'."
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $Principal `
    -Settings $Settings `
    -Description "Agente Node SenhaHub autônomo para impressão na Bematech MP-4200 TH." `
    -Force | Out-Null

  $bootStartedAtUtc = [DateTime]::UtcNow
  Start-ScheduledTask -TaskName $TaskName
  Write-InstallLog "Tarefa iniciada. Aguardando bootstrap por até 45 segundos..."
  $deadline = (Get-Date).AddSeconds(45)
  $startupLog = Join-Path $StatePath "print-agent.log"
  $bootstrapped = $false
  while ((Get-Date) -lt $deadline) {
    if (Get-LastBootstrap -LogPath $startupLog -SinceUtc $bootStartedAtUtc) { $bootstrapped = $true; break }
    Start-Sleep -Seconds 3
  }
  if ($bootstrapped) {
    Write-InstallLog "Agente autenticado e iniciado."
  } else {
    Write-InstallLog "AVISO: ainda não houve bootstrap. Consulte print-agent.log e rode .\diagnose.ps1."
    if (Test-Path -LiteralPath $startupLog) { Get-Content -LiteralPath $startupLog -Tail 8 | ForEach-Object { Write-InstallLog ([string]$_) } }
  }

  Write-InstallLog "Instalação concluída. Tarefa: $TaskName; estado: $((Get-ScheduledTask -TaskName $TaskName).State)."
  Write-InstallLog "Instalação, configuração e estado: $InstallPath"
} catch {
  $failure = $_ | Out-String
  if ($InstallLog) { Add-Content -LiteralPath $InstallLog -Value "$(Get-Date -Format o) FALHA NA INSTALAÇÃO`n$failure" -Encoding UTF8 }
  Write-Error "Falha na instalação: $($_.Exception.Message)"
  if ($InstallLog) { Write-Host "Consulte o log: $InstallLog" }
  exit 1
}
