let adminState = { sectors: [] };
let adminUsers = [];
let adminUsersLoaded = false;
let adminUsersLoading = false;
let selectedUserSectorId = null;
let adminMetrics = { sectors: [], satisfaction: { count: 0, average: 0 } };
let currentUser = null;
let adminRefreshTimer = null;
let adminRefreshInFlight = null;
const ADMIN_REFRESH_INTERVAL_MS = 30000;
const MANAGER_SECTOR_TONE_COUNT = 5;
const managerSectorToneAssignments = new Map();

initAdmin();

async function initAdmin() {
  currentUser = await requireSession(["manager", "admin"]);
  document.querySelector("#logoutButton")?.addEventListener("click", logout);
  document.querySelector("#resetTicketHistoryButton")?.addEventListener("click", resetTicketHistory);
  document.querySelectorAll(".manager-nav a").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".manager-nav a").forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
    });
  });
  document.querySelector("#userForm")?.addEventListener("submit", createUser);
  document.querySelector("#userRole")?.addEventListener("change", updateUserRoleFields);
  document.querySelector("#toggleAdminUsers")?.addEventListener("click", toggleUserDirectory);
  document.querySelector("#adminUserSectorList")?.addEventListener("click", selectUserSector);
  updateUserRoleFields();
  document.querySelector("#refreshPrintReview")?.addEventListener("click", loadPrintReview);
  if(document.querySelector("#printReviewList")) await loadPrintReview();
  document.querySelector("#sectorFilter")?.addEventListener("change", renderQueueTable);
  document.querySelector("#statusFilter")?.addEventListener("change", renderQueueTable);
  document.querySelector("#refreshDashboardButton")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Atualizando…";
    try {
      await refreshDashboard();
    } catch (error) {
      const alerts = document.querySelector("#dashboardAlerts");
      if (alerts) alerts.innerHTML = `<div class="manager-alert manager-alert-attention"><span class="manager-alert-mark">!</span><div><strong>Não foi possível atualizar o painel</strong><p>${escapeHtml(error.message || "Erro de comunicação")}</p></div></div>`;
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = "Atualizar agora";
    }
  });
  const metricsDateInput = document.querySelector("#metricsDate");
  if (metricsDateInput) {
    metricsDateInput.value = businessToday();
    metricsDateInput.addEventListener("change", () => loadMetrics().catch(() => {}));
  }
  try {
    const requests = [];
    if (needsAdminState() || document.querySelector("#adminUsers")) requests.push(loadAdminState());
    if (needsAdminMetrics()) requests.push(loadMetrics());
    await Promise.all(requests);
  } catch (error) {
    const alerts = document.querySelector("#dashboardAlerts");
    if (alerts) {
      alerts.innerHTML = `<div class="manager-alert manager-alert-attention"><span class="manager-alert-mark">!</span><div><strong>Não foi possível carregar todos os dados</strong><p>Tente atualizar o painel novamente. ${escapeHtml(error.message || "Erro de comunicação")}</p></div></div>`;
    }
    const sectors = document.querySelector("#adminSectors");
    if (sectors && !adminState.sectors.length) {
      sectors.innerHTML = `<div class="manager-empty" role="status"><strong>Não foi possível carregar os setores</strong><p>Atualize a página para tentar novamente.</p></div>`;
    }
    const queue = document.querySelector("#queueTable");
    if (queue && !adminState.sectors.length) {
      queue.innerHTML = `<tr><td colspan="6" class="manager-empty-cell">Não foi possível carregar a fila. Atualize a página para tentar novamente.</td></tr>`;
    }
  }
  startAdminPolling();
}

async function refreshDashboard() {
  if (adminRefreshInFlight) return adminRefreshInFlight;
  const requests = [];
  if (needsAdminState()) requests.push(loadAdminState());
  if (needsAdminMetrics()) requests.push(loadMetrics());
  adminRefreshInFlight = Promise.all(requests).finally(() => {
    adminRefreshInFlight = null;
  });
  return adminRefreshInFlight;
}

function startAdminPolling() {
  if (adminRefreshTimer || !needsAdminState()) return;
  adminRefreshTimer = window.setInterval(() => {
    if (document.hidden) return;
    refreshDashboard().catch((error) => {
      const alerts = document.querySelector("#dashboardAlerts");
      if (alerts) {
        alerts.innerHTML = `<div class="manager-alert manager-alert-attention"><span class="manager-alert-mark">!</span><div><strong>Não foi possível atualizar o painel</strong><p>${escapeHtml(error.message || "Erro de comunicação")}</p></div></div>`;
      }
    });
  }, ADMIN_REFRESH_INTERVAL_MS);
}

function needsAdminState() {
  return Boolean(document.querySelector("#dashboardKpis, #queueTable, #adminSectors"));
}

function needsAdminMetrics() {
  return Boolean(document.querySelector("#dashboardKpis, #dashboardOperations, #adminSectors"));
}

async function loadAdminState() {
  adminState = await api("/api/staff/state");
  renderUserSectorPermissions();
  renderAdmin();
  renderDashboard();
  if (adminUsersLoaded) renderUsers();
}

