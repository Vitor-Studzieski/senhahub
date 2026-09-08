const screens = {
  home: "Supermercado Pompeia",
  sectors: "Fila virtual",
  ticket: "Minha senha",
  status: "Acompanhamento",
  done: "Atendimento",
  account: "Conta",
  rating: "Avaliação"
};

const SMART_WAIT_STATUS = "espera_inteligente";
const CANCELABLE_STATUSES = new Set(["aguardando", "proximo", "chamado", SMART_WAIT_STATUS, "standby"]);
const PRIORITY_LABELS = {
  deficiencia_ou_mobilidade_reduzida: "Deficiencia ou mobilidade reduzida",
  tea: "TEA",
  idoso_60_mais: "Idoso 60+",
  gestante_ou_lactante: "Gestante ou lactante",
  crianca_de_colo: "Crianca de colo",
  obesidade: "Obesidade"
};

// Safari can expose localStorage while still throwing QuotaExceededError on
// getItem/setItem. Persistence is best effort; queue operations must continue
// to use the server when browser storage is unavailable.
const appStorage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

function readAppStorage(key, fallback = null) {
  try {
    return appStorage?.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeAppStorage(key, value) {
  try {
    appStorage?.setItem(key, value);
  } catch {
    // Storage is optional and must never block the PWA.
  }
}

function removeAppStorage(key) {
  try {
    appStorage?.removeItem(key);
  } catch {
    // Storage is optional and must never block the PWA.
  }
}

const identity = getOrCreateIdentity();
let currentUser = null;
let alertPreferences = loadAlertPreferences();
let queueTutorialSeen = readAppStorage("senhaHubQueueTutorialSeen") === "1";

let activeScreen = "home";
let currentSector = null;
let activeQueues = {};
let sectors = {};
let stateSource = null;
let pollingTimer = null;
let previousTicketStatuses = new Map();
let countdownTimer = null;
let activeJoinSector = null;
let selectedSectorIds = new Set();
let ticketRequestInFlight = false;
const STATE_POLL_INTERVAL_MS = 12000;
let queueAlertHistory = new Set();
let visibleQueueAlert = null;

const SECTOR_ID_ALIASES = {
  acougue: "acougue",
  frios: "frios",
  padaria: "padaria"
};

init();

async function init() {
  syncMobileViewport();
  bindEvents();
  syncPriorityControls();
  syncAlertControls();
  navigate("home");
  currentUser = await requireSession(["customer", "manager", "admin"]);
  syncAccessArea();
  renderAccount();
  renderHome();
  identity.customerId = currentUser.customerId;
  writeAppStorage("senhaHubIdentity", JSON.stringify(identity));
  await Promise.all([syncSession(), loadState()]);
  applyRequestedView();
  connectRealtime();
  startCountdownTimer();
}

function syncMobileViewport() {
  const root = document.documentElement;
  const apply = () => {
    const viewport = window.visualViewport;
    const width = Math.round(viewport?.width || window.innerWidth);
    const height = Math.round(viewport?.height || window.innerHeight);
    root.style.setProperty("--app-viewport-width", `${width}px`);
    root.style.setProperty("--app-viewport-height", `${height}px`);
    root.style.setProperty("--app-viewport-top", `${Math.round(viewport?.offsetTop || 0)}px`);
  };
  apply();
  window.addEventListener("resize", apply, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(apply, 120), { passive: true });
  window.visualViewport?.addEventListener("resize", apply, { passive: true });
  window.visualViewport?.addEventListener("scroll", apply, { passive: true });
}

function getOrCreateIdentity() {
  const params = new URLSearchParams(location.search);
  const sharedCustomerId = params.get("cliente") || params.get("customer_id");
  const stored = safeJsonParse(readAppStorage("senhaHubIdentity"), {});
  const identity = {
    customerId: sharedCustomerId || stored.customerId || `cliente-${createBrowserId()}`,
    deviceId: stored.deviceId || `device-${createBrowserId()}`
  };
  writeAppStorage("senhaHubIdentity", JSON.stringify(identity));
  return identity;
}

function createBrowserId() {
  const browserCrypto = window.crypto;
  if (typeof browserCrypto?.randomUUID === "function") return browserCrypto.randomUUID();

  if (typeof browserCrypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    browserCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => {
      const value = byte.toString(16);
      return value.length === 1 ? `0${value}` : value;
    });
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10, 16).join("")
    ].join("-");
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function syncSession() {
  const session = await api("/api/sessions", {
    method: "POST",
    body: identity
  });
  identity.customerId = session.customerId;
  identity.deviceId = session.deviceId;
  writeAppStorage("senhaHubIdentity", JSON.stringify(identity));
}

async function loadState() {
  const state = await api(`/api/state?customer_id=${encodeURIComponent(identity.customerId)}`);
  applyState(state);
}

function connectRealtime() {
  stateSource?.close();
  stateSource = null;
  startStatePolling();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadState().catch(() => {});
  });
}

function startStatePolling() {
  if (pollingTimer) return;
  pollingTimer = setInterval(() => {
    if (document.hidden) return;
    loadState().catch(() => {});
  }, STATE_POLL_INTERVAL_MS);
}

function applyState(state) {
  const nextStatuses = new Map();
  let newlyCalledTicket = null;
  sectors = Object.fromEntries(state.sectors.map((sector) => [sector.id, sector]));
  activeQueues = Object.fromEntries(state.tickets.map((ticket) => [ticket.sectorId, withLiveCountdown(ticket)]));

  state.tickets.forEach((ticket) => {
    nextStatuses.set(ticket.id, ticket.status);
    if (ticket.status === "chamado" && previousTicketStatuses.get(ticket.id) !== "chamado") {
      currentSector = ticket.sectorId;
      newlyCalledTicket = ticket;
    }
  });

  previousTicketStatuses = nextStatuses;
  pruneQueueAlertHistory(state.tickets);
  if (!currentSector || !activeQueues[currentSector]) currentSector = Object.keys(activeQueues)[0] || null;
  syncQueue();
  if (newlyCalledTicket) announceCalledTicket(activeQueues[newlyCalledTicket.sectorId] || newlyCalledTicket);
}

