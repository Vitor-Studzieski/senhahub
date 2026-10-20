/* Six analytical views in the manager area. Only live records and the validated
   17/10/2026 Pitch Day report are displayed as measurements. */
const managerViews = [
  ["executiva", "Visão geral executiva", "▦"],
  ["alertas", "Alertas e decisões", "⚑"],
  ["equipe", "Equipe e SLA", "♟"],
  ["jornada", "Jornada digital", "◇"],
  ["inclusao", "Inclusão", "✳"],
  ["lojas", "Lojas e setores", "▥"]
];

function managerEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function setupManagerDashboards(user) {
  const nav = document.querySelector(".manager-nav");
  if (!nav) return;
  const isHub = window.location.pathname === "/admin";
  nav.innerHTML = `<span class="manager-nav-group">Dashboards</span>${managerViews.map(([key, label, icon]) =>
    `<a href="/admin#${key}" data-manager-view="${key}"><span class="manager-nav-glyph" aria-hidden="true">${icon}</span><span>${label}</span></a>`
  ).join("")}<span class="manager-nav-group">Gestão</span>
    <a href="/admin/operacao"><span class="manager-nav-glyph" aria-hidden="true">≋</span><span>Atendimentos</span></a>
    <a href="/admin/setores"><span class="manager-nav-glyph" aria-hidden="true">▤</span><span>Configurar setores</span></a>
    <a href="/admin/totens"><span class="manager-nav-glyph" aria-hidden="true">▣</span><span>Totens e impressão</span></a>
    <a href="/admin/usuarios"><span class="manager-nav-glyph" aria-hidden="true">♙</span><span>Usuários</span></a>
    ${String(user?.email || "").trim().toLowerCase() === "vitorstudzieski@superpompeia.com" ? '<a href="/admin/atalhos"><span class="manager-nav-glyph" aria-hidden="true">⌘</span><span>Atalhos</span></a>' : ""}`;
  if (!isHub) {
    nav.querySelector(`a[href="${window.location.pathname}"]`)?.classList.add("active");
    return;
  }
  nav.querySelectorAll("[data-manager-view]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.history.pushState(null, "", `#${link.dataset.managerView}`);
      selectManagerView();
    });
  });
  const main = document.querySelector(".manager-main");
  const topbar = main?.querySelector(".manager-topbar");
  if (!main || !topbar) return;
  main.classList.add("manager-dashboard-hub");
  const toolbarTitle = topbar.firstElementChild;
  if (toolbarTitle) toolbarTitle.innerHTML = '<span class="md-toolbar-label">PAINEL DO GESTOR</span><strong>SenhaHub <em>Analytics</em></strong>';
  const root = document.createElement("div");
  root.id = "managerDashboardRoot";
  root.setAttribute("aria-live", "polite");
  topbar.after(root);
  const legacy = document.createElement("details");
  legacy.className = "manager-archive-details";
  legacy.innerHTML = "<summary>Relatório detalhado e manutenção do histórico</summary>";
  [...main.children].filter((child) => child !== topbar && child !== root && child !== legacy).forEach((child) => legacy.append(child));
  main.append(legacy);
  const date = legacy.querySelector(".manager-date-filter");
  const refresh = legacy.querySelector("#refreshDashboardButton");
  const actions = topbar.querySelector(".manager-actions");
  if (date && actions) actions.prepend(date);
  if (refresh && actions) actions.prepend(refresh);
  topbar.querySelector(".manager-live-state")?.remove();
  window.addEventListener("hashchange", selectManagerView);
  window.addEventListener("popstate", selectManagerView);
  selectManagerView();
}