async function loadUsers() {
  if (!document.querySelector("#adminUsers")) return;
  if (!["manager", "admin"].includes(currentUser.role)) {
    document.querySelector("#usuarios")?.closest(".manager-section-title")?.setAttribute("hidden", "");
    return;
  }
  const status = document.querySelector("#adminUserDirectoryStatus");
  const directory = document.querySelector("#adminUsersBrowser");
  const count = document.querySelector("[data-users-count]");
  directory?.setAttribute("aria-busy", "true");
  if (status) {
    status.dataset.state = "loading";
    status.textContent = "Carregando contas e permissões…";
  }
  if (count) count.textContent = "Carregando contas…";
  try {
    const result = await api("/api/users");
    adminUsers = result.users;
    adminUsersLoaded = true;
    renderUsers();
  } catch (error) {
    if (status) {
      status.dataset.state = "error";
      status.textContent = `Não foi possível carregar as contas. Tente novamente mais tarde. ${error.message || ""}`;
    }
    if (count) count.textContent = "Falha ao carregar";
    throw error;
  } finally {
    directory?.removeAttribute("aria-busy");
  }
}

function toggleUserDirectory(event) {
  const button = event.currentTarget;
  const directory = document.querySelector("#adminUsersBrowser");
  if (!button || !directory) return;
  const expanded = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(expanded));
  directory.hidden = !expanded;
  const label = button.querySelector("[data-users-toggle-label]");
  if (label) label.textContent = expanded ? (adminUsersLoaded ? "Ocultar contas" : "Carregando contas…") : "Consultar contas por setor";
  if (!expanded || adminUsersLoaded || adminUsersLoading) return;
  adminUsersLoading = true;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  loadUsers().catch(() => {
    if (label) label.textContent = button.getAttribute("aria-expanded") === "true" ? "Ocultar contas" : "Consultar contas por setor";
  }).finally(() => {
    adminUsersLoading = false;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  });
}

function selectUserSector(event) {
  const button = event.target.closest("button[data-user-sector]");
  if (!button) return;
  selectedUserSectorId = button.dataset.userSector;
  renderUsers();
  [...document.querySelectorAll("#adminUserSectorList button")]
    .find((item) => item.dataset.userSector === selectedUserSectorId)
    ?.focus();
}

async function loadMetrics() {
  const selectedDate = document.querySelector("#metricsDate")?.value || businessToday();
  adminMetrics = await api(`/api/metrics?date=${encodeURIComponent(selectedDate)}`);
  renderAdmin();
  renderDashboard();
}

async function resetTicketHistory(event) {
  const button = event.currentTarget;
  if (button.disabled) return;
  const confirmed = window.confirm(
    "Isso apagará permanentemente as senhas encerradas, canceladas ou expiradas e as avaliações vinculadas. Senhas com tentativas de impressão esgotadas também serão apagadas; os registros dessas tentativas continuarão guardados para auditoria. Senhas em atendimento, impressões pendentes ou em revisão e a numeração atual serão mantidas. Deseja continuar?"
  );
  if (!confirmed) return;

  const status = document.querySelector("#resetTicketHistoryStatus");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Limpando…";
  if (status) status.hidden = true;

  try {
    const result = await api("/api/tickets/history/reset", { method: "POST" });
    const ticketCount = Number(result.deletedTickets || 0);
    const ratingCount = Number(result.deletedRatings || 0);
    const skippedTicketCount = Number(result.skippedTickets || 0);
    if (status) {
      if (ticketCount || skippedTicketCount) {
        status.textContent = ticketCount
          ? `Histórico limpo: ${ticketCount} senha(s) e ${ratingCount} avaliação(ões) removidas.`
          : "Nenhuma senha foi removida.";
        if (skippedTicketCount) {
          status.textContent += ` ${skippedTicketCount} senha(s) foram preservadas por terem impressão pendente ou em revisão.`;
        }
      } else {
        status.textContent = "O histórico já estava vazio. As métricas continuam prontas para os atendimentos reais.";
      }
      status.hidden = false;
    }
    try {
      const requests = [];
      if (needsAdminState()) requests.push(loadAdminState());
      if (needsAdminMetrics()) requests.push(loadMetrics());
      await Promise.all(requests);
    } catch {
      if (status) status.textContent += " Atualize o painel para recarregar os indicadores.";
    }
  } catch (error) {
    if (status) {
      status.textContent = error.message || "Não foi possível limpar o histórico de senhas.";
      status.hidden = false;
    }
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = "Limpar histórico";
  }
}