function applyRequestedView() {
  const view = new URLSearchParams(location.search).get("view");
  if (["status", "account"].includes(view)) navigate(view);
}

async function handlePushRefresh(event) {
  try {
    await loadState();
  } catch (exception) {
    console.warn("push_state_refresh_failed", exception);
  }
}

function startCountdownTimer() {
  if (countdownTimer) return;
  countdownTimer = setInterval(() => {
    if (!Object.values(activeQueues).some((ticket) => hasLiveCountdown(ticket) || hasStandbyCountdown(ticket))) return;
    activeQueues = Object.fromEntries(
      Object.entries(activeQueues).map(([sectorId, ticket]) => [sectorId, withLiveCountdown(ticket)])
    );
    syncQueue();
  }, 1000);
}

function withLiveCountdown(ticket) {
  if (hasStandbyCountdown(ticket)) {
    const remaining = Math.ceil((new Date(ticket.standbyExpiresAt).getTime() - Date.now()) / 1000);
    return { ...ticket, standbySecondsRemaining: Math.max(0, remaining) };
  }
  if (!hasLiveCountdown(ticket)) return ticket;
  const remaining = Math.ceil((new Date(ticket.estimatedCallAt).getTime() - Date.now()) / 1000);
  return {
    ...ticket,
    secondsToCall: Math.max(0, remaining),
    countdownTotalSeconds: Math.max(ticket.countdownTotalSeconds || 0, remaining)
  };
}

function hasLiveCountdown(ticket) {
  return Boolean(ticket?.estimatedCallAt && ["aguardando", "proximo"].includes(ticket.status));
}

function hasStandbyCountdown(ticket) {
  return Boolean(ticket?.status === "standby" && ticket.standbyExpiresAt);
}

function navigate(screen) {
  if (!screens[screen]) return;
  activeScreen = screen;
  document.querySelectorAll(".screen").forEach((item) => item.classList.toggle("active", item.dataset.screen === screen));
  document.querySelector("#appTitle").textContent = screens[screen];
  document.querySelector("#backButton")?.classList.toggle("is-hidden", screen === "home");
  if (screen === "home") renderHome();
  if (screen === "done") renderServiceScreen();
  if (screen === "account") renderAccount();
  updateTabs(screen);
  updateFloatingQueue();
  maybeShowQueueTutorial(screen);
}

function maybeShowQueueTutorial(screen) {
  if (queueTutorialSeen) return;
  if (!["sectors", "ticket", "status"].includes(screen)) return;
  openQueueTutorial({ automatic: true });
}

function openQueueTutorial(options = {}) {
  const modal = document.querySelector("#queueTutorial");
  if (!modal) return;
  modal.hidden = false;
  if (options.automatic) markQueueTutorialSeen();
}

function closeQueueTutorial() {
  document.querySelector("#queueTutorial").hidden = true;
  markQueueTutorialSeen();
}

function markQueueTutorialSeen() {
  queueTutorialSeen = true;
  writeAppStorage("senhaHubQueueTutorialSeen", "1");
}

function syncAccessArea() {
  const isManager = ["manager", "admin"].includes(currentUser?.role);
  const isAdmin = ["manager", "admin"].includes(currentUser?.role);
  document.querySelectorAll(".manager-access").forEach((item) => {
    item.hidden = !isManager;
  });
  document.querySelectorAll(".admin-access").forEach((item) => {
    item.hidden = !isAdmin;
  });
  const authorizedPanel = document.querySelector("#authorizedPanel");
  if (authorizedPanel) authorizedPanel.hidden = !isManager && !isAdmin;
}

function renderAccount() {
  if (!currentUser) return;
  const name = currentUser.name || "Cliente";
  const email = currentUser.email || "--";
  const role = roleLabel(currentUser.role);
  setText("#accountName", name);
  setText("#accountEmail", email);
  setText("#accountRole", role);
  setText("#accountStatus", currentUser.status === "inactive" ? "Inativo" : "Ativo");
  setText("#accountAvatar", initials(name, email));
}

function renderHome() {
  const name = currentUser?.name || "Cliente";
  const queueCount = Object.keys(activeQueues).length;
  const sectorList = Object.values(sectors);
  const openSectorCount = sectorList.filter((sector) => sector.status === "open").length;
  const status = document.querySelector(".welcome-status");

  setText("#homeFirstName", firstName(name));
  setText("#homeQueueActionTitle", "Retirar minha senha");
  setText("#homeQueueActionText", "Escolha o setor e acompanhe sua vez");
  status?.classList.toggle("has-active", queueCount > 0);

  if (queueCount > 0) {
    setText("#homeAvailability", `${queueCount} ${queueCount === 1 ? "senha ativa" : "senhas ativas"} agora`);
    return;
  }

  setText(
    "#homeAvailability",
    sectorList.length === 0
      ? "Preparando os setores..."
      : openSectorCount > 0
        ? "Atendimento disponível agora"
        : "Setores fechados no momento"
  );
}

