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
  rawbtPrintInFlight: false,
  rawbtPrintJob: null,
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
  feedback: document.querySelector("#tabletFeedback"),
  priorityOptions: document.querySelector("#tabletPriorityOptions"),
  confirmSummary: document.querySelector("#tabletConfirmSummary"),
  issueButton: document.querySelector("#tabletIssueButton"),
  resultTickets: document.querySelector("#tabletResultTickets"),
  printStatus: document.querySelector("#tabletPrintStatus"),
  printAgainButton: document.querySelector("#tabletPrintAgain")
};

document.querySelectorAll("[data-tablet-type]").forEach((button) => {
  button.addEventListener("click", () => selectServiceType(button.dataset.tabletType));
});
document.querySelector("#tabletBackToType")?.addEventListener("click", () => setStep("type"));
document.querySelector("#tabletBackToSector")?.addEventListener("click", () => setStep("type"));
elements.issueButton?.addEventListener("click", issueTicket);
elements.printAgainButton?.addEventListener("click", () => {
  if (state.rawbtPrintJob) sendToRawbt(state.rawbtPrintJob);
});
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
  state.refreshTimer = setInterval(refreshStatus, 2000);
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
      setStep("confirm");
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
  const service = state.serviceType === "preferencial" ? "Atendimento preferencial" : "Atendimento normal";
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
  elements.feedback.textContent = "Emitindo e imprimindo...";
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
  state.rawbtPrintJob = printJobs[0] || null;
  elements.resultTickets.innerHTML = tickets.map((ticket) => `
    <article class="tablet-ticket-card">
      <span>${escapeHtml(ticket.sector || "Setor")}</span>
      <strong>${escapeHtml(ticket.ticket || "---")}</strong>
      <small>${ticket.priority ? "Atendimento preferencial" : "Atendimento normal"}</small>
    </article>
  `).join("");
  elements.printAgainButton.hidden = !state.rawbtPrintJob?.rawbtUrl;
  setPrintState("pending", state.rawbtPrintJob?.rawbtUrl
    ? "Preparando a impressão pelo RawBT..."
    : "A impressão não está configurada.");
  if (state.rawbtPrintJob?.rawbtUrl) {
    setTimeout(() => sendToRawbt(state.rawbtPrintJob), 0);
  }
}

async function sendToRawbt(printJob) {
  if (!printJob?.id || !printJob.rawbtUrl || state.rawbtPrintInFlight || elements.result.hidden) return;
  state.rawbtPrintInFlight = true;
  elements.printAgainButton.disabled = true;
  setPrintState("printing", "Enviando a senha para o RawBT...");
  try {
    await api(`/api/tablet/print-jobs/${encodeURIComponent(printJob.id)}/rawbt`, {
      method: "POST",
      body: {}
    });
    setPrintState("printed", "Senha enviada ao RawBT. Retire o papel da impressora.");
    window.location.href = printJob.rawbtUrl;
  } catch (error) {
    setPrintState("failed", error.message || "Não foi possível enviar a senha ao RawBT.");
  } finally {
    state.rawbtPrintInFlight = false;
    elements.printAgainButton.disabled = false;
    elements.printAgainButton.hidden = false;
  }
}

function setPrintState(stateName, message) {
  if (!elements.printStatus) return;
  elements.printStatus.dataset.state = stateName;
  elements.printStatus.textContent = message;
}

function resetOperation() {
  state.serviceType = null;
  state.priorityReason = null;
  state.issueIdempotencyKey = null;
  state.printJobs = [];
  state.rawbtPrintInFlight = false;
  state.rawbtPrintJob = null;
  elements.printAgainButton.hidden = true;
  elements.printAgainButton.disabled = false;
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
