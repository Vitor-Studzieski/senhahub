const PRIORITY_CATEGORIES = [
  { id: "idoso_60_mais", label: "Idosos acima de 60+ anos", image: "/assets/tablet-priority/idoso.jpg" },
  { id: "crianca_de_colo", label: "Pessoas com criança de colo", image: "/assets/tablet-priority/crianca-de-colo.webp" },
  { id: "gestante", label: "Gestantes", image: "/assets/tablet-priority/gestante.webp" },
  { id: "deficiencia", label: "Pessoas com deficiência", image: "/assets/tablet-priority/acessibilidade.webp" },
  { id: "deficiencia_oculta", label: "Deficiência ocultas", image: "/assets/tablet-priority/deficiencia-oculta.jpg" },
  { id: "autismo", label: "Portadores de autismo", image: "/assets/tablet-priority/autismo.png" },
  { id: "mobilidade_reduzida", label: "Pessoas com mobilidade reduzida", image: "/assets/tablet-priority/mobilidade-reduzida.jpg" },
  { id: "comorbidades", label: "Pessoas com comorbidades", image: "/assets/tablet-priority/comorbidade.jpeg" },
  { id: "doador_de_sangue", label: "Doadores de sangue", image: "/assets/tablet-priority/doador-de-sangue.png" },
  { id: "fibromialgia", label: "Fibromialgia", image: "/assets/tablet-priority/fibromialgia.png" }
];
const PWA_FALLBACK_URL = "https://senhahub.vercel.app/";

const tabletStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