function firstName(value) {
  const name = String(value || "").trim();
  if (!name || name.includes("@")) return "Cliente";
  return name.split(/\s+/)[0];
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function initials(name, email) {
  const source = String(name || email || "Cliente").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function roleLabel(role) {
  return {
    customer: "Cliente",
    attendant: "Funcionário",
    manager: "Gestor",
    admin: "Administrador"
  }[role] || "Cliente";
}

function updateTabs(screen) {
  document.querySelectorAll(".tabbar button").forEach((button) => {
    const tab = button.dataset.tab;
    button.classList.toggle("on", tab === screen || (tab === "sectors" && ["sectors", "ticket", "status", "done", "rating"].includes(screen)));
  });
}

async function joinQueue(sectorId) {
  const resolvedSectorId = resolveSectorId(sectorId);
  if (!resolvedSectorId || !sectors[resolvedSectorId]) return;
  if (ticketRequestInFlight) return;
  const sector = sectors[resolvedSectorId];
  if (sector.status !== "open") return;
  if (activeQueues[resolvedSectorId]) {
    currentSector = resolvedSectorId;
    navigate("status");
    return;
  }
  ticketRequestInFlight = true;
  activeJoinSector = resolvedSectorId;
  syncActionButtons();
  try {
    const result = await createDigitalTicket(resolvedSectorId);
    currentSector = result.ticket.sectorId;
    activeQueues[result.ticket.sectorId] = withLiveCountdown(result.ticket);
    syncQueue();
    navigate("status");
  } catch (exception) {
    alert(exception.message);
  } finally {
    ticketRequestInFlight = false;
    activeJoinSector = null;
    syncActionButtons();
  }
}

async function requestSelectedTickets() {
  if (ticketRequestInFlight) return;
  const sectorIds = [...new Set([...selectedSectorIds].map(resolveSectorId).filter(Boolean))].filter((sectorId) => (
    sectors[sectorId]?.status === "open" && !activeQueues[sectorId]
  ));
  if (!sectorIds.length) {
    alert("Selecione pelo menos um local disponível.");
    return;
  }
  let priority;
  try {
    priority = priorityPayload();
  } catch (exception) {
    alert(exception.message);
    return;
  }

  ticketRequestInFlight = true;
  activeJoinSector = "__multi__";
  syncActionButtons();
  try {
    const results = await Promise.allSettled(sectorIds.map((sectorId) => createDigitalTicket(sectorId, priority)));
    const successful = [];
    const failures = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value?.ticket) {
        const ticket = result.value.ticket;
        activeQueues[ticket.sectorId] = withLiveCountdown(ticket);
        successful.push(ticket);
        return;
      }
      const reason = result.reason?.message || "não foi possível emitir a senha";
      failures.push(`${sectors[sectorIds[index]]?.name || sectorIds[index]}: ${reason}`);
    });

    selectedSectorIds.clear();
    if (successful.length) {
      currentSector = successful[0].sectorId;
      syncQueue();
      navigate("status");
    }
    if (failures.length) {
      alert(successful.length
        ? `Algumas senhas não foram emitidas:\n${failures.join("\n")}`
        : failures.join("\n"));
    }
  } finally {
    ticketRequestInFlight = false;
    activeJoinSector = null;
    syncActionButtons();
  }
}

function createDigitalTicket(sectorId, priority = priorityPayload()) {
  return api("/api/tickets", {
    method: "POST",
    body: { ...identity, sectorId, ...priority }
  });
}

function resolveSectorId(requestedId) {
  const normalizedId = String(requestedId || "").trim();
  if (!normalizedId) return null;
  if (sectors[normalizedId]) return normalizedId;

  const baseId = normalizedId.replace(/-loja-\d+$/, "");
  const alias = SECTOR_ID_ALIASES[baseId] || baseId;
  const candidates = Object.keys(sectors).filter((sectorId) => (
    sectorId === alias || sectorId.startsWith(`${alias}-loja-`)
  ));
  if (!candidates.length) return null;

  const activeCandidate = candidates.find((sectorId) => activeQueues[sectorId]);
  if (activeCandidate) return activeCandidate;

  const preferredStoreCode = currentUser?.storeCode || "loja-2";
  const preferredCandidate = candidates.find((sectorId) => sectorId === `${alias}-${preferredStoreCode}`);
  if (preferredCandidate) return preferredCandidate;

  // Keep the old single-store ids working for local/legacy data when no
  // preferred store-specific sector exists.
  return candidates.sort((first, second) => {
    const firstStore = first.endsWith("-loja-2") ? 0 : first.endsWith("-loja-1") ? 1 : 2;
    const secondStore = second.endsWith("-loja-2") ? 0 : second.endsWith("-loja-1") ? 1 : 2;
    return firstStore - secondStore;
  })[0];
}

function priorityPayload() {
  const toggle = document.querySelector("#priorityToggle");
  const reason = document.querySelector("#priorityReason")?.value || "";
  const priority = Boolean(toggle?.checked);
  if (!priority) return { priority: false, priorityReason: "" };
  if (!reason) throw new Error("Selecione a categoria da fila preferencial.");
  return { priority: true, priorityReason: reason };
}