function selectManagerView() {
  const root = document.querySelector("#managerDashboardRoot");
  if (!root) return;
  const key = window.location.hash.slice(1);
  const selected = managerViews.some(([id]) => id === key) ? key : "executiva";
  root.querySelectorAll("[data-dashboard-panel]").forEach((panel) => { panel.hidden = panel.dataset.dashboardPanel !== selected; });
  document.querySelectorAll(".manager-nav [data-manager-view]").forEach((link) => {
    link.classList.toggle("active", link.dataset.managerView === selected);
    if (link.dataset.managerView === selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const title = managerViews.find(([id]) => id === selected)?.[1];
  const topTitle = document.querySelector(".manager-topbar h1");
  if (topTitle) topTitle.textContent = title;
  document.title = `${title} | SenhaHub`;
  if (key === "pitchdayReport" && root.dataset.reportOpened !== "true") {
    root.dataset.reportOpened = "true";
    const archive = document.querySelector(".manager-archive-details");
    const report = archive?.querySelector(".pitchday-report-details");
    if (archive) archive.open = true;
    if (report) report.open = true;
    document.querySelector("#pitchdayReport")?.scrollIntoView({ block: "start" });
  }
}

function managerKpi(label, value, note, tone = "blue", symbol = "●") {
  return `<article class="md-kpi md-${tone}"><div class="md-kpi-heading"><span class="md-symbol" aria-hidden="true">${symbol}</span><h3>${label}</h3></div><strong>${value}</strong><small>${note}</small></article>`;
}

function managerActionControls(actions) {
  if (!Array.isArray(actions)) return managerEmpty("Ações não carregadas", "O esquema de captação ainda não está disponível.");
  if (!actions.length) return managerEmpty("Nenhuma ação em aberto", "Registre uma decisão e acompanhe o andamento aqui.");
  return `<div class="md-action-list">${actions.map((action) => `<div class="md-action-row">
    <div><strong>${managerEscape(action.title)}</strong><small>${managerEscape(action.description || action.recommendation_code || "Sem descrição")}</small></div>
    <label><span class="sr-only">Status da ação ${managerEscape(action.title)}</span><select data-manager-action-status="${managerEscape(action.id)}">
      ${[["planned", "Planejada"], ["in_progress", "Em andamento"], ["done", "Concluída"], ["dismissed", "Dispensada"]].map(([value, label]) => `<option value="${value}" ${action.status === value ? "selected" : ""}>${label}</option>`).join("")}
    </select></label>
  </div>`).join("")}</div>`;
}

function managerActionForm(configuration = {}) {
  const stores = configuration.storeList || [];
  const sectors = configuration.sectors || [];
  if (!stores.length) return "";
  return `<details class="md-inline-form"><summary>Registrar ação</summary><form data-manager-action-form>
    <label>Título<input name="title" maxlength="160" required placeholder="Ex.: reforçar equipe no pico"></label>
    <label>Descrição<input name="description" maxlength="1000" placeholder="Contexto ou resultado esperado"></label>
    <div class="md-form-row"><label>Loja<select name="storeCode">${stores.map((store) => `<option value="${managerEscape(store.store_code)}">${managerEscape(store.name)}</option>`).join("")}</select></label>
    <label>Prioridade<select name="priority"><option value="medium">Média</option><option value="high">Alta</option><option value="low">Baixa</option></select></label></div>
    <label>Setor<select name="sectorId"><option value="">Toda a loja</option>${sectors.map((sector) => `<option value="${managerEscape(sector.id)}" data-store-code="${managerEscape(sector.storeCode)}">${managerEscape(sector.name)}</option>`).join("")}</select></label>
    <label>Prazo<input name="dueAt" type="date"></label>
    <button type="submit">Salvar ação</button><small data-manager-form-message role="status"></small>
  </form></details>`;
}

function managerCaptureConfigurationForm(configuration = {}) {
  const stores = configuration.storeList || [];
  const sectors = configuration.sectors || [];
  const targets = configuration.slaTargets || [];
  const costs = configuration.operatingCosts || [];
  if (!stores.length) return managerEmpty("Configuração indisponível", "O esquema de captação ainda não está disponível.");
  const selectedStore = stores[0].store_code;
  const target = targets.find((item) => item.store_code === selectedStore && !item.sector_id) || {};
  const cost = costs.find((item) => item.store_code === selectedStore) || {};
  return `<form class="md-config-form" data-manager-config-form>
    <label>Loja<select name="storeCode">${stores.map((store) => `<option value="${managerEscape(store.store_code)}">${managerEscape(store.name)}</option>`).join("")}</select></label>
    <label>Escopo<select name="sectorId"><option value="">Toda a loja</option>${sectors.map((sector) => `<option value="${managerEscape(sector.id)}" data-store-code="${managerEscape(sector.storeCode)}">${managerEscape(sector.name)}</option>`).join("")}</select></label>
    <div class="md-form-row"><label>Meta de espera (seg.)<input name="targetWaitSeconds" type="number" min="1" max="86400" step="1" value="${target.target_wait_seconds ?? ""}" placeholder="Sem meta"></label>
    <label>Meta de serviço (seg.)<input name="targetServiceSeconds" type="number" min="1" max="86400" step="1" value="${target.target_service_seconds ?? ""}" placeholder="Sem meta"></label></div>
    <label>Custo por hora de atendente (R$)<input name="attendantHourlyCost" type="number" min="0.01" max="100000" step="0.01" value="${cost.attendant_hourly_cost ?? ""}" placeholder="Sem custo cadastrado"></label>
    <button type="submit">Salvar parâmetros</button><small data-manager-form-message role="status"></small>
  </form>`;
}

function managerPanel(title, content, extra = "", aside = "") {
  return `<article class="md-panel ${extra}"><header><h3>${title}</h3>${aside}</header>${content}</article>`;
}

function managerEmpty(label, detail = "Este dado ainda não é registrado pelo sistema.") {
  return `<div class="md-empty"><span aria-hidden="true">○</span><strong>${label}</strong><small>${detail}</small></div>`;
}

function managerBars(rows, maxValue) {
  if (!rows.length) return managerEmpty("Sem registros para a data selecionada", "Escolha outra data ou acompanhe a fila ao vivo.");
  const max = Math.max(maxValue || 0, 1, ...rows.map((row) => row.value));
  return `<div class="md-bars">${rows.map((row) => `<div class="md-bar-row"><span title="${managerEscape(row.label)}">${managerEscape(row.label)}</span><div class="md-bar-track"><i style="width:${Math.max(0, Math.min(100, Math.round(row.value / max * 100)))}%"></i></div><strong>${managerEscape(row.value)}</strong></div>`).join("")}</div>`;
}

function managerFacts(items) {
  return `<div class="md-facts">${items.map(([label, value, detail]) => `<div><span>${label}</span><strong>${value}</strong>${detail ? `<small>${detail}</small>` : ""}</div>`).join("")}</div>`;
}

function managerCallout(title, detail, tone = "blue", href = "") {
  return `<div class="md-callout md-${tone}"><span aria-hidden="true">${tone === "yellow" ? "!" : "→"}</span><div><strong>${title}</strong><p>${detail}</p></div>${href ? `<a href="${href}">Abrir →</a>` : ""}</div>`;
}

function renderManagerViews(state, metrics, summary) {
  const root = document.querySelector("#managerDashboardRoot");
  if (!root) return;
  const sectors = (state.sectors || []).map((sector) => sectorSnapshot(sector));
  const open = sectors.filter((sector) => sector.status === "open");
  const sorted = [...sectors].sort((a, b) => b.waiting.length - a.waiting.length);
  const queueRows = sorted.map((sector) => ({ label: sector.name, value: sector.waiting.length }));
  const rawVolumeRows = (metrics.sectors || []).map((sector) => ({ label: sector.name, value: Number(sector.issued || 0) })).filter((row) => row.value > 0).sort((a, b) => b.value - a.value);
  const busiest = sorted[0];
  const totalCapacity = sectors.reduce((sum, sector) => sum + Number(sector.capacity || 0), 0);
  const pressure = totalCapacity ? `${Math.round(summary.waiting / totalCapacity * 100)}%` : "—";
  const date = metrics.date ? new Date(`${metrics.date}T12:00:00`).toLocaleDateString("pt-BR") : "data selecionada";
  const capture = metrics.capture || {};
  const sourceReview = capture.sourceReconciliation;
  const suppressUnreconciledHistory = Boolean(sourceReview?.mismatch && sourceReview.date === metrics.date);
  const volumeRows = suppressUnreconciledHistory ? [] : rawVolumeRows;
  const samples = suppressUnreconciledHistory ? 0 : Number(summary.serviceSamples || 0);
  const serviceTime = samples ? formatMinutesSeconds(summary.avgServiceSeconds) : "—";
  const channels = suppressUnreconciledHistory ? {} : capture.channels || {};
  const accessible = suppressUnreconciledHistory ? {} : capture.accessibility || {};
  const teamCapture = suppressUnreconciledHistory ? {} : capture.team || {};
  const cancellation = suppressUnreconciledHistory ? {} : capture.cancellations || {};
  const slaCapture = suppressUnreconciledHistory ? {} : capture.sla || {};
  const notifications = suppressUnreconciledHistory ? null : capture.notifications;
  const configuration = capture.configuration || {};
  const formatted = (value, suffix = "") => value === null || value === undefined ? "—" : `${value}${suffix}`;
  const resourceRows = Object.entries(accessible.bySupport || {}).map(([code, value]) => ({
    label: ({ libras: "Libras", texto_visual: "Texto / visual", modo_silencioso: "Modo silencioso", audio: "Áudio", mobilidade: "Mobilidade", outro: "Outros" })[code] || code,
    value: Number(value || 0)
  })).filter((row) => row.value > 0);
  const storeRows = (suppressUnreconciledHistory ? [] : capture.hourly?.byStore || []).map((store) => ({
    label: store.storeCode === "unassigned" ? "Sem loja" : store.storeName || store.storeCode,
    value: Number(store.issued || 0)
  }));
  const productivityRows = (teamCapture.productivity || []).map((row) => ({ label: row.attendant || "Sem atribuição", value: Number(row.completed || 0) }));
  const hourlyRows = (suppressUnreconciledHistory ? [] : capture.hourly?.tickets || []).map((row) => ({ label: `${String(row.hour).padStart(2, "0")}h`, value: Number(row.count || 0) }));
  const actionItems = capture.actions?.items || [];
  const actionRows = managerActionControls(capture.available ? actionItems : null);
  const waitSla = slaCapture.wait || {};
  const serviceSla = slaCapture.service || {};
  const averageWait = (suppressUnreconciledHistory ? [] : metrics.sectors || [])
    .filter((sector) => Number(sector.waitSamples || 0) > 0)
    .map((sector) => Number(sector.averageWaitSeconds))
    .filter(Number.isFinite);
  const averageWaitLabel = averageWait.length
    ? formatMinutesSeconds(Math.round(averageWait.reduce((sum, value) => sum + value, 0) / averageWait.length))
    : "—";
  const sourceWarning = suppressUnreconciledHistory
    ? managerCallout(
      "Pitch Day: usando o relatório validado",
      `A base operacional de 17/10 registra ${sourceReview.raw.issued} senhas, ${sourceReview.raw.calledTickets} com chamada e ${sourceReview.raw.measurableCallIntervals} intervalos. O relatório validado registra ${sourceReview.validated.issued}, ${sourceReview.validated.attendedByCallSequence} com chamada e ${sourceReview.validated.measurableCallIntervals} intervalos. Os indicadores históricos divergentes ficam suspensos nesta data para não misturar as fontes.`,
      "yellow"
    )
    : "";
  const section = (key, heading, subtitle, cards, panels) => `<section class="md-view" data-dashboard-panel="${key}" ${key !== "executiva" ? "hidden" : ""}><div class="md-intro"><div><p class="md-eyebrow">Dashboard · ${date}</p><h2>${heading}</h2><p>${subtitle}</p></div><span class="md-source">${suppressUnreconciledHistory ? "Relatório validado · operação ao vivo" : "Ao vivo + Pitch Day 17/10/2026"}</span></div>${sourceWarning}<div class="md-kpis">${cards.join("")}</div><div class="md-grid">${panels.join("")}</div></section>`;

  const executive = section("executiva", "Visão geral executiva", "Fluxo atual, capacidade e histórico validado em uma visão.", [
    managerKpi("Senhas emitidas", "131", "Pitch Day · 17/10/2026", "blue", "▣"),
    managerKpi("Com chamada", "105", "Pitch Day · consideradas atendidas", "green", "✓"),
    managerKpi("Aguardando", summary.waiting, "Fila ao vivo", "yellow", "◷"),
    managerKpi("Tempo de serviço", serviceTime, samples ? `${samples} medições` : "Sem atendimento medido", "sky", "◴"),
    managerKpi("Capacidade usada", pressure, "Fila / capacidade configurada", "red", "◉"),
    managerKpi("Preferenciais", "8", "Pitch Day · 17/10/2026", "purple", "✳")
  ], [
    managerPanel("Fluxo das senhas · Pitch Day", `${managerBars([{ label: "Emitidas", value: 131 }, { label: "Com chamada", value: 105 }], 131)}<p class="md-caption">Totais do evento. A distribuição por hora não consta no relatório validado.</p>`, "md-wide", '<span class="md-panel-meta">17/10/2026</span>'),
    managerPanel("Fila ao vivo", managerBars(queueRows), ""),
    managerPanel("Canais do Pitch Day", `<div class="md-donut-row"><div class="md-donut" style="--part:69.5%"><strong>131<small>senhas</small></strong></div><div class="md-legend"><span><i class="md-dot-blue"></i>Totem <strong>91 · 69,5%</strong></span><span><i class="md-dot-yellow"></i>Digital QR/app <strong>40 · 30,5%</strong></span></div></div><p class="md-caption">Origem digital agrupada; escaneamento do QR não confirmado.</p>`),
    managerPanel("Ritmo e prioridade · Pitch Day", managerFacts([["Com chamada", "105", "Consideradas atendidas no fluxo"], ["Mediana entre chamadas", "47 s", "103 intervalos medidos"], ["Preferenciais", "8", "6 idosos, 1 autista, 1 deficiência não aparente"]]), "md-wide"),
    managerPanel("Pontos de atenção", `${managerCallout(busiest ? `${managerEscape(busiest.name)} · ${busiest.waiting.length} na fila` : "Nenhuma fila ativa", "Acompanhe o setor com a maior fila neste momento.", "yellow", "/admin/operacao")}${managerCallout("Histórico e status divergentes", "105 senhas tiveram chamada, mas o status final do banco marcou apenas 1 como atendida.", "blue")}`),
    managerPanel("Nível de serviço · SLA", managerEmpty("Meta de SLA não definida", "O painel passará a exibir cumprimento e exceções após configurar a meta e registrar a duração por atendimento.")),
    managerPanel("Emissões por setor", managerBars(volumeRows), "md-wide", `<span class="md-panel-meta">${date}</span>`)
  ]);

  const alertCount = summary.overloaded.length + sectors.filter((sector) => sector.status !== "open").length;
  const alerts = section("alertas", "Alertas, oportunidades e decisões", "Priorize o que a fila mostra agora e acompanhe ações que dependem de medição.", [
    managerKpi("Alertas ativos", alertCount, "Fila e disponibilidade ao vivo", "red", "!"),
    managerKpi("Setores em atenção", summary.overloaded.length, "Capacidade excedida", "yellow", "!"),
    managerKpi("Taxa de no-show", formatted(cancellation.noShowRate, "%"), cancellation.noShowRate === null || cancellation.noShowRate === undefined ? `${cancellation.classified || 0}/${cancellation.total || 0} cancelamentos classificados` : `${cancellation.noShows} entre senhas chamadas`, "red", "↶"),
    managerKpi("Economia potencial", "—", "Sem base de custos", "green", "$"),
    managerKpi("Picos previstos", "—", "Sem modelo de previsão", "sky", "▥"),
    managerKpi("Ações concluídas", formatted(capture.actions?.completed), capture.actions ? "Registradas no período" : "Sem controle de execução", "blue", "✓")
  ], [
    managerPanel("Carga e capacidade", managerBars(queueRows), "md-wide"),
    managerPanel("Alertas do momento", summary.overloaded.length ? summary.overloaded.map((sector) => managerCallout(managerEscape(sector.name), `${sector.waiting.length} aguardando · capacidade ${sector.capacity}`, "yellow", "/admin/operacao")).join("") : managerEmpty("Nenhum setor acima da capacidade", "Os alertas serão exibidos aqui quando houver pressão na fila.")),
    managerPanel("Impacto × urgência", sectors.length ? `<div class="md-impact">${sorted.slice(0, 5).map((sector) => `<div><span>${managerEscape(sector.name)}</span><strong>${sector.waiting.length} na fila</strong><i class="${sector.load >= 100 ? "critical" : ""}"></i></div>`).join("")}</div>` : managerEmpty("Sem setores cadastrados"), "md-wide"),
    managerPanel("Plano de ação gerencial", `${actionRows}${managerActionForm(configuration)}`),
    managerPanel("Previsão de fluxo para amanhã", managerEmpty("Previsão indisponível", "É necessária uma série horária de demanda e capacidade antes de projetar o próximo dia."), "md-wide"),
    managerPanel("Cancelamentos por motivo", capture.available && Object.values(cancellation.byReason || {}).some((value) => value > 0)
      ? managerBars(Object.entries(cancellation.byReason).filter(([, value]) => value > 0).map(([reason, value]) => ({
        label: ({ customer_request: "Pedido do cliente", operator_request: "Ação do atendente", no_show: "Não compareceu", standby_expired: "Prazo de espera", queue_reset: "Zeramento da fila", operational_error: "Erro operacional", duplicate: "Duplicada", unknown: "Não classificada", unclassified: "Sem motivo histórico" })[reason] || reason,
        value: Number(value)
      })))
      : managerEmpty("Motivos ainda não disponíveis", "Cancelamentos antigos não têm motivo confiável; não são tratados como abandono."))
  ]);

  const team = section("equipe", "Equipe, produtividade e SLA", "Leia o trabalho da equipe sem confundir intervalo entre chamadas com duração de atendimento.", [
    managerKpi("Atendentes ativos", formatted(teamCapture.activeNow), teamCapture.activeNow === null || teamCapture.activeNow === undefined ? "Presença só vale para hoje" : `${teamCapture.onBreakNow || 0} em pausa`, "blue", "♟"),
    managerKpi("Atendimentos concluídos", suppressUnreconciledHistory ? "—" : formatted(productivityRows.reduce((sum, row) => sum + row.value, 0)), suppressUnreconciledHistory ? "Base histórica em conferência" : productivityRows.length ? "Com responsável identificado" : "Sem produção individual", "green", "▥"),
    managerKpi("Tempo de serviço", serviceTime, samples ? `${samples} medições na data` : "Sem amostra na data", "yellow", "◷"),
    managerKpi("Cumprimento de SLA", formatted(waitSla.compliancePercent, "%"), waitSla.samples ? `${waitSla.samples} atendimentos medidos` : "Defina uma meta de espera", "sky", "✓"),
    managerKpi("Rechamadas", "—", "Sem série consolidada", "red", "↶"),
    managerKpi("Ocupação registrada", formatted(teamCapture.occupancyPercent, "%"), teamCapture.availableHours ? `${teamCapture.availableHours} h disponíveis · presença registrada` : "Sem presença da equipe", "purple", "◉")
  ], [
    managerPanel("Carga por setor", managerBars(queueRows), "md-wide"),
    managerPanel("Cumprimento das metas de SLA", serviceSla.samples || waitSla.samples ? managerFacts([["Dentro da meta de espera", formatted(waitSla.compliancePercent, "%"), `${waitSla.compliant || 0}/${waitSla.samples || 0} atendimentos`], ["Dentro da meta de serviço", formatted(serviceSla.compliancePercent, "%"), `${serviceSla.compliant || 0}/${serviceSla.samples || 0} atendimentos`]]) : managerEmpty("Sem amostra de SLA", "Defina metas e registre o início e o encerramento do atendimento.")),
    managerPanel("Produtividade por atendente", productivityRows.length ? managerBars(productivityRows) : managerEmpty("Sem contagem individual", "Os atendimentos concluídos serão atribuídos quando a equipe registrar chamada e início.")),
    managerPanel("Ritmo medido no Pitch Day", managerFacts([["Com chamada", "105", "Senhas com chamada"], ["Mediana", "47 s", "Entre chamadas consecutivas"], ["Média", "1 min 53 s", "Entre chamadas consecutivas"], ["Percentil 90", "2 min 43 s", "103 intervalos"]]), "md-wide"),
    managerPanel("Necessidade de reforço", managerCallout("Monitorar setores com fila", `${summary.waiting} senha(s) aguardando agora. Sem escala de atendentes, não há estimativa segura de reforço.`, "yellow", "/admin/operacao")),
    managerPanel("Distribuição das emissões por horário", hourlyRows.length ? managerBars(hourlyRows) : managerEmpty("Sem série horária", "As emissões passam a ser agrupadas por hora na data selecionada."), "md-wide")
  ]);

  const digital = section("jornada", "Jornada do cliente e canais digitais", "Acompanhe aberturas de página e emissões por canal sem tratar visita como pessoa ou conversão.", [
    managerKpi("Aberturas de página QR", formatted(channels.qrLandingEvents), suppressUnreconciledHistory ? "Base histórica em conferência" : "Visitas registradas, não scans únicos", "blue", "▦"),
    managerKpi("Instalações PWA", formatted(channels.appInstallEvents), suppressUnreconciledHistory ? "Base histórica em conferência" : "Evento informado pelo navegador", "green", "⇩"),
    managerKpi("Origem digital", "40", "QR/app juntos · Pitch Day", "yellow", "▣"),
    managerKpi("Notificações abertas", formatted(notifications?.opened), notifications ? `${notifications.sent} enviadas · taxa ${formatted(notifications.openRate, "%")}` : "Sem registro confiável para esta data", "sky", "◉"),
    managerKpi("Clientes recorrentes", formatted(channels.returningCustomerCount), channels.returningCustomerCount === undefined ? "Sem identificação de recorrência" : "Mais de uma emissão na data selecionada", "red", "♟"),
    managerKpi("Taxa de no-show", formatted(cancellation.noShowRate, "%"), cancellation.noShowRate === null || cancellation.noShowRate === undefined ? "Sem classificação completa dos cancelamentos" : `${cancellation.noShows} no-show(s) entre senhas chamadas`, "purple", "−")
  ], [
    managerPanel("Origem das senhas · Pitch Day", `<div class="md-donut-row"><div class="md-donut" style="--part:69.5%"><strong>131<small>emissões</small></strong></div><div class="md-legend"><span><i class="md-dot-blue"></i>Totem <strong>91</strong></span><span><i class="md-dot-yellow"></i>Digital QR/app <strong>40</strong></span></div></div>`, "md-wide"),
    managerPanel("Eventos digitais capturados", `<div class="md-funnel"><div><span>Emissões QR</span><strong>${formatted(channels.issuedTickets?.qr)}</strong></div><div><span>Aberturas de QR</span><strong>${formatted(channels.qrLandingEvents)}</strong></div><div><span>Instalações PWA</span><strong>${formatted(channels.appInstallEvents)}</strong></div><div><span>Emissões via app</span><strong>${formatted(channels.issuedTickets?.app)}</strong></div></div><p class="md-caption">As etapas não são ligadas a uma pessoa; não representam conversão individual.</p>`),
    managerPanel("Prioridade por canal", managerFacts([["Totem", "84 + 7", "Normais + preferenciais"], ["Digital QR/app", "39 + 1", "Normais + preferenciais"]]), "md-wide"),
    managerPanel("Oportunidades de medição", `${managerCallout("Origem do Pitch Day", "Os 40 registros digitais permanecem agrupados como QR/app no relatório validado.")}${managerCallout("Interpretação de QR", "A abertura da página é registrada; o sistema não confirma um scan único.")}`),
    managerPanel("Conversão e adoção por loja", managerEmpty("Sem eventos de conversão", "O relatório não divide QR/app por loja nem registra a passagem entre etapas."), "md-wide"),
    managerPanel("Clientes recorrentes por canal", managerEmpty("Sem identificação de recorrência", "É preciso associar visitas ao mesmo cliente, com tratamento adequado dos dados."))
  ]);

  const inclusion = section("inclusao", "Inclusão e acessibilidade", "Preferenciais históricos e recursos de atendimento são mostrados como medidas distintas.", [
    managerKpi("Preferenciais", "8", "De 131 senhas no Pitch Day", "blue", "✳"),
    managerKpi("Idosos 60+", "6", "75% das preferenciais", "green", "♟"),
    managerKpi("Pessoas autistas", "1", "12,5% das preferenciais", "yellow", "◇"),
    managerKpi("Deficiência não aparente", "1", "12,5% das preferenciais", "sky", "◇"),
    managerKpi("Satisfação em atendimentos acessíveis", accessible.satisfaction === null || accessible.satisfaction === undefined ? "—" : `${accessible.satisfaction}/5`, `${accessible.satisfactionSamples || 0} avaliações ligadas a um recurso`, "red", "♡"),
    managerKpi("Espera acessível", accessible.wait?.accessibleAverageSeconds ? formatMinutesSeconds(accessible.wait.accessibleAverageSeconds) : "—", `${accessible.wait?.accessibleSamples || 0} amostras com recurso registrado`, "purple", "◷")
  ], [
    managerPanel("Perfil preferencial · Pitch Day", managerBars([{ label: "Idoso 60+", value: 6 }, { label: "Pessoas autistas", value: 1 }, { label: "Deficiência não aparente", value: 1 }], 8), "md-wide"),
    managerPanel("Recursos acessíveis utilizados", resourceRows.length ? managerBars(resourceRows) : managerEmpty("Uso ainda não medido", "A equipe registra recursos solicitados, utilizados ou indisponíveis durante o atendimento.")),
    managerPanel("Evolução dos atendimentos", managerEmpty("Sem série temporal", "O relatório oferece o total do evento, sem distribuição por horário.")),
    managerPanel("Tempo de espera e satisfação", managerFacts([["Espera geral", accessible.wait?.generalAverageSeconds ? formatMinutesSeconds(accessible.wait.generalAverageSeconds) : "—", `${accessible.wait?.generalSamples || 0} amostras`], ["Com recurso acessível", accessible.wait?.accessibleAverageSeconds ? formatMinutesSeconds(accessible.wait.accessibleAverageSeconds) : "—", `${accessible.wait?.accessibleSamples || 0} amostras`], ["Satisfação vinculada", accessible.satisfaction === null || accessible.satisfaction === undefined ? "—" : `${accessible.satisfaction}/5`, `${accessible.satisfactionSamples || 0} avaliações`]]), "md-wide"),
    managerPanel("Prioridade de instrumentação", managerCallout("Registrar recurso utilizado", "Associe Libras, silêncio e texto/visual ao atendimento para acompanhar a experiência.", "blue")),
    managerPanel("Ocorrências por loja", managerEmpty("Sem registro por unidade", "O Pitch Day não discrimina preferenciais nem recursos acessíveis por loja."), "md-wide")
  ]);

  const stores = section("lojas", "Operação por loja e setor", "Compare emissões por unidade e acompanhe pressão de fila ao vivo por setor.", [
    managerKpi("Lojas monitoradas", formatted(capture.configuration?.stores), "Cadastro de unidades", "blue", "▣"),
    managerKpi("Setores ativos", open.length, `${sectors.length} cadastrados`, "green", "▤"),
    managerKpi("Maior fila", busiest?.waiting.length || 0, busiest ? managerEscape(busiest.name) : "Nenhuma fila", "yellow", "♟"),
    managerKpi("Aguardando", summary.waiting, "Em todos os setores", "sky", "◷"),
    managerKpi("Espera média", averageWaitLabel, `${averageWait.length} setores com amostra`, "red", "◴"),
    managerKpi("Capacidade usada", pressure, "Fila / capacidade configurada", "purple", "◉")
  ], [
    managerPanel("Comparativo entre setores", managerBars(queueRows), "md-wide"),
    managerPanel("Capacidade atual", sectors.length ? `<div class="md-sector-list">${sorted.map((sector) => `<div><span>${managerEscape(sector.name)}</span><strong>${sector.waiting.length} / ${sector.capacity}</strong><i class="${sector.load >= 100 ? "critical" : ""}"></i></div>`).join("")}</div>` : managerEmpty("Sem setores configurados")),
    managerPanel("Mapa de pico por horário", hourlyRows.length ? managerBars(hourlyRows) : managerEmpty("Sem distribuição por hora", "As emissões passam a ser agrupadas por setor e horário.")),
    managerPanel("Ranking operacional", sectors.length ? `<div class="md-ranking">${sorted.map((sector, index) => `<div><b>${index + 1}</b><strong>${managerEscape(sector.name)}</strong><span>${sector.waiting.length} na fila</span><small>${sector.load >= 100 ? "Atenção" : "Normal"}</small></div>`).join("")}</div>` : managerEmpty("Sem unidades configuradas"), "md-wide"),
    managerPanel("Metas e custo operacional", capture.available ? managerCaptureConfigurationForm(configuration) : managerEmpty("Banco aguardando estrutura de captura", "As novas métricas aparecem depois de aplicar a migration do painel.")),
    managerPanel("Ação recomendada", managerCallout(busiest ? `Verificar ${managerEscape(busiest.name)}` : "Acompanhar operação", "A configuração de setores e capacidade está na área de gestão.", "yellow", "/admin/setores")),
    managerPanel("Emissões por horário", hourlyRows.length ? managerBars(hourlyRows) : managerEmpty("Sem dados horários", "Cada emissão registra data e setor para formar esta série.")),
    managerPanel("Emissões por loja", storeRows.length ? managerBars(storeRows) : managerEmpty("Sem volume por loja", "A emissão passa a ser agrupada quando os setores estiverem vinculados a uma unidade."), "md-wide")
  ]);

  root.innerHTML = executive + alerts + team + digital + inclusion + stores;
  bindManagerCaptureForms(root, configuration);
  selectManagerView();
}

function bindManagerCaptureForms(root, configuration) {
  root.querySelectorAll("[data-manager-action-status]").forEach((select) => {
    select.addEventListener("change", async () => {
      select.disabled = true;
      try {
        await api(`/api/manager/actions/${encodeURIComponent(select.dataset.managerActionStatus)}`, { method: "PATCH", body: { status: select.value } });
        await refreshDashboard();
      } catch (error) {
        window.alert(error.message || "Não foi possível atualizar a ação.");
        select.disabled = false;
      }
    });
  });
  const actionForm = root.querySelector("[data-manager-action-form]");
  if (actionForm) {
    const storeSelect = actionForm.elements.storeCode;
    const sectorSelect = actionForm.elements.sectorId;
    const updateSectors = () => {
      [...sectorSelect.options].forEach((option) => {
        const visible = !option.value || option.dataset.storeCode === storeSelect.value;
        option.hidden = !visible;
        option.disabled = !visible;
      });
      if (sectorSelect.selectedOptions[0]?.disabled) sectorSelect.value = "";
    };
    storeSelect.addEventListener("change", updateSectors);
    updateSectors();
    actionForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(actionForm);
      const message = actionForm.querySelector("[data-manager-form-message]");
      const button = actionForm.querySelector("button[type=submit]");
      button.disabled = true;
      if (message) message.textContent = "Salvando…";
      try {
        await api("/api/manager/actions", { method: "POST", body: {
          title: form.get("title"), description: form.get("description"), priority: form.get("priority"),
          storeCode: form.get("storeCode"), sectorId: form.get("sectorId") || null,
          dueAt: form.get("dueAt") || null
        } });
        await refreshDashboard();
      } catch (error) {
        if (message) message.textContent = error.message || "Não foi possível salvar.";
        button.disabled = false;
      }
    });
  }
  const configForm = root.querySelector("[data-manager-config-form]");
  if (!configForm) return;
  const storeSelect = configForm.elements.storeCode;
  const sectorSelect = configForm.elements.sectorId;
  const updateStoreFields = () => {
    const storeCode = storeSelect.value;
    [...sectorSelect.options].forEach((option) => {
      const visible = !option.value || option.dataset.storeCode === storeCode;
      option.hidden = !visible;
      option.disabled = !visible;
    });
    if (sectorSelect.selectedOptions[0]?.disabled) sectorSelect.value = "";
    const target = (configuration.slaTargets || []).find((item) => item.store_code === storeCode && !item.sector_id) || {};
    const cost = (configuration.operatingCosts || []).find((item) => item.store_code === storeCode) || {};
    configForm.elements.targetWaitSeconds.value = target.target_wait_seconds ?? "";
    configForm.elements.targetServiceSeconds.value = target.target_service_seconds ?? "";
    configForm.elements.attendantHourlyCost.value = cost.attendant_hourly_cost ?? "";
  };
  storeSelect.addEventListener("change", updateStoreFields);
  updateStoreFields();
  sectorSelect.addEventListener("change", () => {
    const target = (configuration.slaTargets || []).find((item) => item.store_code === storeSelect.value && item.sector_id === sectorSelect.value) || {};
    configForm.elements.targetWaitSeconds.value = target.target_wait_seconds ?? "";
    configForm.elements.targetServiceSeconds.value = target.target_service_seconds ?? "";
  });
  configForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(configForm);
    const payload = { storeCode: form.get("storeCode"), sectorId: form.get("sectorId") || null };
    if (form.get("targetWaitSeconds") || form.get("targetServiceSeconds")) {
      payload.sla = {
        targetWaitSeconds: form.get("targetWaitSeconds") || null,
        targetServiceSeconds: form.get("targetServiceSeconds") || null
      };
    }
    if (form.get("attendantHourlyCost")) payload.attendantHourlyCost = form.get("attendantHourlyCost");
    const message = configForm.querySelector("[data-manager-form-message]");
    const button = configForm.querySelector("button[type=submit]");
    button.disabled = true;
    if (message) message.textContent = "Salvando…";
    try {
      await api("/api/manager/configuration", { method: "PUT", body: payload });
      await refreshDashboard();
    } catch (error) {
      if (message) message.textContent = error.message || "Não foi possível salvar.";
      button.disabled = false;
    }
  });
}
