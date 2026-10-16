const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadAgentEnvironment, readAgentConfiguration, redactText } = require('./runtime');

const TASK_NAME = 'SenhaHub - Agente de Impressao';
const PACKAGED = Boolean(process.pkg);
const findings = [];
let hasErrors = false;
let hasWarnings = false;

async function runDiagnostics({ root = process.cwd(), localOnly = false, preinstall = false } = {}) {
  findings.length = 0;
  hasErrors = false;
  hasWarnings = false;
  root = path.resolve(root);
  const envPath = process.env.PRINT_AGENT_CONFIG || path.join(root, '.env.print-agent');
  let statePathFromEnv = process.env.PRINT_AGENT_STATE_DIR;
  let config;
  let savedAuth = null;
  let taskStatus = null;
  let enrollmentCodePresent = false;

  section('SISTEMA E INSTALAÇÃO');
  report('INFO', 'Gerado em', new Date().toLocaleString());
  report('INFO', 'Computador / usuário', `${os.hostname()} / ${os.userInfo().username}`);
  report('INFO', 'Windows ligado há', `${formatDuration(os.uptime())} (desde aproximadamente ${new Date(Date.now() - os.uptime() * 1000).toLocaleString()})`);
  report(process.platform === 'win32' ? 'OK' : 'WARN', 'Sistema operacional', `${os.type()} ${os.release()} (${process.arch})`);

  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  const supportedNode = PACKAGED ? nodeMajor === 24 : nodeMajor === 22 && nodeMinor >= 13;
  report(supportedNode ? 'OK' : 'ERROR', PACKAGED ? 'Runtime do executável' : 'Node.js', PACKAGED
    ? `Runtime Node ${process.versions.node} incluído no .exe.`
    : `v${process.versions.node}; este agente requer Node 22.13 ou superior dentro da série 22.x.`);
  if (PACKAGED) {
    report(fs.existsSync(process.execPath) ? 'OK' : 'ERROR', 'Executável do agente', process.execPath);
  } else {
    const lockfile = path.join(root, 'package-lock.json');
    const agentFile = path.join(root, 'scripts', 'print-agent.js');
    const modulesDir = path.join(root, 'node_modules');
    report(fs.existsSync(lockfile) ? 'OK' : 'ERROR', 'Lockfile do projeto', fs.existsSync(lockfile) ? 'package-lock.json encontrado.' : 'package-lock.json ausente; npm ci não pode instalar dependências travadas.');
    report(fs.existsSync(agentFile) ? 'OK' : 'ERROR', 'Arquivo do agente', agentFile);
    report(fs.existsSync(modulesDir) ? 'OK' : 'ERROR', 'Dependências locais', fs.existsSync(modulesDir) ? 'node_modules encontrado.' : 'Execute npm ci --omit=dev na pasta do projeto.');
  }

  if (!fs.existsSync(envPath)) {
    report('ERROR', 'Arquivo de configuração', `Não encontrei ${envPath}. Copie .env.print-agent.example para .env.print-agent.`);
  } else {
    try {
      loadAgentEnvironment(envPath);
      statePathFromEnv = process.env.PRINT_AGENT_STATE_DIR;
      config = readAgentConfiguration();
      report('OK', 'Configuração', `Arquivo lido; servidor ${safeHost(config.apiUrl)}; porta ${config.printerPort}; ${config.realtimeEnabled ? 'Realtime habilitado' : 'Realtime desabilitado'}. Valores secretos foram omitidos.`);
      if (config.localToken) report('OK', 'Credencial local', 'Token local configurado; valor omitido.');
      enrollmentCodePresent = Boolean(process.env.PRINT_ENROLLMENT_CODE);
    } catch (error) {
      report('ERROR', 'Configuração', `${redactText(error.message || error)} Confira ${envPath}.`);
    }
  }

  try {
    let SerialPort;
    if (PACKAGED) {
      ({ SerialPort } = require('serialport'));
    } else {
      require.resolve('serialport', { paths: [root] });
      ({ SerialPort } = require(path.join(root, 'node_modules', 'serialport')));
    }
    const ports = await SerialPort.list();
    const available = ports.map((port) => port.path).filter(Boolean).sort();
    report(available.length ? 'OK' : 'WARN', 'Portas seriais', available.length ? available.join(', ') : 'Nenhuma porta COM foi listada. Verifique USB, driver e Gerenciador de Dispositivos.');
    if (config) {
      report(available.some((port) => port.toUpperCase() === config.printerPort.toUpperCase()) ? 'OK' : 'ERROR', 'Porta configurada', available.some((port) => port.toUpperCase() === config.printerPort.toUpperCase()) ? `${config.printerPort} encontrada.` : `${config.printerPort} não aparece na lista. Confira driver, cabo e KIOSK_PRINTER_PORT.`);
    }
  } catch (error) {
    report('ERROR', 'Módulo serialport', PACKAGED
      ? `${redactText(error.message || error)} O executável pode estar incompleto ou o antivírus pode ter bloqueado o módulo serial.`
      : `${redactText(error.message || error)} Rode npm ci --omit=dev; se o erro mencionar módulo nativo, confirme que o Node usado é o mesmo da instalação.`);
  }

  const stateDir = config?.stateDir || path.resolve(statePathFromEnv || path.join(root, 'data', 'print-agent'));
  section('ESTADO LOCAL E REGISTROS');
  report(fs.existsSync(stateDir) ? 'OK' : 'WARN', 'Pasta de estado', fs.existsSync(stateDir) ? stateDir : `${stateDir} ainda não existe.`);
  const stateDb = path.join(stateDir, 'agent-v2.sqlite');
  if (fs.existsSync(stateDb)) {
    try {
      const inspection = inspectStateDatabase(stateDb);
      savedAuth = inspection.auth;
      report('OK', 'Journal SQLite', `${inspection.unacknowledged} execução(ões) local(is) sem confirmação; ${inspection.acknowledged} confirmada(s).`);
      if (inspection.unacknowledged > 0) {
        for (const row of inspection.pending.slice(0, 8)) {
          report(row.outcome === 'unknown' ? 'ERROR' : 'WARN', 'Execução local pendente', `fase ${row.phase}; resultado ${row.outcome || 'aguardando'}${row.error ? `; ${redactText(row.error)}` : ''}. O diagnóstico não altera o journal.`);
        }
      }
      if (inspection.auth) report('OK', 'Sessão pareada', 'Conexão e sessão salvas no SQLite; os valores foram omitidos.');
      else if (inspection.connection) report('WARN', 'Sessão pareada', 'Conexão local encontrada, mas não encontrei uma sessão válida salva.');
    } catch (error) {
      report('WARN', 'Journal SQLite', `Não foi possível ler sem alterações: ${redactText(error.message || error)}. Execute o diagnóstico como administrador se a pasta estiver restrita.`);
    }
  } else {
    report('WARN', 'Journal SQLite', 'Ainda não há agent-v2.sqlite. O agente cria esse arquivo ao iniciar o pareamento.');
  }

  if (config && !config.localToken && !savedAuth?.session?.access_token) {
    if (enrollmentCodePresent && /^[A-Za-z0-9_-]{32}$/.test(process.env.PRINT_ENROLLMENT_CODE)) {
      report('OK', 'Pareamento inicial', 'Código configurado; o diagnóstico não vai consumi-lo.');
    } else if (preinstall) {
      report('INFO', 'Pareamento inicial', 'Nenhuma sessão salva ou código válido. O instalador vai solicitar um código novo do console SenhaHub.');
    } else if (enrollmentCodePresent) {
      report('ERROR', 'Código de pareamento', 'Formato inválido. Gere um código novo no console SenhaHub; o valor foi omitido.');
    } else {
      report('ERROR', 'Pareamento inicial', 'Não encontrei uma sessão local nem código temporário. Gere um código novo no console SenhaHub e informe-o ao instalador antes da primeira inicialização.');
    }
  }

  inspectLog(path.join(stateDir, 'print-agent.log'), 'Log do agente');
  inspectLog(path.join(stateDir, 'print-agent.log.1'), 'Log anterior do agente', true);
  // This file is intentionally created only for startup failures, so absence is normal.
  inspectLog(path.join(stateDir, 'agent-startup.log'), 'Falhas de inicialização', true);
  inspectLog(path.join(stateDir, 'install.log'), 'Log de instalação');

  if (process.platform === 'win32') {
    inspectWindowsAcl(envPath, stateDir);
    if (!preinstall) taskStatus = inspectWindowsTask(root, PACKAGED);
    inspectPowerEvents();
  } else {
    report('INFO', 'Tarefa do Windows', 'Disponível quando este diagnóstico é executado no Windows.');
  }

  section('CONEXÃO COM O SENHAHUB');
  if (localOnly) {
    report('INFO', 'Servidor', 'Consulta remota omitida por --local-only.');
  } else if (!config) {
    report('WARN', 'Servidor', 'Corrija a configuração para testar a API.');
  } else {
    const token = config.localToken || savedAuth?.session?.access_token;
    if (!token) {
      report('WARN', 'Autenticação remota', process.env.PRINT_ENROLLMENT_CODE
        ? 'Sem sessão salva. O código de pareamento está configurado, mas este diagnóstico não o consome; inicie o agente para parear.'
        : 'Sem sessão/token salvo. O servidor não foi consultado.');
    } else {
      try {
        const response = await fetch(`${config.apiUrl}/api/print/v2/bootstrap`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-print-agent-version': 'node/2.0.0' },
          body: '{}',
          signal: AbortSignal.timeout(15000)
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const status = response.status === 401 || response.status === 403 || response.status === 503 ? 'ERROR' : 'WARN';
          report(status, 'Autenticação e bootstrap', `HTTP ${response.status}${body.error ? `: ${redactText(body.error)}` : ''}. Confira sessão, vínculo do dispositivo, horário do Windows e disponibilidade da API.`);
        } else {
          const device = body.device || {};
          report('OK', 'Autenticação e bootstrap', `API respondeu; dispositivo ${device.id || 'vinculado'}; ${body.transport || 'transporte informado pelo servidor'}. Nenhum trabalho foi reivindicado.`);
          await inspectRemoteQueue(config.apiUrl, token, taskStatus);
        }
      } catch (error) {
        report('WARN', 'Conexão com a API', `${redactText(error.message || error)} Confira internet, DNS, certificado e horário do Windows.`);
      }
    }
  }

  section('INTERPRETAÇÃO');
  report('INFO', 'Impressão física', PACKAGED
    ? 'A enumeração da porta não testa papel, cabo, comunicação física ou corte. Use SenhaHub.PrintAgent.Node.exe --test-printer somente depois de confirmar a porta e quando puder recolher o cupom de teste.'
    : 'A enumeração da porta não testa papel, cabo, comunicação física ou corte. Use npm run print:agent:test somente depois de confirmar a porta e quando puder recolher o cupom de teste.');
  report('INFO', 'Proteção da fila', 'O diagnóstico não imprime nem reivindica trabalhos. Se a tarefa estiver parada, consulta recover para mostrar o estado e aplicar a recuperação normal de leases vencidos; se estiver em execução, essa consulta é pulada.');
  return { findings, hasErrors, hasWarnings };
}