function syncQueue() {
  const activeCount = Object.keys(activeQueues).length;
  const data = getCurrentQueueData();
  const serviceSector = getServiceInProgressSector();
  const hasQueue = Boolean(data);

  document.querySelector("#queueBanner").classList.toggle("visible", hasQueue);
  document.querySelector("#bannerTicket").textContent = hasQueue ? displayCustomerName(data) : "";
  document.querySelector("#bannerText").textContent = hasQueue ? bannerText(data, activeCount) : "";
  document.querySelector("#bannerProgress").style.width = hasQueue ? `${data.progress}%` : "0%";

  document.querySelector("#ticketNumber").textContent = hasQueue ? displayCustomerName(data) : "--";
  document.querySelector("#ticketSupportCode").textContent = hasQueue ? supportCode(data) : "Código --";
  document.querySelector("#ticketSector").textContent = hasQueue ? data.sector : "Nenhuma senha ativa";
  document.querySelector("#ticketSub").textContent = hasQueue ? ticketSubText(data) : "Solicite uma senha em um setor para acompanhar.";
  document.querySelector("#currentQueue").textContent = hasQueue ? currentCallText(data) : "--";
  document.querySelector("#ticketSuccessCard").classList.toggle("visible", hasQueue);
  document.querySelector("#ticketSuccessText").textContent = hasQueue
    ? `Nome: ${displayCustomerName(data)}. ${supportCode(data)}. Setor: ${data.sector}. Voce sera avisado quando estiver proximo.`
    : "Voce sera avisado quando estiver proximo.";
  renderPriorityBadge(document.querySelector("#ticketPriorityBadge"), data);

  document.querySelector("#statusSector").textContent = hasQueue ? `${data.sector} · ${data.counterLabel}` : "Nenhuma senha ativa";
  document.querySelector("#statusCurrentTicket").textContent = hasQueue ? data.current || "--" : "--";
  document.querySelector("#statusYourTicket").textContent = hasQueue ? data.ticket || "--" : "--";
  updateQueueAlert(data);
  updateCallNotification(data);
  renderPriorityBadge(document.querySelector("#statusPriorityBadge"), data);
  renderStatusTicketBundle();
  const confirmButton = document.querySelector("#confirmCall");
  if (confirmButton) confirmButton.hidden = data?.status !== "chamado";
  document.querySelector(".ticket-circle").classList.toggle("priority-ticket", Boolean(hasQueue && data.priority));

  document.querySelector("#statusFinishButton").classList.toggle("visible", Boolean(serviceSector));
  document.querySelector("#statusFinishButton").textContent = serviceSector && serviceSector !== currentSector
    ? `Informar fim do pedido em ${activeQueues[serviceSector].sector}`
    : "Informar fim do pedido";

  document.querySelector("#floatingTicket").textContent = hasQueue ? displayCustomerName(data) : "";
  document.querySelector("#floatingTime").textContent = hasQueue ? floatingTimeText(data) : "";
  document.querySelector("#ticketCancelButton").classList.toggle("visible", canCancelTicket(data));
  document.querySelector("#statusCancelButton").classList.toggle("visible", canCancelTicket(data));

  renderActiveTickets();
  renderSectorCards();
  renderHome();
  updateFloatingQueue();
}

function getCurrentQueueData() {
  if (currentSector && activeQueues[currentSector]) return activeQueues[currentSector];
  const firstSector = Object.keys(activeQueues)[0];
  if (!firstSector) return null;
  currentSector = firstSector;
  return activeQueues[firstSector];
}

function renderStatusTicketBundle() {
  const mainCard = document.querySelector(".status-ticket-card");
  const bundle = document.querySelector("#statusTicketBundle");
  const sectorLabel = document.querySelector("#statusSector");
  const priorityBadge = document.querySelector("#statusPriorityBadge");
  if (!mainCard || !bundle) return;

  const entries = Object.entries(activeQueues);
  const showBundle = entries.length > 1;
  mainCard.hidden = showBundle;
  if (sectorLabel) sectorLabel.hidden = showBundle;
  if (priorityBadge) priorityBadge.hidden = showBundle || !getCurrentQueueData()?.priority;
  bundle.hidden = !showBundle;

  if (!showBundle) {
    bundle.innerHTML = "";
    return;
  }

  bundle.innerHTML = entries.map(([, data]) => `
    <article class="status-ticket-bundle-card" aria-label="Senha ativa de ${escapeHtml(data.sector || "Setor")}">
      <div class="status-bundle-head">
        <div class="status-bundle-sector">
          <strong>${escapeHtml(data.sector || "Setor")}</strong>
          <small>${escapeHtml(data.counterLabel || "Balcão")}</small>
        </div>
        <span class="status-bundle-state">${escapeHtml(statusText(data))}</span>
      </div>
      ${data.priority ? priorityBadgeMarkup("status-bundle-priority") : ""}
      <div class="status-ticket-overview">
        <div class="status-ticket-panel status-ticket-current">
          <span>Senha atual</span>
          <strong>${escapeHtml(data.current || "--")}</strong>
        </div>
        <div class="status-ticket-panel status-ticket-yours">
          <span>Sua senha</span>
          <strong>${escapeHtml(data.ticket || "--")}</strong>
        </div>
      </div>
    </article>
  `).join("");
}

function hasActiveQueues() {
  return Object.keys(activeQueues).length > 0;
}

function getServiceInProgressSector() {
  return Object.keys(activeQueues).find((sectorId) => activeQueues[sectorId].status === "em_atendimento") || null;
}

function canCancelTicket(ticket) {
  return Boolean(ticket && CANCELABLE_STATUSES.has(ticket.status));
}

async function cancelCurrentTicket(ticketId = null) {
  const data = ticketId
    ? Object.values(activeQueues).find((ticket) => ticket.id === ticketId)
    : getCurrentQueueData();
  if (!canCancelTicket(data)) return;
  if (!confirm(`Cancelar ${displayCustomerName(data)} (${supportCode(data)}) de ${data.sector}?`)) return;

  try {
    await api(`/api/tickets/${encodeURIComponent(data.id)}/cancel`, { method: "POST", body: identity });
    await loadState();
    navigate(hasActiveQueues() ? "status" : "sectors");
  } catch (exception) {
    alert(exception.message);
  }
}

function getNextSmartWaitSector() {
  return Object.entries(activeQueues)
    .filter(([, data]) => data.status === SMART_WAIT_STATUS)
    .sort(([, a], [, b]) => new Date(a.createdAt) - new Date(b.createdAt))[0]?.[0] || null;
}

async function confirmCall() {
  const data = getCurrentQueueData();
  if (!data || data.status !== "chamado") return;
  const button = document.querySelector("#confirmCall");
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.textContent = "Confirmando...";
  }
  try {
    await api(`/api/tickets/${encodeURIComponent(data.id)}/confirm`, { method: "POST", body: identity });
    await loadState();
    navigate("done");
  } catch (exception) {
    alert(exception.message || "Não foi possível confirmar sua chegada.");
    await loadState().catch(() => {});
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Estou a caminho";
    }
  }
}

