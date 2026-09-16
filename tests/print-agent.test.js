const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildTicketReceipt } = require("../server/kiosk/escpos-receipt");
const { rawbtUrlForPrintJob } = require("../server/kiosk/rawbt-print");
const {
  loadKioskConfiguration,
  loadTabletPrinterConfiguration,
  printJobDto,
  verifyPrintAgentRequest
} = require("../server/kiosk/print-kiosk-service");
const { assertPrintableJob, receiptPayload } = require("../scripts/print-agent");
const { PrintRealtimeSignal } = require("../scripts/print-agent/realtime");
const { SerialPrinter, queryStatus } = require("../scripts/print-agent/serial-printer");
const {
  PrintedJobJournal,
  loadAgentEnvironment,
  readAgentConfiguration
} = require("../scripts/print-agent/runtime");

test("gera cupom ESC/POS com layout SenhaHub, QR individual e corte", () => {
  const receipt = buildTicketReceipt({
    ticketCode: "A042",
    sectorName: "Acougue",
    issuedAt: "2026-07-29T20:00:00.000Z",
    installUrl: "https://senhahub.vercel.app/instalar",
    trackUrl: "https://senhahub.vercel.app/acompanhar/token-de-teste-1234567890",
    paperWidthMm: 80
  });

  assert.ok(receipt.length > 50);
  assert.ok(receipt.includes(Buffer.from("SUPERMERCADO POMPEIA", "ascii")));
  assert.ok(receipt.includes(Buffer.from("SenhaHub", "ascii")));
  assert.ok(receipt.includes(Buffer.from("ACOUGUE", "ascii")));
  assert.ok(receipt.includes(Buffer.from("SENHA", "ascii")));
  assert.ok(receipt.includes(Buffer.from("A042", "ascii")));
  assert.ok(receipt.includes(Buffer.from([0x1d, 0xf9, 0x20, 0x01])));
  assert.ok(receipt.includes(Buffer.from([0x1d, 0x28, 0x6b])));
  assert.ok(receipt.includes(Buffer.from("token-de-teste-1234567890", "ascii")));
  const layout = ["SUPERMERCADO POMPEIA", "SenhaHub", "ACOUGUE", "SENHA", "A042"]
    .map((value) => receipt.indexOf(Buffer.from(value, "ascii")));
  assert.ok(layout.every((position, index) => position >= 0 && (index === 0 || position > layout[index - 1])));
  assert.equal(receipt.includes(Buffer.from("ATENDIMENTO", "ascii")), false);
  assert.equal(receipt.includes(Buffer.from("Emitida em", "ascii")), false);
  assert.equal(receipt.includes(Buffer.from("------------------------------", "ascii")), false);
  assert.ok(receipt.includes(Buffer.from([0x1d, 0x56, 66, 4])));
});

test("gera duas senhas no mesmo cupom mantendo um unico QR Code", () => {
  const receipt = buildTicketReceipt({
    ticketCode: "A001",
    sectorName: "Acougue",
    issuedAt: "2026-07-29T20:00:00.000Z",
    trackUrl: "https://senhahub.vercel.app/acompanhar/token-do-conjunto",
    tickets: [
      { ticketCode: "A001", sectorName: "Acougue", issuedAt: "2026-07-29T20:00:00.000Z" },
      { ticketCode: "F002", sectorName: "Frios e Laticinios", issuedAt: "2026-07-29T20:00:00.000Z" }
    ]
  });

  assert.ok(receipt.includes(Buffer.from("ACOUGUE", "ascii")));
  assert.ok(receipt.includes(Buffer.from("A001", "ascii")));
  assert.ok(receipt.includes(Buffer.from("FRIOS E LATICINIOS", "ascii")));
  assert.ok(receipt.includes(Buffer.from("F002", "ascii")));
  assert.equal(receipt.includes(Buffer.from("Emitida em", "ascii")), false);
  assert.equal(receipt.includes(Buffer.from("------------------------------", "ascii")), false);
  assert.equal(countBuffer(receipt, Buffer.from([0x1d, 0x28, 0x6b, 4, 0, 49, 65, 50, 0])), 1);
  assert.ok(receipt.includes(Buffer.from([0x1d, 0x56, 66, 4])));
});