function inspectStateDatabase(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('SELECT key, value FROM state').all();
    const values = new Map(rows.map((row) => [row.key, parseStored(row.value)]));
    const connection = values.get('connection');
    let session = findSession(values.get('session'));
    for (const value of values.values()) session ||= findSession(value);
    const counts = db.prepare('SELECT acknowledged, COUNT(*) AS count FROM executions GROUP BY acknowledged').all();
    const pending = db.prepare('SELECT phase, outcome, error FROM executions WHERE acknowledged=0 ORDER BY rowid DESC LIMIT 8').all();
    return {
      connection: Boolean(connection),
      auth: connection && session ? { connection, session } : null,
      unacknowledged: Number(counts.find((item) => item.acknowledged === 0)?.count || 0),
      acknowledged: Number(counts.find((item) => item.acknowledged === 1)?.count || 0),
      pending
    };
  } finally {
    db.close();
  }
}

function parseStored(value) {
  try { return JSON.parse(value); } catch { return value; }
}

function findSession(value) {
  if (typeof value === 'string') return findSession(parseStored(value));
  if (!value || typeof value !== 'object') return null;
  if (typeof value.access_token === 'string') return value;
  if (value.currentSession) return findSession(value.currentSession);
  return null;
}

function inspectWindowsTask(root, packaged = false) {
  const processQuery = packaged
    ? `$processes=@(Get-CimInstance Win32_Process -Filter "Name='SenhaHub.PrintAgent.Node.exe'" | Where-Object { $_.ProcessId -ne ${process.pid} } | Select-Object ProcessId,Name,ExecutablePath);`
    : `$processes=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -like '*scripts\\print-agent.js*' } | Select-Object ProcessId,Name,ExecutablePath);`;
  const command = `$ErrorActionPreference='SilentlyContinue'; $task=Get-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue; $info=Get-ScheduledTaskInfo -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue; $action=$task.Actions|Select-Object -First 1; ${processQuery} if(!$task){ [pscustomobject]@{exists=$false;available=$true;state='Missing';processes=$processes}|ConvertTo-Json -Compress -Depth 4; exit }; [pscustomobject]@{exists=$true;available=$true;state=[string]$task.State;execute=[string]$action.Execute;arguments=[string]$action.Arguments;workingDirectory=[string]$action.WorkingDirectory;lastTaskResult=$info.LastTaskResult;lastRunTime=[string]$info.LastRunTime;restartCount=$task.Settings.RestartCount;restartInterval=[string]$task.Settings.RestartInterval;processes=$processes}|ConvertTo-Json -Compress -Depth 4`;
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 12000, windowsHide: true });
  if (result.error || result.status !== 0) {
    report('WARN', 'Tarefa do Agendador', `Não consegui consultar ${TASK_NAME}: ${redactText(result.error?.message || result.stderr || `código ${result.status}`)}.`);
    return { available: false, state: 'Unknown', processCount: null };
  }
  try {
    const task = JSON.parse(result.stdout.trim() || '{}');
    if (!task.exists) {
      report('ERROR', 'Tarefa do Agendador', `${TASK_NAME} não foi encontrada. Execute o instalador do agente como administrador.`);
      const processes = Array.isArray(task.processes) ? task.processes : task.processes ? [task.processes] : [];
      report(processes.length ? 'OK' : 'WARN', 'Processo do agente', processes.length ? `${processes.length} processo(s) encontrado(s) fora da tarefa.` : 'Nenhum processo do agente está ativo.');
      return { available: true, exists: false, state: 'Missing', processCount: processes.length };
    }
    const expectedAction = packaged ? process.execPath.toLowerCase() : path.join(root, 'scripts', 'print-agent.js').toLowerCase();
    const actionMatches = (packaged
      ? path.resolve(task.execute || '').toLowerCase() === expectedAction
      : String(task.arguments || '').toLowerCase().includes(expectedAction))
      && path.resolve(task.workingDirectory || '').toLowerCase() === path.resolve(root).toLowerCase();
    report(actionMatches ? 'OK' : 'ERROR', 'Ação da tarefa', `${task.execute} ${task.arguments}; pasta ${task.workingDirectory}${actionMatches ? '' : '; caminho diferente do projeto diagnosticado'}.`);
    report(task.state === 'Running' ? 'OK' : ['Ready', 'Disabled'].includes(task.state) ? 'ERROR' : 'WARN', 'Estado da tarefa', `${task.state}; última execução ${task.lastRunTime || 'ainda não registrada'}; resultado ${formatTaskResult(task.lastTaskResult)}.${task.state === 'Ready' ? ' Inicie a tarefa após corrigir a causa do último erro.' : ''}`);
    report(Number(task.restartCount) >= 1 ? 'OK' : 'WARN', 'Recuperação automática', `${task.restartCount || 0} reinício(s), intervalo ${task.restartInterval || 'não definido'}.`);
    const processes = Array.isArray(task.processes) ? task.processes : task.processes ? [task.processes] : [];
    const processLevel = processes.length > 1 ? 'WARN' : processes.length === 0 && task.state === 'Running' ? 'ERROR' : processes.length === 1 ? 'OK' : 'WARN';
    report(processLevel, 'Processo do agente', processes.length ? `${processes.length} processo(s) encontrado(s): ${processes.map((item) => `PID ${item.ProcessId}`).join(', ')}.` : `Nenhum processo do agente ${packaged ? '.exe' : 'Node.js'} foi encontrado agora.`);
    return { available: true, exists: true, state: task.state, processCount: processes.length };
  } catch (error) {
    report('WARN', 'Tarefa do Agendador', `Resposta de diagnóstico inválida: ${redactText(error.message || error)}.`);
    return { available: false, state: 'Unknown', processCount: null };
  }
}