async function finishCurrentService() {
  const serviceSector = getServiceInProgressSector();
  if (!serviceSector) {
    navigate(hasActiveQueues() ? "status" : "rating");
    return;
  }

  const ticket = activeQueues[serviceSector];
  try {
    await api(`/api/tickets/${encodeURIComponent(ticket.id)}/finish`, { method: "POST", body: identity });
    await loadState();
    const called = getCurrentQueueData();
    if (called?.status === "chamado") {
      navigate("status");
      return;
    }
    navigate(hasActiveQueues() ? "status" : "rating");
  } catch (exception) {
    const message = exception?.message || "Não foi possível finalizar o atendimento.";
    const target = document.querySelector("#serviceMessage");
    if (target) target.textContent = message;
    else alert(message);
  }
}

function renderServiceScreen() {
  const serviceSector = getServiceInProgressSector();
  if (serviceSector) currentSector = serviceSector;

  const current = serviceSector ? activeQueues[serviceSector] : null;
  const smartWaitSector = getNextSmartWaitSector();
  const smartWait = smartWaitSector ? activeQueues[smartWaitSector] : null;
  const waitingCount = Object.values(activeQueues).filter((item) => item.status === SMART_WAIT_STATUS).length;

  if (!current) {
    document.querySelector("#serviceTitle").textContent = "Atendimento finalizado";
    document.querySelector("#serviceMessage").textContent = "Não há pedido em atendimento neste momento.";
    document.querySelector("#serviceCurrent").textContent = "Atendimento atual: --";
    document.querySelector("#serviceNext").textContent = hasActiveQueues() ? "Você ainda possui senhas ativas." : "Nenhuma senha ativa.";
    document.querySelector("#completeServiceButton").textContent = hasActiveQueues() ? "Voltar para minhas senhas" : "Ir para avaliação";
    return;
  }

  document.querySelector("#serviceTitle").textContent = "Pedido em atendimento";
  document.querySelector("#serviceMessage").textContent =
    "Quando o pedido terminar, informe no app para liberar a próxima senha protegida.";
  document.querySelector("#serviceCurrent").textContent = `Atendimento atual: ${displayCustomerName(current)} - ${supportCode(current)} - ${current.sector}`;
  document.querySelector("#serviceNext").textContent = smartWait
    ? `Próxima protegida: ${displayCustomerName(smartWait)} - ${supportCode(smartWait)} - ${smartWait.sector}.`
    : waitingCount > 1
      ? `${waitingCount} senhas estão protegidas para chamada em sequência.`
      : "Nenhuma senha protegida no momento.";
  document.querySelector("#completeServiceButton").textContent = smartWait
    ? "Informar fim e chamar próxima senha"
    : "Informar fim do pedido";
}

function statusText(data) {
  if (data.status === "chamado") return "Senha chamada";
  if (data.status === "em_atendimento") return "Em atendimento";
  if (data.status === SMART_WAIT_STATUS) return "Espera inteligente";
  if (data.status === "standby") return `Standby: ${formatStandbyTime(data)}`;
  if (data.status === "proximo") return "Próxima senha";
  if (hasLiveCountdown(data)) return `Chamada em ${formatTimer(data.secondsToCall)}`;
  if (data.position === 1) return "Aguardando chamada";
  return `Previsão: ${formatTimer(data.secondsToCall)}`;
}

function bannerText(data, activeCount) {
  const prefix = activeCount > 1 ? `${activeCount} senhas ativas` : data.sector;
  return `${prefix} - ${statusText(data)}`;
}

function formatStandbyTime(data) {
  const fromServer = Number(data?.standbySecondsRemaining);
  const fromDate = data?.standbyExpiresAt
    ? Math.ceil((new Date(data.standbyExpiresAt).getTime() - Date.now()) / 1000)
    : 0;
  return formatTimer(Math.max(0, Number.isFinite(fromServer) ? fromServer : fromDate));
}

function updateQueueAlert(data) {
  const alertBox = document.querySelector("#queueAlert");
  if (!alertBox) return;

  const alert = queueAlertFor(data);
  visibleQueueAlert = alert;
  alertBox.hidden = !alert;
  alertBox.classList.toggle("urgent", alert?.ahead === 1);
  document.querySelector("#queueAlertTitle").textContent = alert ? alert.title : "Atenção";
  document.querySelector("#queueAlertText").textContent = alert ? alert.message : "";
  if (alert) triggerQueueAlert(alert, data);
}

function updateCallNotification(data) {
  const notification = document.querySelector("#callNotification");
  if (!notification) return;

  const calledTicket = data?.status === "chamado"
    ? data
    : Object.values(activeQueues).find((ticket) => ticket.status === "chamado");
  const isCalled = Boolean(calledTicket);
  notification.hidden = !isCalled;
  if (!isCalled) return;

  document.querySelector("#callNotificationTitle").textContent = "É a sua vez!";
  document.querySelector("#callNotificationText").textContent =
    `Dirija-se ao ${calledTicket.counterLabel} de ${calledTicket.sector}. ${supportCode(calledTicket)}.`;
}

function announceCalledTicket(data) {
  updateCallNotification(data);
  if (alertPreferences.sound) playQueueAlertSound();
  if (alertPreferences.vibration) vibrateQueueAlert(1);
}

function queueAlertFor(data) {
  if (!data || !["aguardando", "proximo"].includes(data.status)) return null;
  if (![1, 2].includes(Number(data.ahead))) return null;
  const title = Number(data.ahead) === 1 ? "Atenção: você é o próximo" : "Atenção: sua vez está chegando";
  return {
    ahead: Number(data.ahead),
    title,
    message: `${displayCustomerName(data)} será chamado em breve. Fique próximo ao setor ${data.sector}. ${supportCode(data)}.`
  };
}