test("gera um link RawBT com a mesma senha do trabalho de impressao", () => {
  const rawbtUrl = rawbtUrlForPrintJob({
    payload: {
      ticketCode: "A042",
      sectorName: "Acougue",
      issuedAt: "2026-07-29T20:00:00.000Z",
      trackUrl: "https://senhahub.vercel.app/acompanhar/token-de-teste-1234567890"
    }
  });

  assert.match(rawbtUrl, /^rawbt:base64,[A-Za-z0-9+/]+=*$/);
  const receipt = Buffer.from(rawbtUrl.slice("rawbt:base64,".length), "base64");
  assert.ok(receipt.includes(Buffer.from("A042", "ascii")));
  assert.equal(receipt.includes(Buffer.from([0x1d, 0xf9, 0x20, 0x01])), false);
});

test("totem exibe o QR geral separado do QR individual da senha", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../public/totem.html"), "utf8");
  const script = fs.readFileSync(path.resolve(__dirname, "../public/totem.js"), "utf8");
  const page = fs.readFileSync(path.resolve(__dirname, "../app/totem/page.jsx"), "utf8");
  const attendant = fs.readFileSync(path.resolve(__dirname, "../public/attendant.js"), "utf8");
  const trackingHtml = fs.readFileSync(path.resolve(__dirname, "../public/acompanhar.html"), "utf8");
  const trackingScript = fs.readFileSync(path.resolve(__dirname, "../public/acompanhar.js"), "utf8");
  assert.match(html, /id="totemGeneralQr"/);
  assert.doesNotMatch(html, /id="resultTrackQr"/);
  assert.doesNotMatch(html, /Acompanhe sua posição pelo celular/);
  assert.doesNotMatch(html, /Escaneie o QR Code para acompanhar sua fila/);
  assert.match(html, /id="backToTypeFromSectorsButton"/);
  assert.match(page, /const TOTEM_ASSET_VERSION = "2026\.09\.15\.2"/);
  assert.match(page, /`\/totem\.js\?v=\$\{TOTEM_ASSET_VERSION\}`/);
  assert.match(html, /id="issueTicketsButton"/);
  assert.match(html, /id="resultTickets"/);
  assert.doesNotMatch(html, /id="issueNormalTicketButton"/);
  assert.doesNotMatch(html, /id="issuePriorityTicketButton"/);
  assert.doesNotMatch(html, /Confirme sua escolha/);
  assert.doesNotMatch(html, /id="totemStepConfirm"/);
  assert.doesNotMatch(html, /id="totemStepIssue"/);
  assert.doesNotMatch(html, /Confirme os setores selecionados/);
  assert.match(html, /data-progress-step="type">1 <small>Atendimento<\/small>/);
  assert.match(html, /data-progress-step="priority">2 <small>Categoria<\/small>/);
  assert.match(html, /data-progress-step="sector">3 <small>Setores<\/small>/);
  assert.doesNotMatch(html, /data-progress-step="issue"/);
  assert.match(html, /id="totemServiceOptions"/);
  assert.match(html, /class="totem-step totem-priority-step"/);
  assert.ok(html.indexOf('id="totemStepType"') < html.indexOf('id="totemStepSector"'));
  assert.match(script, /kiosk\?\.appUrl/);
  assert.match(script, /senhahub\.vercel\.app\/login\?next=%2F/);
  assert.match(script, /RESULT_DISPLAY_MS = 4000/);
  assert.match(script, /setTimeout\(resetOperation, RESULT_DISPLAY_MS\)/);
  assert.doesNotMatch(script, /renderTrackingQr|resultTrackQr|resultTrackUrl/);
  assert.match(script, /selectedSectors/);
  assert.match(script, /function toggleSector\(sector\)/);
  assert.match(script, /continueAfterServiceSelection/);
  assert.match(script, /const SERVICE_TYPES = \[/);
  assert.match(script, /function renderServiceOptions\(\)/);
  assert.match(script, /tablet-priority\/idoso\.jpg/);
  assert.match(script, /tablet-priority\/fibromialgia\.png/);
  assert.match(script, /body\.sectorIds = sectors\.map/);
  assert.match(script, /const tickets = result\.tickets \|\|/);
  assert.match(script, /function pollPrintJobs\(jobIds\)/);
  assert.doesNotMatch(script, /setStep\("issue"\)/);
  assert.match(script, /if \(!sectors\.length .*state\.issueInFlight\) return/);
  assert.doesNotMatch(script, /state\.serviceType === "preferencial" \? "priority" : "type"/);
  assert.match(attendant, /const callNextInFlight = new Set\(\)/);
  assert.match(attendant, /const isCallingNext = callNextInFlight\.has\(sector\.id\)/);
  assert.match(attendant, /applyCalledTicket\(sectorId, result\.ticket\)/);
  assert.match(attendant, /function latestActiveTicket\(tickets\)/);
  assert.match(attendant, /\["chamado", "em_atendimento"\]/);
  assert.match(attendant, /const callHighlight = activeTicket/);
  assert.match(attendant, /\$\{callHighlight \? "" : `<b>\$\{waiting\.length\} na fila<\/b>`\}/);
  assert.match(attendant, /class="ops-call-details"/);
  assert.doesNotMatch(attendant, /formatClock\(callHighlight\.createdAt\)/);
  assert.match(fs.readFileSync(path.resolve(__dirname, "../public/styles.css"), "utf8"), /\.attendant-page \.ops-call-panel\.call-highlight \.ops-call-main\s*\{[^}]*display: grid;/);
  assert.match(fs.readFileSync(path.resolve(__dirname, "../public/app.js"), "utf8"), /const STATE_POLL_INTERVAL_MS = 5000/);
  assert.match(trackingScript, /const TRACKING_POLL_INTERVAL_MS = 5000/);
  assert.match(script, /const QUEUE_REFRESH_INTERVAL_MS = 5000/);
  assert.match(trackingHtml, /id="trackingTicketsList"/);
  assert.match(trackingScript, /payload\.tickets/);
  assert.match(trackingScript, /renderBundleTicket/);
});