function inspectWindowsAcl(configPath, stateDir) {
  if (!fs.existsSync(configPath) || !fs.existsSync(stateDir)) {
    report('WARN', 'ACL de configuração/journal', 'Os arquivos ainda não existem; o instalador aplica permissões restritas depois da pré-validação.');
    return;
  }
  const command = `$ErrorActionPreference='Stop'; function ReadAcl($path){ $acl=Get-Acl -LiteralPath $path; $entries=@($acl.Access|ForEach-Object { $sid=$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; [pscustomobject]@{sid=$sid;type=[string]$_.AccessControlType;rights=[string]$_.FileSystemRights;inherited=$_.IsInherited} }); [pscustomobject]@{protected=$acl.AreAccessRulesProtected;entries=$entries} }; [pscustomobject]@{config=ReadAcl '${escapePowerShellSingleQuote(configPath)}';state=ReadAcl '${escapePowerShellSingleQuote(stateDir)}'}|ConvertTo-Json -Compress -Depth 6`;
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 12000, windowsHide: true });
  if (result.error || result.status !== 0) {
    report('WARN', 'ACL de configuração/journal', `Não consegui consultar permissões: ${redactText(result.error?.message || result.stderr || `código ${result.status}`)}.`);
    return;
  }
  try {
    const acl = JSON.parse(result.stdout.trim());
    const allowedSids = new Set(['S-1-5-18', 'S-1-5-32-544']);
    const hasOnlyExpectedPrincipals = (entry) => {
      const rules = Array.isArray(entry.entries) ? entry.entries : entry.entries ? [entry.entries] : [];
      const allowed = rules.filter((rule) => rule.type === 'Allow');
      const identities = new Set(allowed.map((rule) => rule.sid));
      return entry.protected && identities.size === allowedSids.size && [...identities].every((sid) => allowedSids.has(sid));
    };
    const configRules = Array.isArray(acl.config.entries) ? acl.config.entries : acl.config.entries ? [acl.config.entries] : [];
    const stateRules = Array.isArray(acl.state.entries) ? acl.state.entries : acl.state.entries ? [acl.state.entries] : [];
    const configRights = configRules.filter((rule) => rule.type === 'Allow');
    const stateRights = stateRules.filter((rule) => rule.type === 'Allow');
    const restricted = hasOnlyExpectedPrincipals(acl.config) && hasOnlyExpectedPrincipals(acl.state)
      && configRights.some((rule) => rule.sid === 'S-1-5-18' && /Read|Modify|FullControl/.test(rule.rights))
      && configRights.some((rule) => rule.sid === 'S-1-5-32-544' && /Modify|FullControl/.test(rule.rights))
      && stateRights.some((rule) => rule.sid === 'S-1-5-18' && /FullControl/.test(rule.rights))
      && stateRights.some((rule) => rule.sid === 'S-1-5-32-544' && /FullControl/.test(rule.rights));
    report(restricted ? 'OK' : 'WARN', 'ACL de configuração/journal', restricted
      ? 'Herança desativada; leitura/gravação restrita ao SYSTEM e aos administradores locais.'
      : 'As ACLs não parecem restritas ao SYSTEM e aos administradores. Execute novamente o instalador como administrador.');
  } catch (error) {
    report('WARN', 'ACL de configuração/journal', `Resposta de diagnóstico inválida: ${redactText(error.message || error)}.`);
  }
}