function triggerQueueAlert(alert, data) {
  const key = `${data.id}:${alert.ahead}`;
  if (queueAlertHistory.has(key)) return;
  queueAlertHistory.add(key);
  if (alertPreferences.sound) playQueueAlertSound();
  if (alertPreferences.vibration) vibrateQueueAlert(alert.ahead);
}

function pruneQueueAlertHistory(tickets) {
  const activeIds = new Set(tickets.map((ticket) => ticket.id));
  queueAlertHistory = new Set([...queueAlertHistory].filter((key) => activeIds.has(key.split(":")[0])));
}

function loadAlertPreferences() {
  const stored = safeJsonParse(readAppStorage("senhaHubAlertPreferences"), {});
  return {
    sound: stored.sound !== false,
    vibration: stored.vibration !== false
  };
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function saveAlertPreferences() {
  writeAppStorage("senhaHubAlertPreferences", JSON.stringify(alertPreferences));
}

function syncAlertControls() {
  const sound = document.querySelector("#soundAlertToggle");
  const vibration = document.querySelector("#vibrationAlertToggle");
  if (!sound || !vibration) return;
  sound.checked = alertPreferences.sound;
  vibration.checked = alertPreferences.vibration;
}

function updateAlertPreference(type, enabled) {
  alertPreferences = { ...alertPreferences, [type]: enabled };
  saveAlertPreferences();
  syncAlertControls();
  if (enabled && type === "sound") playQueueAlertSound({ quiet: true });
  if (enabled && type === "vibration") vibrateQueueAlert(2);
}

function playQueueAlertSound(options = {}) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = options.quiet ? 660 : 880;
    gain.gain.value = options.quiet ? 0.025 : 0.07;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (options.quiet ? 0.08 : 0.18));
    oscillator.addEventListener("ended", () => context.close());
  } catch {
    // Browsers can block audio until the user interacts with the page.
  }
}

function vibrateQueueAlert(ahead) {
  if (!("vibrate" in navigator)) return;
  navigator.vibrate(ahead === 1 ? [180, 90, 180] : [140, 70, 140]);
}

function floatingTimeText(data) {
  if (data.status === "chamado") return "chamada";
  if (data.status === "em_atendimento") return "atendimento";
  if (data.status === SMART_WAIT_STATUS) return "protegida";
  if (data.status === "standby") return "standby";
  if (hasLiveCountdown(data)) return formatTimer(data.secondsToCall);
  if (data.position === 1) return "próxima";
  return formatTimer(data.secondsToCall);
}

function ticketSubText(data) {
  const priority = priorityText(data);
  if (priority && ["aguardando", "proximo"].includes(data.status)) return `${priority}. ${data.position} na fila preferencial.`;
  if (data.status === "em_atendimento") return `Pedido em atendimento no ${data.counterLabel}.`;
  if (data.status === SMART_WAIT_STATUS) return "Protegida até o pedido atual terminar.";
  if (data.status === "standby") return `${displayCustomerName(data)} foi chamado, mas não compareceu. A chamada ficará em standby por 10 minutos. Aguarde nova chamada.`;
  if (data.status === "chamado") return `Apresente-se no ${data.counterLabel}. ${supportCode(data)}.`;
  if (data.status === "proximo") return "Você será chamado em instantes.";
  if (hasLiveCountdown(data)) return `${displayCustomerName(data)} será chamado em ${formatTimer(data.secondsToCall)}.`;
  if (data.position === 1) return "Você é o próximo da fila.";
  return `${data.ahead} pessoas à frente`;
}

function queueItemLine(data) {
  const priority = priorityText(data);
  if (data.status === SMART_WAIT_STATUS) return "Protegida até o pedido atual terminar";
  if (data.status === "standby") return `Standby - ${formatStandbyTime(data)} restantes`;
  if (data.status === "em_atendimento") return "Atendimento em andamento";
  if (data.status === "chamado") return `${data.counterLabel} - chamado - ${supportCode(data)}`;
  if (data.status === "proximo") return "Próxima chamada";
  if (hasLiveCountdown(data)) return `${priority ? `${priority} - ` : ""}Chamada em ${formatTimer(data.secondsToCall)}`;
  if (data.position === 1) return "Próxima da fila";
  return `${data.ahead} pessoas à frente`;
}

function priorityText(data) {
  return data?.priority ? `Preferencial${data.priorityReason && PRIORITY_LABELS[data.priorityReason] ? ` - ${PRIORITY_LABELS[data.priorityReason]}` : ""}` : "";
}

function displayCustomerName(data) {
  return String(data?.customerName || currentUser?.name || "Cliente").trim() || "Cliente";
}

function supportCode(data) {
  return `Código de apoio: Senha ${supportNumber(data)}`;
}

function currentCallText(data) {
  if (!data?.current || data.current === "--") return "--";
  return data.currentCustomerName
    ? `${data.currentCustomerName} · Senha ${supportNumber({ ticket: data.current, ticketNumber: data.currentNumber })}`
    : `Senha ${data.current}`;
}

function supportNumber(data) {
  if (Number.isFinite(Number(data?.ticketNumber))) return String(Number(data.ticketNumber)).padStart(3, "0");
  const match = String(data?.ticket || "").match(/(\d{3})$/);
  return match ? match[1] : data?.ticket || "--";
}

function priorityIcon() {
  return `
    <svg class="priority-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="4.5" r="2.2"></circle>
      <path d="M12 8v6"></path>
      <path d="M8.5 10.5h7"></path>
      <path d="M9.5 21l2.5-7 2.5 7"></path>
    </svg>
  `;
}

function priorityBadgeMarkup(extraClass = "") {
  return `<em class="priority-badge ${extraClass}">${priorityIcon()}<span>PREFERENCIAL</span></em>`;
}

function renderPriorityBadge(element, data) {
  if (!element) return;
  element.hidden = !data?.priority;
  element.innerHTML = data?.priority ? `${priorityIcon()}<span>PREFERENCIAL</span>` : "";
}

