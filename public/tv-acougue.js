(function initializeButcherDisplay() {
  const POLL_INTERVAL_MS = 5000;
  const WEATHER_REFRESH_MS = 25 * 60 * 1000;
  const PLAYLIST_REFRESH_MS = 5 * 60 * 1000;
  const WAITING_STATUSES = new Set(["aguardando", "proximo", "espera_inteligente", "standby"]);
  const WEATHER_CONFIG = {
    city: "Pompéia, SP",
  };
  const WEATHER_CODES = {
    0: { label: "Céu limpo" },
    1: { label: "Predominantemente limpo" },
    2: { label: "Parcialmente nublado" },
    3: { label: "Nublado" },
    45: { label: "Neblina" },
    48: { label: "Neblina congelante" },
    51: { label: "Garoa leve" },
    53: { label: "Garoa" },
    55: { label: "Garoa forte" },
    56: { label: "Garoa congelante" },
    57: { label: "Garoa congelante forte" },
    61: { label: "Chuva leve" },
    63: { label: "Chuva" },
    65: { label: "Chuva forte" },
    66: { label: "Chuva congelante" },
    67: { label: "Chuva congelante forte" },
    71: { label: "Neve leve" },
    73: { label: "Neve" },
    75: { label: "Neve forte" },
    77: { label: "Granizo" },
    80: { label: "Pancadas de chuva" },
    81: { label: "Pancadas de chuva" },
    82: { label: "Pancadas fortes" },
    85: { label: "Pancadas de neve" },
    86: { label: "Pancadas de neve fortes" },
    95: { label: "Trovoada" },
    96: { label: "Trovoada com granizo" },
    99: { label: "Trovoada forte" }
  };
  const state = {
    lastCall: "",
    userRole: "",
    sectorId: "",
    actionInFlight: false,
    timer: null,
    requestInFlight: false,
    weatherTimer: null,
    playlistTimer: null,
    playlist: [],
    playlistSignature: "",
    currentVideoIndex: -1,
    failedVideos: new Set(),
    videoErrorHandled: false,
    mediaAdvanceTimer: null
  };
  const elements = {
    clock: document.querySelector("#tvClock"),
    date: document.querySelector("#tvDate"),
    weather: document.querySelector("#tvWeather"),
    weatherTemperature: document.querySelector("#tvWeatherTemperature"),
    weatherCondition: document.querySelector("#tvWeatherCondition"),
    queueTitle: document.querySelector("#tvQueueTitle"),
    queueSubtitle: document.querySelector("#tvQueueSubtitle"),
    waitingSubtitle: document.querySelector("#tvWaitingSubtitle"),
    recentCalls: document.querySelector("#tvRecentCalls"),
    waitingCount: document.querySelector("#tvWaitingCount"),
    waitingTickets: document.querySelector("#tvWaitingTickets"),
    currentCall: document.querySelector("#tvCurrentCall"),
    currentStatus: document.querySelector("#tvCurrentStatus"),
    currentTicket: document.querySelector("#tvCurrentTicket"),
    currentCustomer: document.querySelector("#tvCurrentCustomer"),
    callControlsStatus: document.querySelector("#tvCallControlsStatus"),
    callActionButtons: [...document.querySelectorAll("[data-tv-call-action]")],
    feedback: document.querySelector("#tvFeedback"),
    videoStage: document.querySelector("#tvVideoStage"),
    video: document.querySelector("#tvPlaylistVideo"),
    videoPlaceholder: document.querySelector("#tvVideoPlaceholder"),
    videoLabel: document.querySelector("#tvVideoLabel"),
    videoCounter: document.querySelector("#tvVideoCounter"),
    playlistList: document.querySelector("#tvPlaylistList"),
    playlistStatus: document.querySelector("#tvPlaylistStatus"),
    mediaFeedback: document.querySelector("#tvMediaFeedback")
  };

  updateClock();
  loadWeather();
  loadPlaylist();
  if (elements.video) {
    elements.video.addEventListener("ended", playNextVideo);
    elements.video.addEventListener("error", handleVideoError);
    elements.video.addEventListener("loadeddata", handleVideoReady);
  }
  elements.callActionButtons.forEach((button) => {
    button.addEventListener("click", () => executeCallAction(button.dataset.tvCallAction));
  });
  window.setInterval(updateClock, 1000);
  loadSession();
  loadState();
  state.timer = window.setInterval(loadState, POLL_INTERVAL_MS);
  state.weatherTimer = window.setInterval(loadWeather, WEATHER_REFRESH_MS);
  state.playlistTimer = window.setInterval(loadPlaylist, PLAYLIST_REFRESH_MS);
  window.addEventListener("online", loadState);

  async function loadState() {
    if (state.requestInFlight) return;
    state.requestInFlight = true;
    try {
      const payload = await api("/api/display/state");
      const sector = payload.sectors?.[0];
      if (!sector) throw new Error("A fila deste atendimento ainda não está disponível.");
      state.sectorId = sector.id || "acougue";
      updateCallControls();
      renderQueue(sector);
      if (elements.feedback) elements.feedback.textContent = "";
    } catch (error) {
      if (elements.feedback) elements.feedback.textContent = error.message || "Não foi possível atualizar a fila.";
    } finally {
      state.requestInFlight = false;
    }
  }

  async function loadSession() {
    try {
      const payload = await api("/api/auth/me");
      state.userRole = String(payload.user?.role || "").toLowerCase();
    } catch {
      state.userRole = "";
    }
    updateCallControls();
  }

  function updateCallControls() {
    const canControl = ["attendant", "manager", "admin"].includes(state.userRole);
    elements.callActionButtons.forEach((button) => {
      button.disabled = !canControl || !state.sectorId || state.actionInFlight;
      button.setAttribute("aria-disabled", String(button.disabled));
    });
    if (!elements.callControlsStatus) return;
    if (state.actionInFlight) {
      elements.callControlsStatus.textContent = "Processando chamada...";
    } else if (canControl) {
      elements.callControlsStatus.textContent = "Ações liberadas para este colaborador";
    } else {
      elements.callControlsStatus.textContent = "Entre como colaborador para usar";
    }
  }

  async function executeCallAction(action) {
    if (!["previous", "again", "next"].includes(action) || state.actionInFlight) return;
    if (!["attendant", "manager", "admin"].includes(state.userRole)) {
      if (elements.feedback) elements.feedback.textContent = "Somente colaboradores podem controlar as chamadas.";
      return;
    }
    state.actionInFlight = true;
    updateCallControls();
    const labels = {
      previous: "Senha anterior chamada.",
      again: "Senha chamada novamente.",
      next: "Próxima senha chamada."
    };
    try {
      const result = await api(`/api/sectors/${encodeURIComponent(state.sectorId)}/call-control`, {
        method: "POST",
        body: { action }
      });
      await loadState();
      if (elements.feedback) elements.feedback.textContent = result.ticket ? labels[action] : (result.message || "Nenhuma senha disponível para esta ação.");
    } catch (error) {
      if (elements.feedback) elements.feedback.textContent = error.message || "Não foi possível executar a chamada.";
    } finally {
      state.actionInFlight = false;
      updateCallControls();
    }
  }

  function renderQueue(sector) {
    const sectorLabel = displaySectorName(sector.name || sector.id);
    const storeLabel = storeName(sector.storeCode || sector.store_code || sector.name);
    const waiting = (sector.tickets || []).filter((ticket) => WAITING_STATUSES.has(ticket.status));
    const recentCalls = [...(sector.recentCalls || [])]
      .filter((call) => call.ticket || call.ticketNumber)
      .slice(0, 4);
    const activeTickets = (sector.tickets || []).filter((ticket) => ["chamado", "em_atendimento"].includes(ticket.status));
    const active = activeTickets.find((ticket) => ticket.ticket === recentCalls[0]?.ticket) || activeTickets[0];
    const currentTicket = recentCalls[0]?.ticket || active?.ticket || (recentCalls.length ? sector.current : "--");
    const latestCall = recentCalls[0]?.ticket || "";
    const changed = Boolean(latestCall && latestCall !== state.lastCall);

    if (changed) {
      state.lastCall = latestCall;
      elements.currentCall?.classList.remove("tv-call-arrived");
    }
    if (elements.queueTitle) elements.queueTitle.textContent = sectorLabel;
    if (elements.queueSubtitle) elements.queueSubtitle.textContent = `${storeLabel} · Senhas em tempo real`;
    if (elements.waitingSubtitle) elements.waitingSubtitle.textContent = `Próximas senhas de ${sectorLabel.toLowerCase()}`;
    elements.waitingCount.textContent = String(waiting.length).padStart(2, "0");
    elements.currentTicket.textContent = formatTicket(currentTicket, sector.prefix);
    elements.currentStatus.textContent = active ? (active.status === "em_atendimento" ? "Em atendimento" : "Dirija-se ao balcão") : "Aguardando próxima chamada";
    elements.currentCustomer.textContent = active?.currentCustomerName || sector.currentCustomerName || (active ? "Atenção, sua senha foi chamada" : "Confira o painel para acompanhar sua vez");
    elements.currentCall.dataset.state = active ? "active" : "idle";
    elements.recentCalls.innerHTML = recentCalls.length ? recentCalls.map((call, index) => callRow(call, sector, index === 0)).join("") : emptyRow("Nenhuma chamada recente");
    elements.waitingTickets.innerHTML = waiting.length ? waiting.slice(0, 5).map((ticket) => waitingRow(ticket, sector)).join("") : emptyRow("Nenhuma senha aguardando");
  }

  function callRow(call, sector, latest) {
    const ticket = formatTicket(call.ticket || call.ticketNumber, sector.prefix);
    const time = call.createdAt ? new Date(call.createdAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : "--:--";
    return `<div class="tv-call-row ${latest ? "is-latest" : ""}"><span class="tv-call-sector">${escapeHtml(displaySectorName(sector.name || sector.id).toUpperCase())}</span><strong>${escapeHtml(ticket)}</strong><time>${time}</time></div>`;
  }

  function waitingRow(ticket, sector) {
    const position = Number(ticket.position) > 0 ? `${ticket.position}º` : "--";
    return `<div class="tv-waiting-row"><strong>${escapeHtml(formatTicket(ticket.ticket || ticket.ticketNumber, sector.prefix))}</strong><span>${escapeHtml(position)} na fila</span></div>`;
  }

  function updateClock() {
    const now = new Date();
    if (elements.clock) elements.clock.textContent = now.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    if (elements.date) elements.date.textContent = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long", year: "numeric" });
  }

  async function loadWeather() {
    try {
      const response = await fetch("/api/weather", {
        cache: "no-store",
        headers: { accept: "application/json" }
      });
      const payload = await response.json().catch(() => ({}));
      const current = payload.current;
      if (!response.ok || !current || !Number.isFinite(Number(current.temperature_2m))) throw new Error("Clima indisponível");
      renderWeather(current, false);
    } catch {
      renderWeather(null, true);
    }
  }

  function renderWeather(current, fallback) {
    const description = WEATHER_CODES[Number(current?.weather_code)] || { label: "Condição não informada" };
    if (elements.weather) elements.weather.dataset.state = fallback ? "offline" : "online";
    if (elements.weatherTemperature) elements.weatherTemperature.textContent = current ? `${Math.round(Number(current.temperature_2m))}°C` : "--°C";
    if (elements.weatherCondition) elements.weatherCondition.textContent = current ? `${description.label} · ${WEATHER_CONFIG.city}` : "Clima indisponível";
  }

  async function loadPlaylist() {
    try {
      const response = await fetch("/data/tv-playlist.json", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.items)) throw new Error("Playlist indisponível");
      const playlist = payload.items
        .filter((item) => item && item.active !== false && typeof item.src === "string" && item.src.trim())
        .map((item, index) => ({
          id: String(item.id || `video-${index + 1}`),
          title: String(item.title || `Vídeo ${index + 1}`).trim(),
          src: item.src.trim(),
          videoUrl: typeof item.videoUrl === "string" ? item.videoUrl.trim() : "",
          type: item.type === "instagram" || isInstagramUrl(item.src) ? "instagram" : "video",
          orientation: item.orientation === "portrait" ? "portrait" : "landscape",
          order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
          durationSeconds: Math.max(15, Number(item.durationSeconds) || 30)
        }))
        .sort((left, right) => left.order - right.order);
      const signature = playlist.map((item) => `${item.id}|${item.src}|${item.videoUrl}|${item.type}|${item.orientation}|${item.order}|${item.title}|${item.durationSeconds}`).join("||");
      if (signature === state.playlistSignature) return;
      state.playlistSignature = signature;
      state.playlist = playlist;
      state.failedVideos.clear();
      state.currentVideoIndex = -1;
      renderPlaylist();
      if (playlist.length) playNextVideo();
      else showEmptyPlaylist("Aguardando materiais");
    } catch {
      if (!state.playlist.length) showEmptyPlaylist("Playlist indisponível");
    }
  }

  function renderPlaylist() {
    if (!elements.playlistList) return;
    if (!state.playlist.length) {
      showEmptyPlaylist("Aguardando materiais");
      return;
    }
    elements.playlistList.innerHTML = state.playlist.map((item, index) => `
      <div class="tv-playlist-item" data-video-id="${escapeHtml(item.id)}">
        <span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.title)}</strong><small>${item.type === "instagram" ? "Instagram" : (item.orientation === "portrait" ? "Vertical" : "Horizontal")}</small>
      </div>
    `).join("");
    if (elements.playlistStatus) elements.playlistStatus.textContent = `${state.playlist.length} ${state.playlist.length === 1 ? "vídeo ativo" : "vídeos ativos"}`;
  }

  function playNextVideo() {
    if (!state.playlist.length) {
      showEmptyPlaylist("Aguardando materiais");
      return;
    }
    const nextIndex = findNextVideoIndex();
    if (nextIndex < 0) {
      showEmptyPlaylist("Nenhum vídeo pôde ser reproduzido");
      if (elements.mediaFeedback) elements.mediaFeedback.textContent = "Verifique os arquivos da playlist.";
      return;
    }
    state.currentVideoIndex = nextIndex;
    const item = state.playlist[nextIndex];
    state.videoErrorHandled = false;
    if (state.mediaAdvanceTimer) window.clearTimeout(state.mediaAdvanceTimer);
    if (elements.videoStage) {
      elements.videoStage.dataset.state = "loading";
      elements.videoStage.dataset.orientation = item.orientation;
      elements.videoStage.dataset.mediaType = item.type;
    }
    if (elements.videoPlaceholder) elements.videoPlaceholder.hidden = true;
    if (elements.videoLabel) elements.videoLabel.textContent = item.title;
    if (elements.videoCounter) elements.videoCounter.textContent = `${nextIndex + 1}/${state.playlist.length}`;
    document.querySelectorAll(".tv-playlist-item").forEach((row) => row.classList.toggle("is-active", row.dataset.videoId === item.id));
    const isInstagram = item.type === "instagram";
    if (elements.video) {
      elements.video.hidden = false;
      elements.video.pause();
      elements.video.removeAttribute("src");
      elements.video.load();
    }
    if (isInstagram) {
      resolveVideoSource(item)
        .then((source) => {
          if (state.playlist[state.currentVideoIndex] !== item || !elements.video) return;
          elements.video.src = source;
          elements.video.load();
          startVideoPlayback(item);
          state.mediaAdvanceTimer = window.setTimeout(playNextVideo, item.durationSeconds * 1000);
        })
        .catch(handleVideoError);
      return;
    }
    if (!elements.video) return;
    elements.video.hidden = false;
    elements.video.src = item.src;
    elements.video.load();
    startVideoPlayback(item);
  }

  function findNextVideoIndex() {
    for (let step = 1; step <= state.playlist.length; step += 1) {
      const index = (state.currentVideoIndex + step) % state.playlist.length;
      if (!state.failedVideos.has(state.playlist[index].id)) return index;
    }
    return -1;
  }

  function handleVideoError() {
    if (state.videoErrorHandled || state.currentVideoIndex < 0) return;
    state.videoErrorHandled = true;
    const item = state.playlist[state.currentVideoIndex];
    if (item) state.failedVideos.add(item.id);
    if (elements.mediaFeedback) elements.mediaFeedback.textContent = `Não foi possível reproduzir “${item?.title || "este vídeo"}”.`;
    window.setTimeout(playNextVideo, 250);
  }

  function handleVideoReady() {
    if (state.playlist[state.currentVideoIndex] && elements.videoStage) elements.videoStage.dataset.state = "playing";
  }

  function startVideoPlayback(item) {
    if (!elements.video) return;
    const playRequest = elements.video.play();
    if (playRequest?.catch) {
      playRequest.catch(() => {
        if (state.playlist[state.currentVideoIndex] === item && elements.videoStage) elements.videoStage.dataset.state = "playing";
      });
    }
  }

  function showEmptyPlaylist(status) {
    if (state.mediaAdvanceTimer) window.clearTimeout(state.mediaAdvanceTimer);
    if (elements.videoStage) elements.videoStage.dataset.state = "empty";
    if (elements.video) {
      elements.video.hidden = false;
      elements.video.pause();
      elements.video.removeAttribute("src");
      elements.video.load();
    }
    if (elements.videoPlaceholder) elements.videoPlaceholder.hidden = false;
    if (elements.playlistStatus) elements.playlistStatus.textContent = status;
    if (elements.playlistList && !state.playlist.length) elements.playlistList.innerHTML = `<div class="tv-playlist-empty">Adicione vídeos à playlist para iniciar a reprodução.</div>`;
  }

  function displaySectorName(value) {
    return String(value || "Atendimento").replace(/\s+-\s+Loja\s+[12]$/i, "").trim() || "Atendimento";
  }

  function storeName(value) {
    const match = String(value || "").match(/loja[- ]?([12])/i);
    return match ? `Loja ${match[1]}` : "Loja Pompeia";
  }

  function isInstagramUrl(value) {
    return /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\//i.test(String(value || "").trim());
  }

  async function resolveVideoSource(item) {
    if (item.videoUrl) return item.videoUrl;
    return `/api/instagram/video?url=${encodeURIComponent(item.src)}`;
  }

  async function api(url, options = {}) {
    const method = options.method || "GET";
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(method === "GET" ? {} : { "content-type": "application/json" }),
        ...csrfHeader()
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      throw new Error("Login necessário.");
    }
    if (!response.ok || payload.error) throw new Error(payload.error || "Falha ao consultar a fila.");
    return payload;
  }

  function csrfHeader() {
    const token = document.cookie
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith("senhahub_csrf="))
      ?.split("=")[1];
    return token ? { "x-csrf-token": decodeURIComponent(token) } : {};
  }

  function formatTicket(value, prefix = "A") {
    const source = String(value || "--");
    if (source === "--") return source;
    if (/^[A-Z]+\d+$/i.test(source)) return source;
    return `${prefix || "A"}${source.replace(/\D/g, "").padStart(3, "0")}`;
  }

  function emptyRow(message) {
    return `<div class="tv-empty-row">${escapeHtml(message)}</div>`;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  }
})();
