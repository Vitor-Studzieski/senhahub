const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const qrcode = require("../../public/vendor/qrcode-generator.js");

function buildTicketReceipt(payload = {}) {
  const tickets = normalizeReceiptTickets(payload);
  const trackingUrl = cleanUrl(payload.trackUrl);
  const ticketBlocks = tickets.flatMap((ticket) => [
    asciiLine(ticket.sectorName.toUpperCase()),
    command(ESC, 0x45, 1),
    asciiLine("SENHA"),
    command(GS, 0x21, 0x33),
    asciiLine(ticket.ticketCode),
    command(GS, 0x21, 0),
    command(ESC, 0x45, 0)
  ]);

  return Buffer.concat([
    command(ESC, 0x40),
    // A MP-4200 TH pode iniciar em ESC/Bematech; selecione ESC/POS
    // temporariamente para que fonte, corte e QR Code sejam interpretados.
    command(GS, 0xf9, 0x20, 0x01),
    command(ESC, 0x61, 1),
    command(ESC, 0x45, 1),
    command(GS, 0x21, 0x01),
    asciiLine("SUPERMERCADO POMPEIA"),
    command(GS, 0x21, 0x00),
    asciiLine("SenhaHub"),
    ...ticketBlocks,
    command(ESC, 0x64, 1),
    qrCode(trackingUrl),
    asciiLine("Escaneie o QR Code para acompanhar"),
    command(ESC, 0x64, 3),
    cutPaper()
  ]);
}

function normalizeReceiptTickets(payload = {}) {
  const source = Array.isArray(payload.tickets) && payload.tickets.length
    ? payload.tickets
    : [payload];
  return source.slice(0, 12).map((ticket) => ({
    ticketCode: cleanText(ticket.ticketCode || payload.ticketCode, 16) || "---",
    sectorName: cleanText(ticket.sectorName || payload.sectorName, 60) || "SETOR",
    issuedAt: formatIssuedAt(ticket.issuedAt || payload.issuedAt)
  }));
}

function cutPaper() {
  // GS V 66 n: avanca n pontos e executa o corte total.
  return command(GS, 0x56, 0x42, 0x04);
}

function qrCode(value) {
  if (!value) return asciiLine("QR Code indisponivel");
  const code = qrcode(0, "M");
  code.addData(value, "Byte");
  code.make();

  // Render the QR as ESC/POS raster data instead of relying on the printer's
  // native GS ( k QR firmware command, which may otherwise be printed as text.
  const moduleCount = code.getModuleCount();
  const scale = 4;
  const quietZoneModules = 4;
  const imageSize = (moduleCount + quietZoneModules * 2) * scale;
  const rowBytes = Math.ceil(imageSize / 8);
  const bitmap = Buffer.alloc(rowBytes * imageSize);

  for (let y = 0; y < imageSize; y += 1) {
    const moduleY = Math.floor(y / scale) - quietZoneModules;
    if (moduleY < 0 || moduleY >= moduleCount) continue;
    for (let x = 0; x < imageSize; x += 1) {
      const moduleX = Math.floor(x / scale) - quietZoneModules;
      if (moduleX < 0 || moduleX >= moduleCount || !code.isDark(moduleY, moduleX)) continue;
      bitmap[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  return Buffer.concat([
    command(
      GS, 0x76, 0x30, 0,
      rowBytes & 0xff, (rowBytes >> 8) & 0xff,
      imageSize & 0xff, (imageSize >> 8) & 0xff
    ),
    bitmap,
    command(LF)
  ]);
}

function formatIssuedAt(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Horario de emissao invalido no trabalho de impressao.");
  }
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(date);
}

function cleanText(value, maxLength) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanUrl(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 512);
}

function asciiLine(value) {
  return Buffer.concat([Buffer.from(cleanText(value, 160), "ascii"), command(LF)]);
}

function command(...bytes) {
  return Buffer.from(bytes);
}

module.exports = {
  buildTicketReceipt,
  cleanText
};