function updateFloatingQueue() {
  const hiddenScreens = ["ticket", "status", "done", "rating"];
  const serviceSector = getServiceInProgressSector();
  document.querySelector("#floatingQueue").classList.toggle("visible", hasActiveQueues() && !hiddenScreens.includes(activeScreen));
  document.querySelector("#floatingFinishButton").classList.toggle("visible", Boolean(serviceSector) && !["status", "done", "rating"].includes(activeScreen));
  if (serviceSector) document.querySelector("#floatingFinishButton").textContent = `Informar fim do pedido em ${activeQueues[serviceSector].sector}`;
}

function renderActiveTickets() {
  const list = document.querySelector("#activeTicketList");
  const entries = Object.entries(activeQueues);
  list.innerHTML = entries.length
    ? entries.map(([sectorId, data]) => `
        <button class="mini-ticket ${sectorId === currentSector ? "active" : ""} ${data.priority ? "priority-ticket" : ""}" data-view-ticket="${escapeHtml(sectorId)}">
          <div>
            <strong>${escapeHtml(data.sector)}</strong>
            ${data.priority ? priorityBadgeMarkup() : ""}
            <span>${escapeHtml(`${displayCustomerName(data)} - ${queueItemLine(data)}`)}</span>
          </div>
          <b>${escapeHtml(supportCode(data).replace("Código de apoio: ", ""))}</b>
        </button>
      `).join("")
    : `<div class="empty-state">Você ainda não possui senhas ativas.</div>`;

  document.querySelectorAll("[data-view-ticket]").forEach((button) => {
    button.addEventListener("click", () => {
      currentSector = button.dataset.viewTicket;
      syncQueue();
      navigate("ticket");
    });
  });
}

function renderSectorCards() {
  selectedSectorIds = new Set([...selectedSectorIds].map(resolveSectorId).filter((sectorId) => (
    sectors[sectorId]?.status === "open" && !activeQueues[sectorId]
  )));

  document.querySelectorAll("[data-join]").forEach((button) => {
    const requestedSectorId = button.dataset.join;
    const sectorId = resolveSectorId(requestedSectorId);
    const sector = sectors[sectorId];
    if (!sector) return;

    const card = button.closest(".sector-card");
    if (!card) return;
    const hasTicket = Boolean(activeQueues[sectorId]);
    card.classList.toggle("has-ticket", hasTicket);
    card.querySelector(".sector-head strong").textContent = sector.name;
    card.querySelector(".sector-head b").textContent = sector.counterLabel;
    button.disabled = sector.status !== "open" || ticketRequestInFlight;
    button.textContent = hasTicket ? "Ver minha senha" : "Solicitar senha";
    if (activeJoinSector === sectorId || activeJoinSector === requestedSectorId) button.textContent = "Gerando senha...";

    const selectionControl = card.querySelector("[data-select-sector]");
    if (selectionControl) {
      const selected = selectedSectorIds.has(sectorId);
      selectionControl.checked = selected;
      selectionControl.disabled = sector.status !== "open" || hasTicket || ticketRequestInFlight;
      card.classList.toggle("selected", selected);
      selectionControl.closest(".sector-select-control")?.classList.toggle("selected", selected);
    }
  });

  document.querySelectorAll("[data-quick-join]").forEach((button) => {
    const sectorId = resolveSectorId(button.dataset.quickJoin);
    const sector = sectors[sectorId];
    if (!sector) return;
    const hasTicket = Boolean(activeQueues[sectorId]);
    button.disabled = sector.status !== "open" || ticketRequestInFlight;
    button.classList.toggle("has-ticket", hasTicket);
    button.textContent = activeJoinSector === sectorId ? "..." : hasTicket ? displayCustomerName(activeQueues[sectorId]) : sector.name;
  });

  const selectionButton = document.querySelector("#requestSelectedTickets");
  const selectionHint = document.querySelector("#selectedSectorHint");
  if (selectionButton) {
    selectionButton.disabled = ticketRequestInFlight || selectedSectorIds.size === 0;
    selectionButton.textContent = ticketRequestInFlight && activeJoinSector === "__multi__"
      ? "Gerando senhas..."
      : selectedSectorIds.size > 0
        ? `Solicitar ${selectedSectorIds.size} ${selectedSectorIds.size === 1 ? "senha" : "senhas"}`
        : "Solicitar senhas selecionadas";
  }
  if (selectionHint) {
    selectionHint.textContent = selectedSectorIds.size
      ? `${selectedSectorIds.size} ${selectedSectorIds.size === 1 ? "setor selecionado" : "setores selecionados"}`
      : "Opcional";
  }
}

function syncActionButtons() {
  renderSectorCards();
}

function handleNotifyButton() {
  navigate("account");
  setTimeout(() => window.senhaHubPwa?.openNotificationSettings(), 0);
}

async function sendRating() {
  const selected = document.querySelector("[data-rating].selected");
  const toast = document.querySelector("#ratingToast");
  const button = document.querySelector("#sendRating");
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.textContent = "Enviando…";
  }
  try {
    await api("/api/ratings", {
      method: "POST",
      body: {
        customerId: identity.customerId,
        ticketId: getCurrentQueueData()?.id || null,
        score: selected?.dataset.rating || "sem_nota",
        comment: document.querySelector("#ratingComment").value
      }
    });
    if (toast) {
      toast.textContent = "Avaliação enviada. Obrigado!";
      toast.classList.add("visible");
    }
  } catch (exception) {
    if (toast) {
      toast.textContent = exception?.message || "Não foi possível enviar a avaliação.";
      toast.classList.add("visible", "error");
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Enviar avaliação";
    }
  }
}

async function logoutAccount() {
  try {
    await window.senhaHubPwa?.prepareLogout();
    await api("/api/auth/logout", { method: "POST" });
  } catch (exception) {
    console.warn(exception);
  } finally {
    stateSource?.close();
    removeAppStorage("senhaHubIdentity");
    location.href = "/login";
  }
}

