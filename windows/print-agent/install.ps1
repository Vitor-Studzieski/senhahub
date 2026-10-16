param(
  [string]$ProjectPath = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$TaskName = "SenhaHub - Agente de Impressao"
)

$ErrorActionPreference = "Stop"
$InstallLog = $null

function Write-InstallLog {
  param([string]$Message)
  $line = "$(Get-Date -Format o) $Message"
  Write-Host $Message
  if ($InstallLog) { Add-Content -LiteralPath $InstallLog -Value $line -Encoding UTF8 }
}

function Invoke-LoggedCommand {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$Description
  )
  Write-InstallLog "$Description..."
  $output = & $FilePath @Arguments 2>&1
  $result = $LASTEXITCODE
  foreach ($line in $output) { Write-InstallLog ([string]$line) }
  if ($result -ne 0) { throw "$Description terminou com o código $result." }
}

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Abra o PowerShell como Administrador e execute novamente."
  }
}

function Set-RestrictedAcl {
  param([string]$Path, [string[]]$AclArguments, [switch]$Recurse)
  $icaclsArguments = @($Path, "/inheritance:r", "/grant:r") + $AclArguments
  if ($Recurse) { $icaclsArguments += @("/T", "/C") }
  & icacls @icaclsArguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível restringir as permissões de $Path (icacls $LASTEXITCODE)." }
}

function Read-ConfiguredStateDirectory {
  param([string]$ConfigPath, [string]$ProjectRoot)
  $line = Get-Content -LiteralPath $ConfigPath -Encoding UTF8 | Where-Object { $_ -match '^\s*PRINT_AGENT_STATE_DIR\s*=' } | Select-Object -Last 1
  $value = if ($line) { ($line -split '=', 2)[1].Trim() } else { Join-Path $ProjectRoot 'data\print-agent' }
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if ([IO.Path]::IsPathRooted($value)) { return [IO.Path]::GetFullPath($value) }
  return [IO.Path]::GetFullPath((Join-Path $ProjectRoot $value))
}

function Set-EnrollmentCode {
  param([string]$ConfigPath)
  Write-InstallLog "A primeira instalação precisa de um código temporário novo, gerado agora no console SenhaHub. O código não será gravado no log."
  $secureCode = Read-Host "Gere o código no console SenhaHub e cole aqui (válido por 10 minutos)" -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureCode)
  try { $code = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  if ([string]::IsNullOrWhiteSpace($code)) { throw "O código de pareamento não foi informado. Gere um código novo no console e execute a instalação novamente." }
  if ($code -notmatch '^[A-Za-z0-9_-]{32}$') { throw "O código informado não tem o formato esperado. Gere um código novo no console SenhaHub e cole-o novamente." }

  $lines = @(Get-Content -LiteralPath $ConfigPath -Encoding UTF8)
  $found = $false
  $updated = foreach ($line in $lines) {
    if ($line -match '^\s*PRINT_ENROLLMENT_CODE\s*=') {
      if (-not $found) { "PRINT_ENROLLMENT_CODE=$code"; $found = $true }
    } else { $line }
  }
  if (-not $found) { $updated += "PRINT_ENROLLMENT_CODE=$code" }
  [IO.File]::WriteAllLines($ConfigPath, [string[]]$updated, [System.Text.UTF8Encoding]::new($false))
}

function Invoke-PreinstallDiagnostic {
  param([string]$NodePath, [string]$ProjectRoot)
  $scriptPath = Join-Path $ProjectRoot "scripts\print-agent\diagnostic.js"
  Write-InstallLog "Executando diagnóstico local antes da instalação..."
  $output = & $NodePath $scriptPath "--local-only" "--preinstall" "--json" 2>&1
  $result = $LASTEXITCODE
  $text = ($output | ForEach-Object { [string]$_ }) -join "`n"
  foreach ($line in ($text -split "`r?`n")) { if ($line) { Write-InstallLog $line } }
  $jsonStart = $text.IndexOf('{')
  $jsonEnd = $text.LastIndexOf('}')
  if ($jsonStart -lt 0 -or $jsonEnd -lt $jsonStart) { throw "O diagnóstico local não retornou JSON válido." }
  $diagnostic = $text.Substring($jsonStart, $jsonEnd - $jsonStart + 1) | ConvertFrom-Json
  foreach ($finding in $diagnostic.findings) {
    if ($finding.level) { Write-InstallLog "[$($finding.level)] $($finding.title): $($finding.detail)" }
  }
  if ($result -ne 0) { throw "Diagnóstico local encontrou erros. Corrija os itens marcados acima ou no log antes de instalar." }
  $hasSession = @($diagnostic.findings | Where-Object { $_.title -eq "Sessão pareada" -and $_.level -eq "OK" }).Count -gt 0
  $hasLocalToken = @($diagnostic.findings | Where-Object { $_.title -eq "Credencial local" -and $_.level -eq "OK" }).Count -gt 0
  return ($hasSession -or $hasLocalToken)
}

