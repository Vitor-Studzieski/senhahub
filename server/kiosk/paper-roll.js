const PAPER_ROLL_CAPACITY = 420;
const PAPER_ROLL_WARNING_AT = 336;
const PAPER_ROLL_URGENT_AT = 399;
const PAPER_ROLL_MAX_INITIAL_COUNT = 10000;

function printerPaperKey(kioskId) {
  const id = String(kioskId || "").trim();
  return id ? `kiosk:${id}` : "";
}

function parsePrinterPaperKey(value) {
  const key = String(value || "").trim();
  const match = key.match(/^kiosk:([A-Za-z0-9_-]{1,120})$/);
  return match ? match[1] : null;
}

function ticketCopiesInPayload(value) {
  let payload = value;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = null;
    }
  }
  if (!payload || typeof payload !== "object") return 1;
  if (Array.isArray(payload.tickets) && payload.tickets.length) return payload.tickets.length;
  if (Array.isArray(payload.ticketIds) && payload.ticketIds.length) return new Set(payload.ticketIds.map(String)).size;
  return 1;
}

function paperRollLevel(count) {
  if (count >= PAPER_ROLL_CAPACITY) {
    return {
      tone: "attention",
      label: "Trocar bobina",
      detail: count > PAPER_ROLL_CAPACITY
        ? `A estimativa foi excedida em ${count - PAPER_ROLL_CAPACITY} ${count - PAPER_ROLL_CAPACITY === 1 ? "senha" : "senhas"}. Troque a bobina e registre a troca.`
        : "A estimativa média de 420 senhas foi atingida. Troque a bobina e registre a troca."
    };
  }
  if (count >= PAPER_ROLL_URGENT_AT) {
    const remaining = PAPER_ROLL_CAPACITY - count;
    return {
      tone: "attention",
      label: "Troca próxima",
      detail: `Restam aproximadamente ${remaining} ${remaining === 1 ? "senha" : "senhas"} nesta bobina.`
    };
  }
  if (count >= PAPER_ROLL_WARNING_AT) {
    const remaining = PAPER_ROLL_CAPACITY - count;
    return {
      tone: "warning",
      label: "Programar troca",
      detail: `Restam aproximadamente ${remaining} ${remaining === 1 ? "senha" : "senhas"} nesta bobina.`
    };
  }
  return {
    tone: "good",
    label: "Bobina em uso",
    detail: `${PAPER_ROLL_CAPACITY - count} senhas estimadas até a troca.`
  };
}

function buildPrinterPaperStatus({ printers = [], events = [], printedJobs = [], reviewJobs = [] } = {}) {
  const latestEventByPrinter = new Map();
  for (const event of events) {
    const current = latestEventByPrinter.get(event.printer_key);
    if (!current || dateValue(event.created_at) > dateValue(current.created_at)) {
      latestEventByPrinter.set(event.printer_key, event);
    }
  }

  const printedCountByPrinter = new Map();
  for (const job of printedJobs) {
    const key = printerPaperKey(job.kiosk_id);
    const event = latestEventByPrinter.get(key);
    if (!event || dateValue(job.updated_at || job.printed_at) < dateValue(event.created_at)) continue;
    printedCountByPrinter.set(key, (printedCountByPrinter.get(key) || 0) + ticketCopiesInPayload(job.payload));
  }

  const reviewsByPrinter = new Map();
  for (const job of reviewJobs) {
    const key = printerPaperKey(job.kiosk_id);
    if (key) reviewsByPrinter.set(key, (reviewsByPrinter.get(key) || 0) + 1);
  }

  return printers.map((printer) => {
    const key = printerPaperKey(printer.id);
    const event = latestEventByPrinter.get(key) || null;
    const reviewJobCount = reviewsByPrinter.get(key) || 0;
    const name = String(printer.printer_name || printer.name || "Impressora");
    const sectorId = String(printer.sector_id || "");
    const location = printer.sector_name
      ? String(printer.sector_name)
      : /^acougue(?:-|$)/i.test(sectorId)
        ? "Açougue"
        : sectorId || "Totem";
    if (!event) {
      return {
        printerKey: key,
        name,
        location,
        active: printer.active !== false && printer.active !== 0,
        initialized: false,
        count: null,
        capacity: PAPER_ROLL_CAPACITY,
        remaining: null,
        percentage: 0,
        reviewJobCount,
        tone: "neutral",
        label: "Iniciar contador",
        detail: "Informe uma estimativa de senhas já impressas nesta bobina. Se acabou de trocá-la, informe 0."
      };
    }

    const count = Math.max(0, Number(event.baseline_count || 0)) + (printedCountByPrinter.get(key) || 0);
    const level = paperRollLevel(count);
    return {
      printerKey: key,
      name,
      location,
      active: printer.active !== false && printer.active !== 0,
      initialized: true,
      count,
      capacity: PAPER_ROLL_CAPACITY,
      remaining: Math.max(0, PAPER_ROLL_CAPACITY - count),
      excess: Math.max(0, count - PAPER_ROLL_CAPACITY),
      percentage: Math.min(100, Math.round((count / PAPER_ROLL_CAPACITY) * 100)),
      reviewJobCount,
      tone: level.tone,
      label: level.label,
      detail: level.detail,
      startedAt: event.created_at,
      startAction: event.event_type,
      actorName: event.actor_name || "Gerente"
    };
  });
}

function dateValue(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

module.exports = {
  PAPER_ROLL_CAPACITY,
  PAPER_ROLL_MAX_INITIAL_COUNT,
  PAPER_ROLL_URGENT_AT,
  PAPER_ROLL_WARNING_AT,
  buildPrinterPaperStatus,
  parsePrinterPaperKey,
  printerPaperKey,
  ticketCopiesInPayload
};