function renderAdmin() {
  renderSectorFilter();
  renderQueueTable();
  const sectorGrid = document.querySelector("#adminSectors");
  if (!sectorGrid) return;
  sectorGrid.innerHTML = adminState.sectors.length ? adminState.sectors.map((sector) => {
    const snapshot = sectorSnapshot(sector);
    const metric = snapshot.metric;
    const settings = timeParts(sector.averageServiceSeconds);
    const averageClass = Number(metric.serviceSamples || 0) > 0 ? "" : " manager-no-data-value";
    return `
      <article class="manager-sector-card" data-sector-tone="${sectorToneIndex(sector)}">
        <div class="manager-sector-head">
          <div>
            <strong>${escapeHtml(sector.name)}</strong>
            <span>${escapeHtml(sector.counterLabel || sector.id)}</span>
          </div>
          <b class="manager-badge ${sector.status === "open" ? "success" : sector.status === "paused" ? "warn" : "danger"}">${escapeHtml(statusLabel(sector.status))}</b>
        </div>
        <div class="manager-sector-metrics">
          <div><span>Aguardando</span><strong>${escapeHtml(snapshot.waiting.length)}</strong></div>
          <div><span>Senha atual</span><strong>${escapeHtml(snapshot.currentTicket ? supportCode(snapshot.currentTicket).replace("Senha ", "") : "--")}</strong></div>
          <div><span>Tempo médio</span><strong class="${averageClass.trim()}"${Number(metric.serviceSamples || 0) > 0 ? "" : ' title="Sem atendimentos concluídos na data consultada"'}>${escapeHtml(serviceAverageLabel(metric))}</strong></div>
        </div>
        <div class="manager-progress" aria-label="${escapeHtml(snapshot.load)}% da capacidade ocupada"><span style="width:${escapeHtml(snapshot.load)}%"></span></div>
        <div class="manager-sector-load"><span>${escapeHtml(snapshot.load)}% da capacidade definida</span><b>${escapeHtml(snapshot.waiting.length)} aguardando</b></div>
        <p class="manager-sector-current">${escapeHtml(snapshot.currentTicket ? `${displayCustomerName(snapshot.currentTicket)} · ${ticketStatus(snapshot.currentTicket)}` : "Nenhum atendimento ativo")}</p>
        <details class="manager-sector-settings">
          <summary>Ajustar setor</summary>
          <form class="manager-form" data-sector-form="${escapeHtml(sector.id)}" data-online-required>
            <label>Nome exibido<input name="name" value="${escapeHtml(sector.name)}" /></label>
            <label>Balcão de atendimento<input name="counterLabel" value="${escapeHtml(sector.counterLabel)}" /></label>
            <label>Descrição do atendimento<input name="serviceLabel" value="${escapeHtml(sector.serviceLabel)}" /></label>
            <div class="manager-form-row">
              <label>Tamanho inicial da fila<input type="number" name="queueSize" min="1" value="${escapeHtml(sector.queueSize)}" /></label>
              <label>Estimativa (min)<input type="number" name="averageServiceMinutes" min="0" value="${escapeHtml(settings.minutes)}" /></label>
              <label>Estimativa (seg)<input type="number" name="averageServiceRestSeconds" min="0" max="59" value="${escapeHtml(settings.seconds)}" /></label>
              <label>Capacidade de atendimento<input type="number" name="capacity" min="1" value="${escapeHtml(sector.capacity)}" /></label>
            </div>
            <label>Status
              <select name="status">
                <option value="open" ${sector.status === "open" ? "selected" : ""}>Aberto</option>
                <option value="paused" ${sector.status === "paused" ? "selected" : ""}>Pausado</option>
                <option value="closed" ${sector.status === "closed" ? "selected" : ""}>Fechado</option>
              </select>
            </label>
            <button class="manager-button" type="submit">Salvar alterações</button>
            <p class="manager-form-feedback" data-sector-feedback role="status" aria-live="polite"></p>
          </form>
        </details>
      </article>
    `;
  }).join("") : `<div class="manager-empty" role="status"><strong>Nenhum setor disponível</strong><p>Os setores cadastrados serão exibidos aqui para acompanhamento e configuração.</p></div>`;

  document.querySelectorAll("[data-sector-form]").forEach((form) => {
    form.addEventListener("submit", saveSector);
  });
}

function renderSectorFilter() {
  const filter = document.querySelector("#sectorFilter");
  if (!filter) return;
  const current = filter.value;
  filter.innerHTML = [
    `<option value="">Todos os setores</option>`,
    ...adminState.sectors.map((sector) => `<option value="${escapeHtml(sector.id)}">${escapeHtml(sector.name)}</option>`)
  ].join("");
  filter.value = current;
}

function renderQueueTable() {
  const table = document.querySelector("#queueTable");
  if (!table) return;
  const sectorFilter = document.querySelector("#sectorFilter")?.value || "";
  const statusFilter = document.querySelector("#statusFilter")?.value || "";
  const rows = adminState.sectors
    .flatMap((sector) => (sector.tickets || []).map((ticket) => ({
      ...ticket,
      sectorId: sector.id,
      sectorName: sector.name,
      sectorTone: sectorToneIndex(sector)
    })))
    .filter((ticket) => !sectorFilter || ticket.sectorId === sectorFilter)
    .filter((ticket) => !statusFilter || ticket.status === statusFilter);
  const statusOrder = { chamado: 0, em_atendimento: 1, proximo: 2, aguardando: 3, standby: 4, espera_inteligente: 5 };
  rows.sort((left, right) => (statusOrder[left.status] ?? 9) - (statusOrder[right.status] ?? 9)
    || Number(right.priority) - Number(left.priority)
    || Number(left.position || 999) - Number(right.position || 999));
  document.querySelector("#queueCount").textContent = `${rows.length} ${rows.length === 1 ? "registro" : "registros"}`;
  table.innerHTML = rows.length ? rows.map(queueRow).join("") : `
    <tr><td colspan="6" class="manager-empty-cell">Nenhuma senha corresponde aos filtros selecionados.</td></tr>
  `;
}