function escapePowerShellSingleQuote(value) {
  return String(value).replace(/'/g, "''");
}

async function inspectRemoteQueue(apiUrl, token, taskStatus) {
  if (process.platform !== 'win32') {
    report('INFO', 'Estado remoto da fila', 'Consulta de recuperação disponível somente no diagnóstico executado no Windows.');
    return;
  }
  if (!taskStatus?.available) {
    report('WARN', 'Estado remoto da fila', 'Não consultei recover porque o estado da tarefa não pôde ser confirmado.');
    return;
  }
  const stoppedStates = new Set(['Ready', 'Stopped', 'Disabled', 'Missing']);
  if (!stoppedStates.has(taskStatus.state) || taskStatus.processCount > 0) {
    report('INFO', 'Estado remoto da fila', 'Consulta recover pulada porque o agente pode estar ativo; isso evita interferir em uma impressão em andamento.');
    return;
  }
  try {
    const response = await fetch(`${apiUrl}/api/print/v2/recover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: '{}',
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      report(response.status === 401 || response.status === 403 ? 'ERROR' : 'WARN', 'Estado remoto da fila', `Recover respondeu HTTP ${response.status}${body.error ? `: ${redactText(body.error)}` : ''}.`);
      return;
    }
    const job = body.job;
    if (!job) {
      report(body.blocked ? 'ERROR' : 'OK', 'Estado remoto da fila', body.blocked ? 'A impressora está bloqueada no servidor, mas o trabalho ativo não foi retornado para este dispositivo.' : 'Nenhum trabalho ativo ou bloqueado para este dispositivo.');
    } else if (job.status === 'needs_review' || job.status === 'printing') {
      report('ERROR', 'Trabalho remoto precisa de revisão', `Status ${job.status}; consulte o painel e confirme fisicamente o resultado antes de reimprimir.`);
    } else if (job.status === 'leased') {
      report('WARN', 'Lease remoto ativo', 'Há um trabalho reservado sem início confirmado. A recuperação normal do agente deve concluir essa execução antes de buscar outra senha.');
    } else {
      report('INFO', 'Trabalho remoto ativo', `Status ${job.status || 'desconhecido'}; nenhuma impressão foi iniciada pelo diagnóstico.`);
    }
  } catch (error) {
    report('WARN', 'Estado remoto da fila', `Não foi possível consultar recover: ${redactText(error.message || error)}.`);
  }
}

function inspectPowerEvents() {
  const command = `$ErrorActionPreference='SilentlyContinue'; $events=@(Get-WinEvent -FilterHashtable @{LogName='System';StartTime=(Get-Date).AddHours(-48)} -MaxEvents 1500 | Where-Object { ($_.ProviderName -match 'Kernel-Power' -and $_.Id -in 42,107) -or ($_.ProviderName -match 'Power-Troubleshooter' -and $_.Id -eq 1) } | Select-Object -First 8 @{n='time';e={$_.TimeCreated.ToString('s')}},ProviderName,Id); $events|ConvertTo-Json -Compress -Depth 3`;
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (result.error || result.status !== 0) {
    report('WARN', 'Histórico de energia', `Log do Windows indisponível: ${redactText(result.error?.message || result.stderr || `código ${result.status}`)}.`);
    return;
  }
  try {
    const raw = result.stdout.trim();
    const events = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(events) ? events : [events];
    if (!list.length) report('OK', 'Suspensão do Windows', 'Nenhuma suspensão ou retomada foi registrada nas últimas 48 horas.');
    else report('WARN', 'Suspensão do Windows', list.map((event) => `${event.time} evento ${event.Id} (${event.ProviderName})`).join('; '));
  } catch {
    report('WARN', 'Histórico de energia', 'Não foi possível interpretar o log do Windows.');
  }
}

function inspectLog(file, label, optional = false) {
  if (!fs.existsSync(file)) {
    if (!optional) report('WARN', label, `Arquivo ausente: ${file}`);
    return;
  }
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    if (!lines.length) {
      report('WARN', label, 'Arquivo vazio.');
      return;
    }
    report('OK', label, `${file}; última atividade: ${redactText(lines[lines.length - 1]).slice(0, 240)}`);
    if (label === 'Log do agente' || label === 'Log anterior do agente') {
      const latestDisconnectIndex = lines.reduce((found, line, index) => /Canal Realtime desconectado/i.test(line) ? index : found, -1);
      const latestRecoveryIndex = lines.reduce((found, line, index) => /INFO Canal privado conectado/i.test(line) ? index : found, -1);
      const transientDisconnectRecovered = latestDisconnectIndex >= 0 && latestRecoveryIndex > latestDisconnectIndex;
      if (transientDisconnectRecovered) {
        report('INFO', 'Conexão Realtime recuperada', 'O log registra uma desconexão temporária, seguida por uma conexão do canal privado. O agente estava conectado na última atividade registrada.');
      }
      const clues = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line, index }) => /ERROR|needs_review|unknown|unauthorized|Falha|indisponível|indisponivel/i.test(line)
          && !(transientDisconnectRecovered && index <= latestDisconnectIndex && /Canal Realtime desconectado/i.test(line)))
        .slice(-8);
      for (const clue of clues) classifyAgentLog(clue.line);
    }
    if (label === 'Falhas de inicialização' || label === 'Log de instalação') {
      const clues = lines.filter((line) => /ERROR|ERRO|Falha|Exception|npm ci|não encontrado|nao encontrado/i.test(line)).slice(-6);
      for (const line of clues) {
        if (label === 'Falhas de inicialização') classifyAgentLog(line);
        else report('WARN', `${label} / evento`, redactText(line).slice(0, 320));
      }
    }
  } catch (error) {
    report('WARN', label, `Não foi possível ler: ${redactText(error.message || error)}.`);
  }
}

function classifyAgentLog(line) {
  const lower = line.toLowerCase();
  if (/needs_review|bloqueada para revisão|bloqueada para revisao|resultado físico incerto|resultado fisico incerto|unknown/.test(lower)) {
    report('ERROR', 'Trabalho precisa de revisão', 'Resultado físico incerto. Confira se o papel saiu e resolva o trabalho no painel antes de permitir nova impressão.');
  } else if (/invalid_enrollment|pareamento recusado.{0,30}http 401/.test(lower)) {
    report('ERROR', 'Código de pareamento recusado', 'Gere um código novo no console administrativo; o atual pode ter expirado ou já ter sido usado. Atualize PRINT_ENROLLMENT_CODE e reinicie a tarefa.');
  } else if (/status["':= ]+(401|403)|http[ :]+(401|403)|unauthorized|sem autorização|sem autorizacao|device_revoked|device_scope_invalid/.test(lower)) {
    report('ERROR', 'Autorização recusada', 'A sessão ou o vínculo do dispositivo foi recusado. Confira pareamento e status do equipamento no painel.');
  } else if (/print_api_url|configuração inválida|configuracao invalida|pareamento necessario|configurar print_enrollment_code/.test(lower)) {
    report('ERROR', 'Configuração do agente', redactText(line).slice(0, 320));
  } else if (/cannot find module|module not found|serialport.*not found|sqlite.*not available/.test(lower)) {
    report('ERROR', 'Dependência do agente', PACKAGED ? 'O executável está incompleto ou o módulo serial não foi carregado.' : 'Instale dependências com Node 22 e consulte o erro detalhado no log.');
  } else if (/serialport|porta com|access denied|permission|cannot find|no such file|impressora.*falha/.test(lower)) {
    report('WARN', 'Falha local da impressora', 'Confira COM configurada, cabo, driver, papel e se outro programa está usando a porta.');
  } else if (/enotfound|econnreset|econnrefused|timeout|dns|fetch failed|conexão indisponível|conexao indisponivel/.test(lower)) {
    report('WARN', 'Falha de conexão registrada', 'Confira internet, DNS, data/hora do Windows e disponibilidade do SenhaHub.');
  } else {
    report('WARN', 'Evento de erro no log', redactText(line).slice(0, 320));
  }
}

function report(level, title, detail) {
  findings.push({ level, title, detail });
  if (level === 'ERROR') hasErrors = true;
  if (level === 'WARN') hasWarnings = true;
}

function section(title) {
  findings.push({ section: title });
}

function safeHost(value) {
  try { return new URL(value).host; } catch { return '[URL inválida]'; }
}

function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}min`;
}

function formatTaskResult(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number} (0x${(number >>> 0).toString(16).toUpperCase()})` : 'não disponível';
}

async function main(argumentsList = process.argv.slice(2)) {
  const args = new Set(argumentsList);
  const result = await runDiagnostics({
    localOnly: args.has('--local-only'),
    preinstall: args.has('--preinstall')
  });
  if (args.has('--json')) {
    process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), findings: result.findings, hasErrors: result.hasErrors, hasWarnings: result.hasWarnings }, null, 2)}\n`);
  } else {
    process.stdout.write('\nSENHAHUB — DIAGNÓSTICO DO AGENTE NODE\n');
    process.stdout.write(`${'='.repeat(76)}\n`);
    for (const finding of result.findings) {
      if (finding.section) process.stdout.write(`\n${finding.section}\n`);
      else process.stdout.write(`[${finding.level}] ${finding.title}: ${finding.detail}\n`);
    }
    const summary = result.hasErrors
      ? 'Diagnóstico concluído: encontrei falhas que podem impedir a operação.'
      : result.hasWarnings
        ? 'Diagnóstico concluído: encontrei itens que precisam de atenção.'
        : 'Diagnóstico concluído: instalação e comunicação estão acessíveis.';
    process.stdout.write(`\n${summary}\n`);
  }
  if (result.hasErrors) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`Não foi possível concluir o diagnóstico: ${redactText(error.message || error)}\n`);
  process.exitCode = 1;
});

module.exports = { main, runDiagnostics };