test("painel conserva a senha chamada enquanto o estado do atendimento estiver ativo", () => {
  const attendant = fs.readFileSync(path.resolve(__dirname, "../public/attendant.js"), "utf8");
  const helper = attendant.match(/function latestActiveTicket\(tickets\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, "O painel precisa derivar a chamada ativa dos tickets retornados pelo servidor.");
  const selectActiveTicket = new Function(`${helper}; return latestActiveTicket;`)();
  const tickets = [
    { id: "waiting", status: "aguardando", createdAt: "2026-09-15T18:25:00.000Z" },
    { id: "called", status: "chamado", calledAt: "2026-09-15T18:20:00.000Z" },
    { id: "in-service", status: "em_atendimento", serviceStartedAt: "2026-09-15T18:22:00.000Z" }
  ];

  assert.equal(selectActiveTicket(tickets)?.id, "in-service");
  assert.equal(selectActiveTicket(tickets.filter((ticket) => ticket.status === "aguardando")), null);
});

test("fila do atendente mantém linhas concisas e não desloca o histórico entre estados", () => {
  const attendant = fs.readFileSync(path.resolve(__dirname, "../public/attendant.js"), "utf8");
  const styles = fs.readFileSync(path.resolve(__dirname, "../public/styles.css"), "utf8");
  const rowHelper = attendant.match(/function ticketRow\(ticket\) \{[\s\S]*?\n\}/)?.[0];
  const supportCodeHelper = attendant.match(/function supportCode\(ticket\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(rowHelper, "A fila precisa renderizar os tickets por uma função única.");
  assert.ok(supportCodeHelper, "O painel precisa formatar o código da senha em um único padrão.");
  const formatSupportCode = new Function(`${supportCodeHelper}; return supportCode;`)();

  const renderTicketRow = new Function(
    "escapeHtml",
    "displayCustomerName",
    "ticketTypeBadgeMarkup",
    "ticketActions",
    "supportCode",
    `${rowHelper}; return ticketRow;`
  )(
    (value) => String(value),
    (ticket) => ticket.customerName,
    () => '<em class="ticket-type-badge">COMUM</em>',
    () => "",
    formatSupportCode
  );
  const standbyRow = renderTicketRow({
    id: "standby-1",
    status: "standby",
    customerName: "Vitor Studzieski",
    ticket: "A002",
    ticketNumber: 2,
    sector: "Açougue",
    store: "Loja 2"
  });

  assert.match(standbyRow, /Vitor Studzieski/);
  assert.match(standbyRow, /class="ops-ticket-code">Senha 002<\/span>/);
  assert.match(standbyRow, /Senha 002[\s\S]*COMUM/);
  assert.doesNotMatch(standbyRow, /A002/);
  assert.match(standbyRow, /COMUM/);
  assert.doesNotMatch(standbyRow, /standby|stand by|Açougue|Loja 2|Retorno|à frente|minutos?/i);
  assert.doesNotMatch(attendant, /function ticketDetailLine\(|function formatStandbyTime\(/);
  assert.match(attendant, /ops-feedback-slot/);
  assert.match(styles, /grid-template-rows: 72px 128px 64px 34px 176px auto/);
  assert.match(styles, /\.attendant-page \.ops-queue-section\s*\{[^}]*height: 176px;[^}]*overflow-y: auto/s);
  assert.match(styles, /\.attendant-page \.ops-call-button:hover:not\(:disabled\)\s*\{\s*background: var\(--vr-orange-strong\);/);
  assert.match(styles, /\.attendant-page \.ops-ticket-meta\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;/);
  assert.match(styles, /\.attendant-page \.ops-ticket-meta \.priority-badge > span\s*\{[^}]*display: inline;/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.attendant-page \.ops-grid\s*\{\s*grid-template-columns: 1fr;/);
  assert.match(styles, /grid-template-rows: auto auto 64px 34px 176px auto/);
});

test("últimas chamadas mostram nome, senha e prioridade sem rótulo de ação", () => {
  const attendant = fs.readFileSync(path.resolve(__dirname, "../public/attendant.js"), "utf8");
  const historyHelper = attendant.match(/function callHistory\(items\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(historyHelper, "O histórico precisa ter um renderizador próprio.");

  const renderHistory = new Function(
    "escapeHtml",
    "displayCustomerName",
    "supportCode",
    "formatClock",
    `${historyHelper}; return callHistory;`
  )(
    (value) => String(value),
    (ticket) => ticket.customerName || "Cliente",
    (ticket) => `Senha ${String(ticket.ticketNumber).padStart(3, "0")}`,
    () => "18:00:00"
  );
  const history = renderHistory([
    { action: "senha_chamada", customerName: "Ana", ticketNumber: 7, priority: false },
    { action: "senha_chamada", customerName: "Bruno", ticketNumber: 8, priority: true },
    { action: "senha_pulada:cancelamento", customerName: "Carla", ticketNumber: 9, priority: false }
  ]);

  assert.match(history, /Ana · Senha 007 · comum/);
  assert.match(history, /Bruno · Senha 008 · preferencial/);
  assert.doesNotMatch(history, /Carla|cancelamento|pulada/);
  assert.doesNotMatch(history, /Senha 007 - chamada|Senha 008 - chamada/);
  assert.equal((history.match(/class="history-row"/g) || []).length, 2);
});

test("carrega configuracao local sem sobrescrever variaveis do processo", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "senhahub-agent-"));
  const configFile = path.join(directory, ".env.print-agent");
  fs.writeFileSync(configFile, [
    "PRINT_API_URL=https://senhahub.vercel.app",
    "PRINT_AGENT_TOKEN=abcdefghijklmnopqrstuvwxyz1234567890",
    "KIOSK_PRINTER_PORT=COM9",
    "PRINT_SERIAL_BAUD_RATE=9600"
  ].join("\n"));

  const previous = { ...process.env };
  try {
    delete process.env.PRINT_API_URL;
    delete process.env.PRINT_AGENT_TOKEN;
    delete process.env.KIOSK_PRINTER_PORT;
    delete process.env.PRINT_SERIAL_BAUD_RATE;
    loadAgentEnvironment(configFile);
    const config = readAgentConfiguration({ ...process.env, NODE_ENV: "production" });
    assert.equal(config.printerPort, "COM9");
    assert.equal(config.baudRate, 9600);
  } finally {
    process.env = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("configura Realtime e reconciliacao rara sem heartbeat HTTP", () => {
  const config = readAgentConfiguration({
    NODE_ENV: "test",
    PRINT_API_URL: "https://senhahub.vercel.app",
    PRINT_AGENT_TOKEN: "abcdefghijklmnopqrstuvwxyz1234567890",
    KIOSK_ID: "totem-pompeia-01",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "public-key",
    PRINT_REALTIME_ENABLED: "1"
  });

  assert.equal(config.realtimeEnabled, true);
  assert.equal(config.realtimeTopic, "senhahub:print:totem-pompeia-01");
  assert.equal(config.reconciliationMs, 600000);
  assert.equal(config.pollIntervalMs, undefined);
  assert.equal(config.heartbeatIntervalMs, undefined);
});

test("permite HTTP somente no loopback para o agente local", () => {
  const config = readAgentConfiguration({ NODE_ENV: "development", PRINT_API_URL: "http://localhost:3000" });
  assert.equal(config.apiUrl, "http://localhost:3000");
  assert.throws(() => readAgentConfiguration({ NODE_ENV: "development", PRINT_API_URL: "http://10.0.0.5:3000" }), /HTTPS/);
});

test("mantem Realtime habilitado para descoberta protegida sem expor a chave no agente", () => {
  const config = readAgentConfiguration({
    NODE_ENV: "test",
    PRINT_API_URL: "https://senhahub.vercel.app",
    PRINT_AGENT_TOKEN: "abcdefghijklmnopqrstuvwxyz1234567890",
    KIOSK_ID: "totem-pompeia-01"
  });

  assert.equal(config.realtimeEnabled, true);
  assert.equal(new PrintRealtimeSignal({
    url: config.supabaseUrl,
    key: config.supabaseKey,
    topic: config.realtimeTopic
  }).enabled, false);
});

test("mantem o totem Pompeia na Loja 2 mesmo com configuracao antiga", () => {
  const configuration = loadKioskConfiguration({
    KIOSK_ID: "totem-pompeia-01",
    KIOSK_STORE_CODE: "loja-1"
  });
  assert.equal(configuration.storeCode, "loja-2");
});

test("configura a impressora Bluetooth do tablet somente para o Acougue da Loja 2", () => {
  const configuration = loadTabletPrinterConfiguration({});
  assert.equal(configuration.id, "tablet-pompeia-01");
  assert.equal(configuration.mode, "sector");
  assert.equal(configuration.sectorId, "acougue-loja-2");
  assert.equal(configuration.storeCode, "loja-2");
  assert.equal(configuration.printerName, "POS-5890A-L");
  assert.equal(configuration.printerPort, "BLUETOOTH");
  assert.equal(configuration.paperWidthMm, 58);
});

test("aceita tokens separados para o totem e a impressora Bluetooth do tablet", () => {
  const tabletToken = "tablet-token-abcdefghijklmnopqrstuvwxyz-1234567890";
  const result = verifyPrintAgentRequest(
    new Headers({
      "x-print-agent-token": tabletToken,
      "x-print-agent-kiosk-id": "tablet-pompeia-01"
    }),
    {
      KIOSK_ID: "totem-pompeia-01",
      PRINT_AGENT_TOKEN: "totem-token-abcdefghijklmnopqrstuvwxyz-1234567890",
      PRINT_AGENT_KIOSKS_JSON: JSON.stringify({ "tablet-pompeia-01": tabletToken })
    }
  );
  assert.deepEqual(result, { ok: true, kioskId: "tablet-pompeia-01" });
});

test("usa a porta configurada pelo agente ao criar a impressora", () => {
  const printer = new SerialPrinter({ printerPort: "COM9" });
  assert.equal(printer.path, "COM9");
});

test("journal impede reimpressao de trabalho ja enviado", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "senhahub-journal-"));
  try {
    const first = new PrintedJobJournal(directory);
    first.add("job-123");
    const restarted = new PrintedJobJournal(directory);
    assert.equal(restarted.has("job-123"), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("consulta status ESC/POS pela porta serial", async () => {
  const port = new EventEmitter();
  port.write = (buffer, callback) => {
    assert.deepEqual(buffer, Buffer.from([0x10, 0x04, 2]));
    callback();
    setImmediate(() => port.emit("data", Buffer.from([0x12])));
  };
  assert.equal(await queryStatus(port, 2, 100), 0x12);
});

test("usa a data de criacao quando um trabalho antigo nao possui horario valido", () => {
  const payload = receiptPayload({
    id: "job-antigo",
    createdAt: "2026-08-12T14:00:00.000Z",
    payload: { ticketCode: "A002", sectorName: "Acougue", issuedAt: "invalido" }
  }, { info: () => {} });

  assert.equal(payload.issuedAt, "2026-08-12T14:00:00.000Z");
  assert.ok(buildTicketReceipt(payload).includes(Buffer.from("A002", "ascii")));
});

test("recusa trabalho sem identificador para nunca imprimir um cupom sem senha", () => {
  assert.throws(
    () => assertPrintableJob({ payload: { ticketCode: "A002" } }),
    /ID ausente/
  );
});

test("interpreta retorno vazio da RPC como fila sem trabalho", () => {
  assert.equal(printJobDto({}), null);
  assert.equal(printJobDto(null), null);
});

function sampleJob() {
  return {
    id: "job-123",
    payload: {
      ticketCode: "A001",
      sectorName: "Acougue",
      issuedAt: "2026-07-29T20:00:00.000Z",
      installUrl: "https://senhahub.vercel.app/instalar",
      trackUrl: "https://senhahub.vercel.app/acompanhar/token-de-teste-1234567890",
      paperWidthMm: 80
    }
  };
}

function countBuffer(buffer, needle) {
  let count = 0;
  for (let offset = 0; offset <= buffer.length - needle.length; offset += 1) {
    if (buffer.subarray(offset, offset + needle.length).equals(needle)) count += 1;
  }
  return count;
}