function queueRow(ticket) {
  return `
    <tr>
      <td><div class="manager-person"><span>${escapeHtml(initials(displayCustomerName(ticket)))}</span><div><strong>${escapeHtml(displayCustomerName(ticket))}</strong><small>${escapeHtml(ticket.priority ? "Atendimento preferencial" : "Cliente")}</small></div></div></td>
      <td><span class="manager-sector-tag" data-sector-tone="${escapeHtml(ticket.sectorTone ?? 0)}">${escapeHtml(ticket.sectorName || ticket.sector)}</span></td>
      <td>${escapeHtml(supportCode(ticket))}</td>
      <td><span class="manager-badge ${ticket.status === "em_atendimento" ? "success" : ticket.status === "standby" ? "warn" : "neutral"}">${escapeHtml(ticketStatus(ticket))}</span></td>
      <td>${ticket.priority ? `<span class="manager-badge danger">Preferencial</span><small class="manager-cell-note">${escapeHtml(priorityReasonLabel(ticket.priorityReason))}</small>` : `<span class="manager-badge neutral">Normal</span>`}</td>
      <td>${escapeHtml(ticket.status === "em_atendimento" ? "Agora" : `${ticket.position || 1}º`)}</td>
    </tr>
  `;
}

function ticketSection(title, tickets) {
  return `
    <section class="ops-ticket-section">
      <h2>${title}</h2>
      ${tickets.length ? tickets.map(ticketRow).join("") : `<p class="ops-empty">Nenhuma senha.</p>`}
    </section>
  `;
}

function ticketRow(ticket) {
  return `
    <div class="ops-ticket-row ${ticket.priority ? "priority-ticket" : ""}">
      <div>
        <strong>${escapeHtml(displayCustomerName(ticket))}</strong>
        ${ticket.priority ? priorityBadgeMarkup() : ""}
        <span>${escapeHtml(ticket.sector)} - ${escapeHtml(ticketStatus(ticket))} - ${escapeHtml(supportCode(ticket))}</span>
      </div>
      <small>${escapeHtml(ticket.status === "em_atendimento" ? "Agora" : `${ticket.position}º`)}</small>
    </div>
  `;
}

function displayCustomerName(ticket) {
  return String(ticket?.customerName || "Cliente").trim() || "Cliente";
}