function bindEvents() {
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.go)));
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.tab)));
  document.querySelector("#homeQueueAction")?.addEventListener("click", () => navigate("sectors"));
  document.querySelectorAll("[data-join]").forEach((button) => button.addEventListener("click", () => joinQueue(button.dataset.join)));
  document.querySelectorAll("[data-quick-join]").forEach((button) => button.addEventListener("click", () => joinQueue(button.dataset.quickJoin)));
  document.querySelectorAll("[data-select-sector]").forEach((input) => input.addEventListener("change", handleSectorSelection));
  document.querySelector("#requestSelectedTickets")?.addEventListener("click", requestSelectedTickets);
  document.querySelector("#backButton").addEventListener("click", () => navigate("home"));
  document.querySelector("#notifyButton").addEventListener("click", handleNotifyButton);
  document.querySelector("#floatingQueue").addEventListener("click", () => navigate("status"));
  document.querySelector("#confirmCall").addEventListener("click", confirmCall);
  document.querySelector("#ticketCancelButton").addEventListener("click", () => cancelCurrentTicket());
  document.querySelector("#statusCancelButton").addEventListener("click", () => cancelCurrentTicket());
  document.querySelector("#completeServiceButton").addEventListener("click", finishCurrentService);
  document.querySelector("#statusFinishButton").addEventListener("click", finishCurrentService);
  document.querySelector("#floatingFinishButton").addEventListener("click", finishCurrentService);
  document.querySelector("#queueHelpButton")?.addEventListener("click", () => openQueueTutorial());
  document.querySelector("#ticketHelpButton")?.addEventListener("click", () => openQueueTutorial());
  document.querySelector("#statusHelpButton")?.addEventListener("click", () => openQueueTutorial());
  document.querySelector("#tutorialClose")?.addEventListener("click", closeQueueTutorial);
  document.querySelector("#tutorialDone")?.addEventListener("click", closeQueueTutorial);
  document.querySelector("#queueTutorial")?.addEventListener("click", (event) => {
    if (event.target.id === "queueTutorial") closeQueueTutorial();
  });
  document.querySelector("#priorityToggle")?.addEventListener("change", syncPriorityControls);
  document.querySelector("#priorityReason")?.addEventListener("change", syncPriorityControls);
  document.querySelector("#soundAlertToggle")?.addEventListener("change", (event) => updateAlertPreference("sound", event.target.checked));
  document.querySelector("#vibrationAlertToggle")?.addEventListener("change", (event) => updateAlertPreference("vibration", event.target.checked));
  document.querySelectorAll("[data-rating]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-rating]").forEach((item) => {
        item.classList.remove("selected");
        item.setAttribute("aria-pressed", "false");
      });
      button.classList.add("selected");
      button.setAttribute("aria-pressed", "true");
    });
  });
  document.querySelector("#sendRating").addEventListener("click", sendRating);
  document.querySelector("#logoutButton")?.addEventListener("click", logoutAccount);
  window.addEventListener("senhahub:push", handlePushRefresh);
  window.addEventListener("senhahub:notification-click", handlePushRefresh);
  window.addEventListener("senhahub:reconnected", () => loadState().catch(() => {}));
}

function handleSectorSelection(event) {
  const sectorId = resolveSectorId(event.target.dataset.selectSector);
  if (!sectorId || !sectors[sectorId] || activeQueues[sectorId]) return;
  if (event.target.checked) selectedSectorIds.add(sectorId);
  else selectedSectorIds.delete(sectorId);
  renderSectorCards();
}

function syncPriorityControls() {
  const toggle = document.querySelector("#priorityToggle");
  const reason = document.querySelector("#priorityReason");
  if (!toggle || !reason) return;
  reason.disabled = !toggle.checked;
  reason.hidden = !toggle.checked;
  if (!toggle.checked) reason.value = "";
}

function formatTimer(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const seconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

async function api(path, options = {}) {
  const method = options.method || "GET";
  const mutation = method !== "GET";
  if (mutation) window.senhaHubPwa?.markCriticalOperation(true);
  try {
    const response = await fetch(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...csrfHeader()
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = await parseApiPayload(response);
    window.senhaHubPwa?.reportNetworkSuccess();
    if (response.status === 401) {
      location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
      throw new Error("Login necessÃ¡rio.");
    }
    if (!response.ok || payload.error) throw new Error(payload.error || "Falha na API.");
    return payload;
  } catch (error) {
    window.senhaHubPwa?.reportNetworkFailure();
    throw error;
  } finally {
    if (mutation) window.senhaHubPwa?.markCriticalOperation(false);
  }
}

async function parseApiPayload(response) {
  const text = await response.text();
  if (!text.trim()) return response.ok ? { ok: true } : { error: "Falha na API." };
  try {
    return JSON.parse(text);
  } catch {
    return response.ok ? { ok: true, message: text } : { error: apiTextError(response, text) };
  }
}

function apiTextError(response, text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean && clean.length < 180 && !clean.startsWith("<")) return clean;
  return `Falha na comunicacao com a API (${response.status || "sem status"}). Tente novamente.`;
}

function csrfHeader() {
  const token = getCookie("senhahub_csrf");
  return token ? { "x-csrf-token": token } : {};
}

function getCookie(name) {
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function requireSession(roles) {
  const { user } = await api("/api/auth/me");
  if (!user || !roles.includes(user.role)) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    throw new Error("Acesso negado.");
  }
  return user;
}

window.ticketOrchestration = {
  callNextEligibleTicket: (sectorId) => api(`/api/sectors/${sectorId}/call-next`, { method: "POST" }),
  finishService: (ticketId) => api(`/api/tickets/${ticketId}/finish`, { method: "POST" }),
  getState: loadState
};