function readTabletStorage(key, fallback = null) {
  try {
    return tabletStorage?.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeTabletStorage(key, value) {
  try {
    tabletStorage?.setItem(key, value);
  } catch {
    // Idempotency persistence is best effort.
  }
}

function removeTabletStorage(key) {
  try {
    tabletStorage?.removeItem(key);
  } catch {
    // Idempotency persistence is best effort.
  }
}

const state = {
  status: null,
  serviceType: null,
  priorityReason: null,
  selectedSector: null,
  step: "type",
  inFlight: false,
  statusRequestInFlight: false,
  issueIdempotencyKey: null,
  printJobs: [],
  printJobStatuses: new Map(),
  printPollTimer: null,
  resultResetTimer: null,
  refreshTimer: null
};

const elements = {
  loading: document.querySelector("#tabletLoading"),
  error: document.querySelector("#tabletError"),
  errorTitle: document.querySelector("#tabletErrorTitle"),
  errorMessage: document.querySelector("#tabletErrorMessage"),
  operation: document.querySelector("#tabletOperation"),
  result: document.querySelector("#tabletResult"),
  connection: document.querySelector("#tabletConnection"),
  pwaQr: document.querySelector("#tabletPwaQr"),
  resultQr: document.querySelector("#tabletResultQr"),
  feedback: document.querySelector("#tabletFeedback"),
  priorityOptions: document.querySelector("#tabletPriorityOptions"),
  confirmSummary: document.querySelector("#tabletConfirmSummary"),
  issueButton: document.querySelector("#tabletIssueButton"),
  resultTickets: document.querySelector("#tabletResultTickets"),
  printStatus: document.querySelector("#tabletPrintStatus")
};

document.querySelectorAll("[data-tablet-type]").forEach((button) => {
  button.addEventListener("click", () => selectServiceType(button.dataset.tabletType));
});
document.querySelector("#tabletBackToType")?.addEventListener("click", () => setStep("type"));
document.querySelector("#tabletBackToSector")?.addEventListener("click", () => setStep("type"));
elements.issueButton?.addEventListener("click", issueTicket);
document.querySelector("#tabletNewRequest")?.addEventListener("click", resetOperation);
document.querySelector("#tabletLogoutButton")?.addEventListener("click", logout);

renderPriorityOptions();
loadStatus();

async function loadStatus() {
  setConnection("loading", "Conectando");
  try {
    const response = await fetch("/api/tablet/status", { credentials: "same-origin", cache: "no-store" });
    const payload = await parseApiPayload(response);
    if (response.status === 401) {
      location.href = "/login?next=%2Ftablet";
      return;
    }
    if (!response.ok || payload.error) throw new Error(payload.error || "Não foi possível carregar os setores.");
    state.status = payload;
    state.selectedSector = payload.sector || payload.sectors?.[0] || null;
    if (!state.selectedSector) throw new Error("Esta conta não está vinculada a um setor aberto.");
    renderPwaQr(payload.appUrl);
    renderStatus();
    setConnection("online", "Tablet online");
  } catch (error) {
    showError("Acesso indisponível", error.message);
    setConnection("offline", "Falha de conexão");
  }
}

function renderStatus() {
  elements.loading.hidden = true;
  elements.error.hidden = true;
  elements.operation.hidden = false;
  elements.result.hidden = true;
  resetOperation();
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(refreshStatus, 5000);
}

function renderPwaQr(value) {
  renderQr(elements.pwaQr, value || PWA_FALLBACK_URL, "QR indisponível");
}

function renderResultQr(value) {
  renderQr(elements.resultQr, value || state.status?.appUrl || PWA_FALLBACK_URL, "QR indisponível");
}

function renderQr(target, value, fallback) {
  if (!target || target.childElementCount) return;
  const targetUrl = normalizePwaUrl(value);
  if (!targetUrl || typeof window.qrcode !== "function") {
    target.textContent = fallback;
    return;
  }
  const code = window.qrcode(0, "M");
  code.addData(targetUrl, "Byte");
  code.make();
  target.innerHTML = code.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
}

function normalizePwaUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.origin);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

async function refreshStatus() {
  if (elements.operation.hidden) return;
  if (state.statusRequestInFlight) return;
  state.statusRequestInFlight = true;
  try {
    const response = await fetch("/api/tablet/status", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    state.status = await response.json();
    state.selectedSector = state.status.sector || state.status.sectors?.[0] || state.selectedSector;
  } catch {
    // A lista atual continua disponível até a próxima atualização.
  } finally {
    state.statusRequestInFlight = false;
  }
}

function renderPriorityOptions() {
  elements.priorityOptions.innerHTML = PRIORITY_CATEGORIES.map((category) => `
    <button class="tablet-priority" type="button" data-tablet-priority="${category.id}">
      <img class="tablet-priority-image" src="${category.image}" alt="" loading="lazy" />
      <strong>${escapeHtml(category.label)}</strong>
    </button>
  `).join("");
  elements.priorityOptions.querySelectorAll("[data-tablet-priority]").forEach((button) => {
    button.addEventListener("click", () => {
      state.priorityReason = button.dataset.tabletPriority;
      elements.priorityOptions.querySelectorAll(".selected").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      issueTicket();
    });
  });
}

function selectServiceType(type) {
  state.serviceType = type === "preferencial" ? "preferencial" : "normal";
  state.priorityReason = null;
  document.querySelectorAll("[data-tablet-type]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.tabletType === state.serviceType);
  });
  elements.priorityOptions.querySelectorAll(".selected").forEach((item) => item.classList.remove("selected"));
  if (state.serviceType === "preferencial") setStep("priority");
  else issueTicket();
}

function setStep(step) {
  state.step = step;
  elements.operation.dataset.tabletStep = step;
  const steps = {
    type: document.querySelector("#tabletStepType"),
    priority: document.querySelector("#tabletStepPriority"),
    confirm: document.querySelector("#tabletStepConfirm")
  };
  Object.entries(steps).forEach(([name, element]) => { element.hidden = name !== step; });
  document.querySelectorAll("[data-tablet-progress]").forEach((item) => {
    item.classList.toggle("active", item.dataset.tabletProgress === step);
  });
  if (step === "confirm") renderConfirmSummary();
  elements.feedback.textContent = "";
}

function renderConfirmSummary() {
  const category = PRIORITY_CATEGORIES.find((item) => item.id === state.priorityReason);
  const service = state.serviceType === "preferencial" ? "ATENDIMENTO PREFERENCIAL" : "ATENDIMENTO PADRÃO";
  elements.confirmSummary.innerHTML = [
    `<div><span>Tipo de atendimento</span><strong>${escapeHtml(service)}</strong></div>`,
    state.serviceType === "preferencial" ? `<div><span>Categoria</span><strong>${escapeHtml(category?.label || "Não selecionada")}</strong></div>` : "",
    `<div><span>Setor</span><strong>${escapeHtml(state.selectedSector?.name || "Não selecionado")}</strong></div>`
  ].join("");
}

async function issueTicket() {
  if (!state.selectedSector || state.inFlight) return;
  state.inFlight = true;
  state.issueIdempotencyKey ||= createIdempotencyKey();
  const requestButtons = document.querySelectorAll("[data-tablet-type], [data-tablet-priority]");
  requestButtons.forEach((button) => { button.disabled = true; });
  elements.issueButton.disabled = true;
  elements.issueButton.textContent = "Solicitando...";
  elements.feedback.textContent = "";
  try {
    const operationKey = 'senhahub:issuance:tablet:' + (state.status?.user?.id || state.selectedSector.id);
    let body = {
      sectorId: state.selectedSector.id, idempotencyKey: state.issueIdempotencyKey,
      priority: state.serviceType === 'preferencial', priorityReason: state.priorityReason
    };
    const pending = readTabletStorage(operationKey);
    if (pending) body = JSON.parse(pending);
    else writeTabletStorage(operationKey, JSON.stringify(body));
    const payload = await api('/api/tablet/tickets', { method:'POST', body });
    if (!payload.printJob?.id) throw new Error("A senha foi emitida, mas não entrou na fila de impressão.");
    const tickets = payload.tickets || (payload.ticket ? [payload.ticket] : []);
    removeTabletStorage(operationKey);
    renderResult(tickets, [payload.printJob]);
  } catch (error) {
    elements.feedback.textContent = error.message;
  } finally {
    requestButtons.forEach((button) => { button.disabled = false; });
    state.inFlight = false;
    elements.issueButton.disabled = false;
    elements.issueButton.textContent = "Emitir e imprimir senha";
  }
}

function renderResult(tickets, printJobs = []) {
  elements.operation.hidden = true;
  elements.result.hidden = false;
  state.printJobs = printJobs;
  state.printJobStatuses = new Map(printJobs.map((job) => [job.id, job.status || "pending"]));
  elements.resultTickets.innerHTML = tickets.map((ticket) => `
      <article class="tablet-ticket-card">
      <span>${escapeHtml(ticket.sector || "Setor")}</span>
      <strong>${escapeHtml(ticket.ticket || "---")}</strong>
      <small class="${ticket.priority ? "tablet-ticket-type-priority" : "tablet-ticket-type-normal"}">${ticket.priority ? "ATENDIMENTO PREFERENCIAL" : "ATENDIMENTO PADRÃO"}</small>
    </article>
  `).join("");
  const trackingUrl = printJobs[0]?.payload?.trackUrl || state.status?.appUrl || PWA_FALLBACK_URL;
  renderResultQr(trackingUrl);
  setPrintState();
  if (printJobs.length) pollPrintJobs(printJobs.map((job) => job.id));
  clearTimeout(state.resultResetTimer);
  state.resultResetTimer = setTimeout(resetOperation, 8000);
}

async function pollPrintJobs(jobIds) {
  clearTimeout(state.printPollTimer);
  const results = await Promise.all(jobIds.map(async (jobId) => {
    try {
      const payload = await api(`/api/tablet/print-jobs/${encodeURIComponent(jobId)}`);
      return { jobId, status: payload.job?.status || "failed", error: payload.job?.lastError || "" };
    } catch (error) {
      return { jobId, status: "unavailable", error: error.message };
    }
  }));
  if (elements.result.hidden) return;
  results.forEach((result) => state.printJobStatuses.set(result.jobId, result.status));
  setPrintState(results);
  if (results.some((result) => ["pending", "leased", "printing", "retry_wait", "unavailable"].includes(result.status))) {
    state.printPollTimer = setTimeout(() => pollPrintJobs(jobIds), 1200);
  }
}

function setPrintState(latestResults = []) {
  if (!elements.printStatus) return;
  const statuses = [...state.printJobStatuses.values()];
  if (!statuses.length) {
    elements.printStatus.textContent = "Senha emitida.";
    elements.printStatus.dataset.state = "printed";
    return;
  }
  const status = ["needs_review", "failed", "retry_wait", "printing", "leased", "pending", "unavailable"]
    .find((value) => statuses.includes(value)) || "printed";
  const message = status === "failed"
    ? latestResults.find((result) => result.status === "failed")?.error || "Falha na impressão. Solicite ajuda."
    : {
        pending: "Senha emitida; aguardando a Bematech.",
        leased: "Trabalho reservado pela Bematech.",
        retry_wait: "Falha antes do envio. Nova tentativa agendada.",
        needs_review: "Resultado incerto. Solicite ajuda; não emita novamente.",
        unavailable: "Senha emitida. Consulta da impressão indisponível.",
        printing: "Imprimindo sua senha na Bematech...",
        printed: "Senha impressa. Retire o papel."
      }[status];
  elements.printStatus.dataset.state = status;
  elements.printStatus.textContent = message;
}

function resetOperation() {
  clearTimeout(state.printPollTimer);
  clearTimeout(state.resultResetTimer);
  state.printPollTimer = null;
  state.resultResetTimer = null;
  state.serviceType = null;
  state.priorityReason = null;
  state.issueIdempotencyKey = null;
  state.printJobs = [];
  state.printJobStatuses = new Map();
  if (elements.resultQr) elements.resultQr.innerHTML = "";
  document.querySelectorAll("[data-tablet-type], .tablet-priority").forEach((item) => item.classList.remove("selected"));
  setStep("type");
  elements.result.hidden = true;
  elements.operation.hidden = false;
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch { /* A sessão pode já estar expirada. */ }
  location.href = "/login";
}

function showError(title, message) {
  elements.loading.hidden = true;
  elements.operation.hidden = true;
  elements.result.hidden = true;
  elements.error.hidden = false;
  elements.errorTitle.textContent = title;
  elements.errorMessage.textContent = message;
}

function setConnection(stateName, label) {
  elements.connection.dataset.state = stateName;
  const strong = elements.connection.querySelector("strong");
  if (strong) strong.textContent = label;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...csrfHeader() },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await parseApiPayload(response);
  if (!response.ok || payload.error) throw new Error(payload.error || "Falha na comunicação com o sistema.");
  return payload;
}

async function parseApiPayload(response) {
  const text = await response.text();
  if (!text.trim()) return response.ok ? {} : { error: "Falha na comunicação com o sistema." };
  try { return JSON.parse(text); } catch { return { error: `Falha na comunicação com o sistema (${response.status}).` }; }
}

function csrfHeader() {
  const token = getCookie("senhahub_csrf");
  return token ? { "x-csrf-token": token } : {};
}

function getCookie(name) {
  return document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return `tablet-${globalThis.crypto.randomUUID()}`;
  return `tablet-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