function supportCode(ticket) {
  if (Number.isFinite(Number(ticket?.ticketNumber))) return `Senha ${String(Number(ticket.ticketNumber)).padStart(3, "0")}`;
  const match = String(ticket?.ticket || "").match(/(\d{3})$/);
  return `Senha ${match ? match[1] : ticket?.ticket || "--"}`;
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

function renderDashboard() {
  const dashboardKpis = document.querySelector("#dashboardKpis");
  const dashboardOperations = document.querySelector("#dashboardOperations");
  if (!dashboardKpis && !dashboardOperations) return;
  const summary = dashboardSummary();
  const health = dashboardHealth(summary);
  const openSectors = adminState.sectors.filter((sector) => sector.status === "open").length;

  setText("#heroOpenSectors", openSectors);
  setText("#heroActiveCalls", summary.called);
  setText("#heroCriticalSector", summary.criticalSector || "nenhuma");
  setText("#heroHeadline", health.headline);
  setText("#heroDescription", health.detail);
  setText("#heroStatus", health.label);
  setText("#heroAverageTime", summary.serviceSamples ? formatMinutesSeconds(summary.avgServiceSeconds) : "Sem dados");
  setText("#heroWaitingCustomers", summary.waiting);
  setText("#heroSyncTime", new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
  const healthDot = document.querySelector("#healthDot");
  healthDot?.classList.toggle("attention", health.status === "attention");
  healthDot?.classList.toggle("neutral", health.status === "neutral");
  const criticalSector = adminState.sectors.find((sector) => sector.name === summary.criticalSector);
  const criticalSectorChip = document.querySelector("#heroCriticalSector")?.closest("span");
  if (criticalSector && criticalSectorChip) {
    criticalSectorChip.dataset.sectorTone = String(sectorToneIndex(criticalSector));
  } else {
    criticalSectorChip?.removeAttribute("data-sector-tone");
  }

  if (dashboardKpis) {
    dashboardKpis.innerHTML = [
      dashboardKpi("Aguardando atendimento", summary.waiting, "senhas na fila", summary.overloaded.length ? "atenção" : "normal"),
      dashboardKpi("Em atendimento", summary.called, "chamadas ativas", summary.called ? "em andamento" : "sem chamadas"),
      dashboardKpi("Senhas emitidas", summary.issued, "total na data selecionada", adminMetrics.date || "hoje"),
      dashboardKpi("Tempo médio", summary.serviceSamples ? formatMinutesSeconds(summary.avgServiceSeconds) : "Sem dados", summary.serviceSamples ? "duração dos atendimentos" : "sem atendimentos concluídos", "no período"),
      dashboardKpi("Avaliação média", satisfactionValue(), `${adminMetrics.satisfaction.count || 0} respostas`, "satisfação")
    ].join("");
  }

  const dashboardAlerts = document.querySelector("#dashboardAlerts");
  if (dashboardAlerts) dashboardAlerts.innerHTML = operationalAlerts(summary);

  if (dashboardOperations) {
    const sectorRows = adminState.sectors.map(sectorSnapshot).sort((left, right) => right.load - left.load || right.waiting.length - left.waiting.length);
    dashboardOperations.innerHTML = sectorRows.length
      ? sectorRows.map((sector) => operationBar(sector)).join("")
      : `<p class="manager-empty">Nenhum setor disponível para exibir.</p>`;
  }
}

function dashboardSummary() {
  const activeTickets = adminState.sectors.flatMap((sector) => sector.tickets || []);
  const waiting = activeTickets.filter((ticket) => ["aguardando", "proximo", "espera_inteligente", "standby"].includes(ticket.status)).length;
  const called = activeTickets.filter((ticket) => ["chamado", "em_atendimento"].includes(ticket.status)).length;
  const issued = adminMetrics.sectors.reduce((sum, sector) => sum + Number(sector.issued || 0), 0);
  const finished = adminMetrics.sectors.reduce((sum, sector) => sum + Number(sector.finished || 0), 0);
  const abandoned = adminMetrics.sectors.reduce((sum, sector) => sum + Number(sector.abandoned || 0), 0);
  const sectorsWithSamples = adminMetrics.sectors.filter((sector) => Number(sector.serviceSamples || 0) > 0);
  const serviceSamples = sectorsWithSamples.reduce((sum, sector) => sum + Number(sector.serviceSamples || 0), 0);
  const avgServiceSeconds = averageNumber(sectorsWithSamples.map((sector) => Number(sector.avgServiceSeconds || 0)));
  const sectors = adminState.sectors.map(sectorSnapshot);
  const overloaded = sectors.filter((sector) => sector.load >= 100 || (sector.status === "open" && sector.waiting.length > 8));
  const critical = [...sectors].sort((left, right) => right.load - left.load || right.waiting.length - left.waiting.length)[0];
  return {
    waiting,
    called,
    issued,
    finished,
    abandoned,
    avgServiceSeconds,
    serviceSamples,
    overloaded,
    criticalSector: critical?.name || ""
  };
}

function dashboardHealth(summary) {
  if (!adminState.sectors.length) {
    return {
      label: "Aguardando configuração",
      status: "neutral",
      headline: "Configure os setores para iniciar o acompanhamento.",
      detail: "Quando os setores estiverem disponíveis, as filas e os indicadores serão exibidos aqui."
    };
  }
  if (summary.overloaded.length) {
    const sectorNames = summary.overloaded.map((sector) => sector.name).join(", ");
    return {
      label: "Atenção operacional",
      status: "attention",
      headline: "Alguns setores precisam de atenção.",
      detail: `${sectorNames} ${summary.overloaded.length > 1 ? "estão com filas acima dos níveis recomendados" : "está com a fila acima do nível recomendado"}.`
    };
  }
  if (summary.called || summary.waiting) {
    return {
      label: "Operação estável",
      status: "good",
      headline: "A operação está em andamento.",
      detail: "As filas estão sob acompanhamento e os atendimentos ativos aparecem na sequência operacional."
    };
  }
  return {
    label: "Aguardando movimento",
    status: "neutral",
      headline: "A operação está tranquila.",
      detail: "Não há senhas ativas neste momento. Os indicadores serão atualizados quando a fila receber movimento."
  };
}

function dashboardKpi(label, value, detail, trend = "") {
  return `
    <article class="manager-kpi">
      <div><span>${escapeHtml(label)}</span><em>${escapeHtml(trend)}</em></div>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function operationBar(sector) {
  const averageLabel = serviceAverageLabel(sector.metric);
  const width = Math.max(4, Math.min(100, Math.round(sector.load)));
  return `
    <article class="manager-bar-row" data-sector-tone="${sectorToneIndex(sector)}">
      <div>
        <strong>${escapeHtml(sector.name)}</strong>
        <span>${escapeHtml(sector.waiting.length)} aguardando · ${escapeHtml(sector.currentTicket ? `atual ${supportCode(sector.currentTicket).replace("Senha ", "")}` : "sem chamada")}</span>
      </div>
      <b>${escapeHtml(averageLabel)}</b>
      <i><em style="width:${escapeHtml(width)}%"></em></i>
    </article>
  `;
}

function serviceAverageLabel(metric) {
  return Number(metric?.serviceSamples || 0) > 0
    ? formatMinutesSeconds(metric.avgServiceSeconds)
    : "Sem dados";
}

function sectorSnapshot(sector) {
  const tickets = Array.isArray(sector?.tickets) ? sector.tickets : [];
  const waiting = tickets.filter((ticket) => ["aguardando", "proximo", "espera_inteligente", "standby"].includes(ticket.status));
  const called = tickets.filter((ticket) => ["chamado", "em_atendimento"].includes(ticket.status));
  const currentTicket = called.find((ticket) => ticket.status === "em_atendimento") || called[0] || null;
  const metric = adminMetrics.sectors.find((item) => item.id === sector.id) || {};
  const capacity = Math.max(1, Number(sector.capacity || 1));
  const load = Math.min(100, Math.round((waiting.length / capacity) * 100));
  return { ...sector, tickets, waiting, called, currentTicket, metric, capacity, load };
}

function sectorToneIndex(sector) {
  const keyFor = (item) => String(item?.id || item?.name || "");
  const key = keyFor(sector);
  if (!key) return 0;

  [...adminState.sectors]
    .sort((left, right) => keyFor(left).localeCompare(keyFor(right)))
    .forEach((item) => {
      const itemKey = keyFor(item);
      if (itemKey && !managerSectorToneAssignments.has(itemKey)) {
        managerSectorToneAssignments.set(itemKey, managerSectorToneAssignments.size % MANAGER_SECTOR_TONE_COUNT);
      }
    });

  if (!managerSectorToneAssignments.has(key)) {
    managerSectorToneAssignments.set(key, managerSectorToneAssignments.size % MANAGER_SECTOR_TONE_COUNT);
  }
  return managerSectorToneAssignments.get(key);
}

function operationalAlerts(summary) {
  const alerts = [];
  summary.overloaded.forEach((sector) => {
    alerts.push({
      tone: "attention",
      sectorTone: sectorToneIndex(sector),
      title: `${sector.name}: fila acima do recomendado`,
      detail: `${sector.waiting.length} senhas aguardando para uma capacidade configurada de ${sector.capacity}.`
    });
  });
  adminState.sectors.filter((sector) => sector.status !== "open").forEach((sector) => {
    alerts.push({
      tone: sector.status === "paused" ? "warning" : "neutral",
      sectorTone: sectorToneIndex(sector),
      title: `${sector.name}: setor ${statusLabel(sector.status).toLowerCase()}`,
      detail: "Confira a configuração do setor antes de liberar novas senhas."
    });
  });
  if (!alerts.length) {
    if (!adminState.sectors.length) {
      return `<div class="manager-alert manager-alert-neutral"><span class="manager-alert-mark" aria-hidden="true">i</span><div><strong>Sem dados para análise</strong><p>Os alertas serão exibidos quando houver setores configurados.</p></div></div>`;
    }
    return `<div class="manager-alert manager-alert-good"><span class="manager-alert-mark" aria-hidden="true">✓</span><div><strong>Tudo em ordem</strong><p>Não há filas acima dos níveis recomendados neste momento.</p></div></div>`;
  }
  return alerts.slice(0, 4).map((alert) => `
    <div class="manager-alert manager-alert-${escapeHtml(alert.tone)}"${Number.isInteger(alert.sectorTone) ? ` data-sector-tone="${escapeHtml(alert.sectorTone)}"` : ""}>
      <span class="manager-alert-mark">!</span>
      <div><strong>${escapeHtml(alert.title)}</strong><p>${escapeHtml(alert.detail)}</p></div>
    </div>
  `).join("");
}

function satisfactionValue() {
  const value = adminMetrics.satisfaction?.average;
  return value && value !== "sem avaliações" ? String(value) : "--";
}

function averageNumber(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function formatMinutesSeconds(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  if (!minutes && !seconds) return "0 min 0 s";
  if (!minutes) return `${seconds} s`;
  return `${minutes} min ${seconds} s`;
}

function timeParts(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  return {
    minutes: Math.floor(safeSeconds / 60),
    seconds: safeSeconds % 60
  };
}

function renderUsers() {
  const results = document.querySelector("#adminUsers");
  if (!results || !adminUsersLoaded) return;
  const toggle = document.querySelector("#toggleAdminUsers");
  const count = document.querySelector("[data-users-count]");
  const status = document.querySelector("#adminUserDirectoryStatus");
  const sectorList = document.querySelector("#adminUserSectorList");
  if (toggle) toggle.disabled = false;
  const toggleLabel = toggle?.querySelector("[data-users-toggle-label]");
  if (toggleLabel) toggleLabel.textContent = toggle.getAttribute("aria-expanded") === "true" ? "Ocultar contas" : "Consultar contas por setor";
  if (count) count.textContent = `${adminUsers.length} ${adminUsers.length === 1 ? "conta" : "contas"}`;

  const normalizedUsers = adminUsers.map((user) => ({
    ...user,
    sectorIds: Array.isArray(user.sectorIds) ? user.sectorIds.map(String) : []
  }));
  const knownSectors = Array.isArray(adminState.sectors) ? adminState.sectors : [];
  const knownSectorIds = new Set(knownSectors.map((sector) => String(sector.id)));
  const assignedSectorIds = [...new Set(normalizedUsers.flatMap((user) => user.sectorIds))];
  const unknownSectorIds = assignedSectorIds.filter((id) => !knownSectorIds.has(id));
  const groups = [
    ...knownSectors.map((sector) => ({ id: String(sector.id), name: sector.name })),
    ...unknownSectorIds.map((id) => ({ id, name: id })),
    ...(normalizedUsers.some((user) => !user.sectorIds.length)
      ? [{ id: "__global__", name: "Acesso global ou sem setor" }]
      : [])
  ].map((group) => ({
    ...group,
    users: group.id === "__global__"
      ? normalizedUsers.filter((user) => !user.sectorIds.length)
      : normalizedUsers.filter((user) => user.sectorIds.includes(group.id))
  }));

  if (!groups.some((group) => group.id === selectedUserSectorId)) selectedUserSectorId = null;
  if (sectorList) {
    sectorList.innerHTML = groups.map((group) => `
      <button class="manager-user-sector${group.id === selectedUserSectorId ? " is-selected" : ""}" type="button" data-user-sector="${escapeHtml(group.id)}" aria-pressed="${group.id === selectedUserSectorId}">
        <span>${escapeHtml(group.name)}</span><b>${group.users.length}</b>
      </button>
    `).join("");
  }

  const selectedGroup = groups.find((group) => group.id === selectedUserSectorId);
  results.hidden = false;
  if (status) {
    status.removeAttribute("data-state");
    status.textContent = selectedGroup
      ? `${selectedGroup.name}: ${selectedGroup.users.length} ${selectedGroup.users.length === 1 ? "conta" : "contas"}.`
      : adminUsers.length
        ? "Escolha um setor para consultar somente as contas vinculadas a ele."
      : "Nenhuma conta cadastrada. As novas contas aparecerão aqui após o cadastro.";
  }
  if (!selectedGroup) {
    results.innerHTML = adminUsers.length
      ? `<p class="manager-users-empty">Selecione um setor para consultar somente as contas vinculadas a ele.</p>`
      : `<p class="manager-users-empty">Nenhuma conta cadastrada no momento.</p>`;
    return;
  }
  if (!selectedGroup.users.length) {
    results.innerHTML = `<p class="manager-users-empty">Nenhuma conta vinculada a este setor.</p>`;
    return;
  }
  results.innerHTML = selectedGroup.users.map((user) => `
    <article class="manager-user-row">
      <div class="manager-person">
        <span>${escapeHtml(initials(user.name))}</span>
        <div>
          <strong>${escapeHtml(user.name)}</strong>
          <small>${escapeHtml(user.email)}</small>
          <small>${selectedGroup.id === "__global__" ? "Acesso global ou sem setor específico." : `Setor: ${escapeHtml(selectedGroup.name)}`}</small>
        </div>
      </div>
      <b class="manager-badge neutral">${escapeHtml(roleLabel(user.role))}</b>
    </article>
  `).join("");
}

function updateUserRoleFields() {
  const role = document.querySelector("#userRole")?.value || "";
  const permissions = document.querySelector("#userSectorPermissions");
  if (!permissions) return;
  const restricted = ["tablet", "marketing"].includes(role);
  permissions.hidden = restricted;
  const legend = permissions.querySelector("legend");
  if (legend) legend.textContent = role === "tv" ? "Setores da TV" : "Setores autorizados";
  permissions.querySelectorAll("input[name=sectorIds]").forEach((input) => {
    input.disabled = restricted;
    if (restricted) input.checked = false;
  });
}

function renderUserSectorPermissions() {
  const permissions = document.querySelector("#userSectorPermissions");
  if (!permissions) return;
  const selected = new Set([...permissions.querySelectorAll("input[name=sectorIds]:checked")].map((input) => input.value));
  const sectors = Array.isArray(adminState.sectors) ? adminState.sectors : [];
  const legend = document.createElement("legend");
  legend.textContent = "Setores autorizados";
  permissions.replaceChildren(legend);
  if (!sectors.length) {
    const empty = document.createElement("p");
    empty.dataset.sectorPermissionsStatus = "empty";
    empty.textContent = "Nenhum setor disponível.";
    permissions.append(empty);
    return;
  }
  sectors.forEach((sector) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "sectorIds";
    input.value = sector.id;
    input.checked = selected.has(String(sector.id));
    const text = document.createElement("span");
    text.textContent = sector.name || sector.id;
    label.append(input, text);
    permissions.append(label);
  });
  updateUserRoleFields();
}

async function saveSector(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const feedback = form.querySelector("[data-sector-feedback]");
  if (form.dataset.submitting === "true") return;
  form.dataset.submitting = "true";
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Salvando alterações…";
  }
  if (feedback) {
    feedback.className = "manager-form-feedback";
    feedback.textContent = "Salvando alterações…";
  }
  const data = Object.fromEntries(new FormData(form).entries());
  data.queueSize = Number(data.queueSize);
  data.averageServiceSeconds = Math.max(1, (Number(data.averageServiceMinutes || 0) * 60) + Number(data.averageServiceRestSeconds || 0));
  delete data.averageServiceMinutes;
  delete data.averageServiceRestSeconds;
  data.capacity = Number(data.capacity);
  try {
    await api(`/api/sectors/${form.dataset.sectorForm}`, {
      method: "PUT",
      body: data
    });
    const requests = [loadAdminState()];
    if (needsAdminMetrics()) requests.push(loadMetrics());
    await Promise.all(requests);
    if (feedback) {
      feedback.className = "manager-form-feedback success";
      feedback.textContent = "Alterações salvas com sucesso.";
    }
  } catch (error) {
    if (feedback) {
      feedback.className = "manager-form-feedback error";
      feedback.textContent = error.message || "Não foi possível salvar o setor.";
    }
  } finally {
    form.dataset.submitting = "false";
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = "Salvar alterações";
    }
  }
}

async function createUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const feedback = form.querySelector("[data-user-feedback]");
  if (form.dataset.submitting === "true") return;
  form.dataset.submitting = "true";
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Criando conta…";
  }
  if (feedback) {
    feedback.className = "manager-form-feedback";
    feedback.textContent = "Criando conta…";
  }
  const data = Object.fromEntries(new FormData(form).entries());
  data.sectorIds = new FormData(form).getAll("sectorIds");
  try {
    await api("/api/users", {
      method: "POST",
      body: data
    });
    form.reset();
    updateUserRoleFields();
    if (adminUsersLoaded) await loadUsers();
    if (feedback) {
      feedback.className = "manager-form-feedback success";
      feedback.textContent = "Conta criada com sucesso.";
    }
  } catch (error) {
    if (feedback) {
      feedback.className = "manager-form-feedback error";
      feedback.textContent = error?.message || "Não foi possível criar o usuário.";
    }
  } finally {
    form.dataset.submitting = "false";
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = "Criar conta";
    }
  }
}

function statusLabel(status) {
  return { open: "Aberto", paused: "Pausado", closed: "Fechado" }[status] || status;
}

function ticketStatus(ticket) {
  const labels = {
    aguardando: "Aguardando",
    proximo: "Próximo",
    chamado: "Chamado",
    em_atendimento: "Em atendimento",
    standby: "Em espera",
    espera_inteligente: "Espera inteligente"
  };
  return labels[ticket.status] || ticket.status;
}

function priorityReasonLabel(value) {
  const labels = {
    deficiencia_ou_mobilidade_reduzida: "Mobilidade reduzida",
    tea: "TEA",
    idoso_60_mais: "Idoso 60+",
    gestante_ou_lactante: "Gestante ou lactante",
    crianca_de_colo: "Criança de colo",
    obesidade: "Obesidade"
  };
  return labels[value] || value || "Categoria não informada";
}

function roleLabel(role) {
  return { customer: "Cliente", attendant: "Funcionário", manager: "Gestor", admin: "Gestor", marketing: "Marketing · TV", tablet: "Tablet", tv: "TV · Açougue" }[role] || role;
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function initials(value) {
  const parts = String(value || "Cliente").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "C").concat(parts[1]?.[0] || "").toUpperCase();
}

async function api(path, options = {}) {
  const method = options.method || "GET";
  const mutation = method !== "GET";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  if (mutation) notifyPwa("markCriticalOperation", true);
  try {
    const response = await fetch(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...csrfHeader()
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal || controller.signal
    });
    const payload = await parseApiPayload(response);
    notifyPwa("reportNetworkSuccess");
    if (!response.ok || payload.error) throw new Error(payload.error || "Falha na API.");
    return payload;
  } catch (error) {
    notifyPwa("reportNetworkFailure");
    if (error?.name === "AbortError") {
      throw new Error("O servidor demorou mais de 15 segundos para responder. Atualize a página e tente novamente.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (mutation) notifyPwa("markCriticalOperation", false);
  }
}

function notifyPwa(method, ...args) {
  try {
    window.senhaHubPwa?.[method]?.(...args);
  } catch {
    // PWA telemetry is optional and must not change the result of an API call.
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

function businessToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
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

async function logout() {
  await window.senhaHubPwa?.prepareLogout();
  await api("/api/auth/logout", { method: "POST" });
  location.href = "/login";
}


async function loadPrintReview() {
  const container=document.querySelector('#printReviewList');
  if(!container)return;
  const refreshButton=document.querySelector('#refreshPrintReview');
  if(refreshButton){refreshButton.disabled=true;refreshButton.setAttribute('aria-busy','true');refreshButton.textContent='Consultando…';}
  container.setAttribute('aria-busy','true');
  container.innerHTML='<p class="manager-empty">Consultando ocorrências de impressão…</p>';
  try {
    const metrics=await api('/api/observability');
    const rows=metrics.printing?.reviewJobs || [];
    container.innerHTML=rows.length ? rows.map(job=>`
      <form class="manager-alert manager-alert-attention" data-print-review="${escapeHtml(job.id)}">
        <div><strong>Resultado incerto — ${escapeHtml(job.kiosk_id)}</strong>
          <p>${escapeHtml(job.last_error || 'Confira a impressora antes de continuar.')}</p>
          <label>Decisão <select name="action"><option value="confirm_printed">O cupom foi impresso</option><option value="resolve_failed">Encerrar sem reimprimir</option><option value="reprint">Autorizar uma reimpressão</option></select></label>
          <label>Motivo <input name="reason" required minlength="5" maxlength="500"></label>
          <label><input name="writerStopped" type="checkbox" required> Parei o agente anterior e conferi o papel.</label>
          <button class="manager-button" type="submit" ${['admin','manager'].includes(currentUser?.role)?'':'disabled'}>Registrar decisão</button>
          <p data-print-feedback></p>
    </div>
  </form>`).join('') : '<p class="manager-empty">Tudo em ordem — não há impressões aguardando revisão.</p>';
    for(const form of container.querySelectorAll('[data-print-review]'))form.addEventListener('submit',async event=>{
      event.preventDefault();const button=form.querySelector('button');button.disabled=true;
      // Preserve request identity across a lost acknowledgement while this form is displayed.
      form.dataset.requestId ||= crypto.randomUUID();
      try {
        const fields=new FormData(form);
        await api('/api/print/v2/resolve',{method:'POST',body:{jobId:form.dataset.printReview,requestId:form.dataset.requestId,action:fields.get('action'),reason:fields.get('reason'),writerStopped:fields.get('writerStopped')==='on'}});
        await loadPrintReview();
      }catch(error){form.querySelector('[data-print-feedback]').textContent=error.message;button.disabled=false;}
    });
  }catch(error){container.innerHTML=`<p class="manager-empty" role="status">Não foi possível consultar as impressões. ${escapeHtml(error.message)}</p>`;}
  finally{container.removeAttribute('aria-busy');if(refreshButton){refreshButton.disabled=false;refreshButton.removeAttribute('aria-busy');refreshButton.textContent='Atualizar lista';}}
}
