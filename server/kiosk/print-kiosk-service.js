const crypto = require("node:crypto");

const KIOSK_SESSION_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_KIOSK_ID = "totem-pompeia-01";
const DEFAULT_KIOSK_STORE_CODE = "loja-2";
const DEFAULT_TABLET_PRINTER_KIOSK_ID = "tablet-pompeia-01";
const DEFAULT_TABLET_PRINTER_NAME = "Bematech MP - 4200 TH";
const DEFAULT_TABLET_PRINTER_PORT = "COM4";
const DEFAULT_INSTALL_URL = "https://senhahub.vercel.app/instalar";
const DEFAULT_APP_URL = "https://senhahub.vercel.app";

function loadKioskConfiguration(env = process.env) {
  const kioskId = cleanId(env.KIOSK_ID) || DEFAULT_KIOSK_ID;
  const appUrl = normalizeHttpsUrl(env.PUBLIC_APP_URL) || "https://senhahub.vercel.app";
  const mode = ["central", "sector"].includes(String(env.KIOSK_MODE || "").trim().toLowerCase())
    ? String(env.KIOSK_MODE).trim().toLowerCase()
    : "central";
  const configuredStoreCode = cleanId(env.KIOSK_STORE_CODE);
  const storeCode = kioskId === DEFAULT_KIOSK_ID
    ? DEFAULT_KIOSK_STORE_CODE
    : (/^loja-[0-9]+$/.test(configuredStoreCode) ? configuredStoreCode : "loja-1");
  return {
    id: kioskId,
    name: cleanText(env.KIOSK_NAME, 120) || "Totem Supermercado Pompeia",
    appUrl: appUrl || DEFAULT_APP_URL,
    mode,
    storeCode,
    sectorId: mode === "sector" ? cleanId(env.KIOSK_SECTOR_ID) : "",
    printerName: cleanText(env.KIOSK_PRINTER_NAME, 160) || "Bematech MP - 4200 TH",
    printerPort: cleanText(env.KIOSK_PRINTER_PORT, 40) || "COM3",
    paperWidthMm: Number(env.KIOSK_PAPER_WIDTH_MM) === 58 ? 58 : 80,
    installUrl: normalizeHttpsUrl(env.PUBLIC_INSTALL_URL)
      || `${appUrl.replace(/\/+$/, "")}/instalar`
      || DEFAULT_INSTALL_URL
  };
}

function loadTabletPrinterConfiguration(env = process.env) {
  const kiosk = loadKioskConfiguration(env);
  const id = cleanId(env.TABLET_PRINTER_KIOSK_ID) || DEFAULT_TABLET_PRINTER_KIOSK_ID;
  const storeCode = cleanId(env.TABLET_PRINTER_STORE_CODE) || kiosk.storeCode;
  const sectorId = cleanId(env.TABLET_PRINTER_SECTOR_ID) || "acougue-loja-2";
  const mode = String(env.TABLET_PRINTER_MODE || "sector").trim().toLowerCase() === "central"
    ? "central"
    : "sector";
  return {
    id,
    name: cleanText(env.TABLET_PRINTER_NAME_DISPLAY, 120) || "Impressora dos tablets",
    appUrl: kiosk.appUrl,
    mode,
    sectorId: mode === "sector" ? sectorId : "",
    storeCode: /^loja-[0-9]+$/.test(storeCode) ? storeCode : kiosk.storeCode,
    printerName: cleanText(env.TABLET_PRINTER_NAME, 160) || DEFAULT_TABLET_PRINTER_NAME,
    printerPort: cleanText(env.TABLET_PRINTER_PORT, 40) || DEFAULT_TABLET_PRINTER_PORT,
    paperWidthMm: env.TABLET_PAPER_WIDTH_MM === undefined || env.TABLET_PAPER_WIDTH_MM === ""
      ? 80
      : Number(env.TABLET_PAPER_WIDTH_MM) === 80 ? 80 : 58,
    installUrl: normalizeHttpsUrl(env.PUBLIC_INSTALL_URL)
      || `${kiosk.appUrl.replace(/\/+$/, "")}/instalar`
      || DEFAULT_INSTALL_URL
  };
}

function createKioskSession(kioskId, secret, now = Date.now(), sessionNonce = crypto.randomBytes(24).toString("base64url")) {
  const csrfToken = crypto.randomBytes(32).toString("hex");
  const payload = {
    kioskId: cleanId(kioskId),
    csrfToken,
    sessionNonce: cleanText(sessionNonce, 160),
    expiresAt: new Date(now + KIOSK_SESSION_SECONDS * 1000).toISOString()
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    kioskId: payload.kioskId,
    token: `kiosk.${encoded}.${sign(encoded, secret)}`,
    csrfToken,
    sessionNonce: payload.sessionNonce,
    expiresAt: payload.expiresAt
  };
}