try {
  Assert-Administrator
  $ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
  $AgentPath = Join-Path $ProjectPath "scripts\print-agent.js"
  $ConfigPath = Join-Path $ProjectPath ".env.print-agent"

  if (-not (Test-Path -LiteralPath $AgentPath)) { throw "Agente não encontrado em $AgentPath" }
  if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Crie $ConfigPath usando .env.print-agent.example antes de instalar." }

  $StatePath = Read-ConfiguredStateDirectory -ConfigPath $ConfigPath -ProjectRoot $ProjectPath
  New-Item -ItemType Directory -Force -Path $StatePath | Out-Null
  $InstallLog = Join-Path $StatePath "install.log"
  Write-InstallLog "Instalação iniciada. Projeto: $ProjectPath."

  $NodeCommand = Get-Command node.exe -ErrorAction Stop
  $NodePath = $NodeCommand.Source
  $NodeVersion = (& $NodePath --version).Trim()
  $ParsedNodeVersion = [version]$NodeVersion.TrimStart('v')
  if ($ParsedNodeVersion.Major -ne 22 -or $ParsedNodeVersion.Minor -lt 13) { throw "Node.js 22.13 ou superior dentro da série 22.x é obrigatório. Encontrado: $NodeVersion ($NodePath). Instale Node 22 LTS atualizado e reabra o PowerShell." }
  $NpmCommand = Get-Command npm.cmd -ErrorAction Stop
  $NpmPath = $NpmCommand.Source
  Write-InstallLog "Node $NodeVersion; executável: $NodePath; npm: $NpmPath."

  Push-Location $ProjectPath
  try {
    Invoke-LoggedCommand -FilePath $NpmPath -Arguments @("--version") -Description "Lendo versão do npm"
    Invoke-LoggedCommand -FilePath $NpmPath -Arguments @("ci", "--omit=dev") -Description "Instalando dependências travadas do projeto"
    Invoke-LoggedCommand -FilePath $NodePath -Arguments @("--check", $AgentPath) -Description "Validando sintaxe do agente"
  } finally {
    Pop-Location
  }

  Push-Location $ProjectPath
  try {
    $hasExistingCredential = Invoke-PreinstallDiagnostic -NodePath $NodePath -ProjectRoot $ProjectPath
  } finally {
    Pop-Location
  }

  if ($hasExistingCredential) {
    Write-InstallLog "Credencial de dispositivo já encontrada; pareamento e journal serão preservados."
  } else {
    Set-EnrollmentCode -ConfigPath $ConfigPath
  }

  Set-RestrictedAcl -Path $ConfigPath -AclArguments @("*S-1-5-18:(R)", "*S-1-5-32-544:(M)")
  Set-RestrictedAcl -Path $StatePath -AclArguments @("*S-1-5-18:(OI)(CI)(F)", "*S-1-5-32-544:(OI)(CI)(F)") -Recurse

  $Arguments = "`"$(Join-Path $ProjectPath 'scripts\print-agent.js')`""
  $Action = New-ScheduledTaskAction -Execute $NodePath -Argument $Arguments -WorkingDirectory $ProjectPath
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
    -Description "Consome a fila do SenhaHub e imprime senhas na Bematech MP-4200 TH." `
    -Force | Out-Null

  $bootStartedAtUtc = [DateTime]::UtcNow
  Start-ScheduledTask -TaskName $TaskName
  Write-InstallLog "Tarefa iniciada. Aguardando o primeiro bootstrap e pareamento por até 45 segundos..."
  $deadline = (Get-Date).AddSeconds(45)
  $startupLog = Join-Path $StatePath "print-agent.log"
  $bootstrapped = $false
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $startupLog) {
      foreach ($line in (Get-Content -LiteralPath $startupLog -Tail 40)) {
        if ($line -match '^(?<timestamp>\S+) INFO Agente v2 iniciado\.') {
          try {
            if ([DateTime]::Parse($Matches.timestamp).ToUniversalTime() -ge $bootStartedAtUtc) { $bootstrapped = $true }
          } catch { }
        }
      }
      if ($bootstrapped) { break }
    }
    Start-Sleep -Seconds 3
  }

  if ($bootstrapped) {
    Write-InstallLog "Agente autenticado e iniciado."
  } else {
    Write-InstallLog "AVISO: ainda não houve bootstrap autenticado. O agente permanece tentando; consulte print-agent.log e execute npm run print:agent:diagnose."
    if (Test-Path -LiteralPath $startupLog) {
      Get-Content -LiteralPath $startupLog -Tail 8 | ForEach-Object { Write-InstallLog ([string]$_) }
    }
  }

  Write-InstallLog "Instalação concluída. Tarefa: $TaskName; estado: $((Get-ScheduledTask -TaskName $TaskName).State)."
  Write-InstallLog "Diagnóstico: npm run print:agent:diagnose"
  Write-InstallLog "Logs: $StatePath\install.log e $StatePath\print-agent.log"
} catch {
  $failure = $_ | Out-String
  if ($InstallLog) { Add-Content -LiteralPath $InstallLog -Value "$(Get-Date -Format o) FALHA NA INSTALAÇÃO`n$failure" -Encoding UTF8 }
  Write-Error "Falha na instalação: $($_.Exception.Message)"
  if ($InstallLog) { Write-Host "Consulte o log: $InstallLog" }
  exit 1
}