function verifyKioskSession(token, secret, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "kiosk") return null;
  const [, encoded, signature] = parts;
  if (!safeEqual(signature, sign(encoded, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!cleanId(payload.kioskId) || !payload.csrfToken || !cleanText(payload.sessionNonce, 160)) return null;
    if (new Date(payload.expiresAt).getTime() <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

function kioskCookies(session, production = false) {
  const secure = production ? "; Secure" : "";
  return [
    `senhahub_kiosk=${encodeURIComponent(session.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${KIOSK_SESSION_SECONDS}${secure}`,
    `senhahub_kiosk_csrf=${encodeURIComponent(session.csrfToken)}; SameSite=Strict; Path=/; Max-Age=${KIOSK_SESSION_SECONDS}${secure}`
  ];
}

function clearKioskCookies(production = false) {
  const secure = production ? "; Secure" : "";
  return [
    `senhahub_kiosk=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
    `senhahub_kiosk_csrf=; SameSite=Strict; Path=/; Max-Age=0${secure}`
  ];
}

function verifyKioskRequest(headers, secret) {
  const cookieHeader = headerValue(headers, "cookie");
  const session = verifyKioskSession(getCookie(cookieHeader, "senhahub_kiosk"), secret);
  if (!session) return { error: "Totem nao vinculado.", status: 401 };
  const headerToken = headerValue(headers, "x-kiosk-csrf");
  const cookieToken = getCookie(cookieHeader, "senhahub_kiosk_csrf");
  if (!safeEqual(headerToken, session.csrfToken) || !safeEqual(cookieToken, session.csrfToken)) {
    return { error: "Token de seguranca do totem invalido.", status: 403 };
  }
  return session;
}

function verifyPrintAgentRequest(headers, env = process.env) {
  if(headerValue(headers,"x-print-agent-token").length<32)return {error:"Credencial do agente invalida.",status:401};
  const configured = String(env.PRINT_AGENT_TOKEN || "");
  const configuredKioskId = cleanId(env.KIOSK_ID);
  const receivedKioskId = cleanId(headerValue(headers, "x-print-agent-kiosk-id"));
  const mappedTokens = parsePrintAgentTokens(env.PRINT_AGENT_KIOSKS_JSON);
  const expectedToken = mappedTokens[receivedKioskId]
    || (receivedKioskId && receivedKioskId === configuredKioskId ? configured : "");
  if (expectedToken.length < 32) {
    return { error: "Agente de impressao nao configurado.", status: 503 };
  }
  const received = headerValue(headers, "x-print-agent-token");
  if (!safeEqual(received, expectedToken)) {
    return { error: "Credencial do agente invalida.", status: 401 };
  }
  if (!receivedKioskId) {
    return { error: "Agente de impressao nao autorizado para este totem.", status: 403 };
  }
  return { ok: true, kioskId: receivedKioskId };
}

function parsePrintAgentTokens(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .map(([key, token]) => [cleanId(key), String(token || "")])
      .filter(([key, token]) => key && token.length >= 32));
  } catch {
    return {};
  }
}

function validatePhysicalTicketInput(body = {}) {
  const sectorId = cleanId(body.sectorId);
  const idempotencyKey = String(body.idempotencyKey || "").trim();
  if (!sectorId) return { error: "Selecione um setor." };
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(idempotencyKey)) {
    return { error: "Identificador da emissao invalido." };
  }
  return { sectorId, idempotencyKey };
}

function validatePhysicalTicketBundleInput(body = {}) {
  const sectorIds = [...new Set(
    (Array.isArray(body.sectorIds) ? body.sectorIds : [])
      .map(cleanId)
      .filter(Boolean)
  )];
  const idempotencyKey = String(body.idempotencyKey || "").trim();
  if (sectorIds.length < 2) return { error: "Selecione pelo menos dois setores." };
  if (sectorIds.length > 12) return { error: "Selecione no maximo 12 setores." };
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(idempotencyKey)) {
    return { error: "Identificador da emissao invalido." };
  }
  return { sectorIds, idempotencyKey };
}

function printJobDto(row) {
  // PostgREST can represent a NULL composite value returned by an RPC as an
  // empty object. It means there is no job to claim, not a printable job.
  if (!row || !row.id) return null;
  const payload = parsePayload(row.payload);
  return {
    id: row.id,
    ticketId: row.ticket_id,
    kioskId: row.kiosk_id,
    status: row.status,
    attempts: Number(row.attempts || 0),
    payload,
    nextAttemptAt: row.next_attempt_at,
    requiresReview: row.status === "needs_review",
    claimedAt: row.claimed_at,
    printedAt: row.printed_at,
    failedAt: row.failed_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parsePayload(payload) {
  if (!payload) return {};
  if (typeof payload === "object") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function getCookie(cookieHeader, name) {
  const item = String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return String(headers.get(name) || "");
  return String(headers?.[name] || headers?.[name.toLowerCase()] || "");
}

function normalizeHttpsUrl(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  try {
    const url = new URL(input);
    return url.protocol === "https:" ? url.toString().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

function cleanId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function sign(value, secret) {
  return crypto.createHmac("sha256", String(secret || "")).update(value).digest("base64url");
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
  clearKioskCookies,
  createKioskSession,
  kioskCookies,
  loadKioskConfiguration,
  loadTabletPrinterConfiguration,
  printJobDto,
  validatePhysicalTicketBundleInput,
  validatePhysicalTicketInput,
  verifyKioskRequest,
  verifyKioskSession,
  verifyPrintAgentRequest
};
