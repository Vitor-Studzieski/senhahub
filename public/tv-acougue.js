(function initializeButcherDisplay() {
  const POLL_INTERVAL_MS = 5000;
  const CALL_ALERT_DURATION_MS = 7000;
  const CALL_ALERT_SOUND_INTERVAL_MS = 360;
  const CALL_ALERT_SOUND_PULSE_MS = 260;
  const CALL_ALERT_SOUND_GAIN = 1.25;
  const AUTISM_QUEUE_HALF_VOLUME_THRESHOLD = 5;
  const AUTISM_MINIMUM_VOLUME = 0.1;
  const WEATHER_REFRESH_MS = 25 * 60 * 1000;
  const PLAYLIST_REFRESH_MS = 5 * 60 * 1000;
  const PITCHDAY_TV_EMAIL = "pitchday.tv@superpompeia.com";
  let IS_PITCHDAY = false;
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
    lastCallSignature: "",
    manuallyAnnouncedCalls: new Set(),
    userRole: "",
    userId: "",
    tvDisplayAccess: false,
    sectorId: "",
    actionInFlight: false,
    lastRemoteActionAt: 0,
    callAlertTimer: null,
    audioContext: null,
    callAlertAudioStopTimer: null,
    callAlertAudioNodes: [],
    callAlertAudioMaster: null,
    autisticQueueCount: 0,
    hasAvailableTicket: false,
    timer: null,
    requestInFlight: false,
    weatherTimer: null,
    playlistTimer: null,
    playlist: [],
    playlistSignature: "",
    currentVideoIndex: -1,
    failedVideos: new Set(),
    videoErrorHandled: false,
    mediaAdvanceTimer: null,
    mediaBackdropTimer: null
  };
  const elements = {
    clock: document.querySelector("#tvClock"),
    date: document.querySelector("#tvDate"),
    weather: document.querySelector("#tvWeather"),
    weatherTemperature: document.querySelector("#tvWeatherTemperature"),
    weatherCondition: document.querySelector("#tvWeatherCondition"),
    connection: document.querySelector("#tvConnection"),
    queueTitle: document.querySelector("#tvQueueTitle"),
    recentCalls: document.querySelector("#tvRecentCalls"),
    currentTicket: document.querySelector("#tvCurrentTicket"),
    currentTicketCard: document.querySelector(".tv-current-ticket-card"),
    currentStatus: document.querySelector("#tvCurrentStatus"),
    callAlert: document.querySelector("#tvCallAlert"),
    callAlertTicket: document.querySelector("#tvCallAlertTicket"),
    callAlertSector: document.querySelector("#tvCallAlertSector"),
    callControlsStatus: document.querySelector("#tvCallControlsStatus"),
    callActionButtons: [...document.querySelectorAll("[data-tv-call-action]")],
    feedback: document.querySelector("#tvFeedback"),
    videoStage: document.querySelector("#tvVideoStage"),
    videoBackdrop: document.querySelector("#tvVideoBackdrop"),
    video: document.querySelector("#tvPlaylistVideo"),
    image: document.querySelector("#tvPlaylistImage"),
    videoPlaceholder: document.querySelector("#tvVideoPlaceholder"),
    videoLabel: document.querySelector("#tvVideoLabel"),
    videoCounter: document.querySelector("#tvVideoCounter"),
    playlistList: document.querySelector("#tvPlaylistList"),
    playlistStatus: document.querySelector("#tvPlaylistStatus"),
    mediaFeedback: document.querySelector("#tvMediaFeedback")
  };
  const sessionReady = loadSession();

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
  window.addEventListener("keydown", handlePresenterKeydown);
  window.setInterval(updateClock, 1000);
  loadState();
  state.timer = window.setInterval(loadState, POLL_INTERVAL_MS);
  state.weatherTimer = window.setInterval(loadWeather, WEATHER_REFRESH_MS);
  state.playlistTimer = window.setInterval(loadPlaylist, PLAYLIST_REFRESH_MS);
  window.addEventListener("online", loadState);
  window.addEventListener("offline", () => updateConnection("offline", "Offline"));

  async function loadState() {
    await sessionReady;
    if (state.requestInFlight) return;
    state.requestInFlight = true;
    try {
      const payload = await api("/api/display/state");
      const sector = payload.sectors?.[0];
      if (!sector) throw new Error("A fila deste atendimento ainda não está disponível.");
      state.sectorId = sector.id || "acougue";
      renderQueue(sector);
      updateCallControls();
      updateConnection("online", "Online");
      if (elements.feedback) elements.feedback.textContent = "";
    } catch (error) {
      updateConnection("offline", "Offline");
      if (elements.feedback) elements.feedback.textContent = error.message || "Não foi possível atualizar a fila.";
    } finally {
      state.requestInFlight = false;
    }
  }

  function updateConnection(status, label) {
    if (!elements.connection) return;
    elements.connection.dataset.state = status;
    const text = elements.connection.querySelector("b");
    if (text) text.textContent = label;
  }

  async function loadSession() {
    try {
      const payload = await api("/api/auth/me");
      const user = payload.user;
      state.userRole = String(payload.user?.role || "").toLowerCase();
      state.userId = String(payload.user?.id || "");
      state.tvDisplayAccess = payload.user?.tvDisplayAccess === true;
      IS_PITCHDAY = String(user?.email || "").trim().toLowerCase() === PITCHDAY_TV_EMAIL;
      if (IS_PITCHDAY) {
        document.querySelector("#tvScreen")?.classList.add("tv-pitchday");
        const queueEyebrow = document.querySelector(".tv-queue-heading p");
        if (queueEyebrow) queueEyebrow.textContent = "Pitchday · Atendimento";
      }
      if (state.tvDisplayAccess) document.querySelector("#tvScreen")?.classList.add("tv-dedicated-media");
    } catch {
      state.userRole = "";
      state.userId = "";
      state.tvDisplayAccess = false;
    }
    updateCallControls();
  }

  function updateCallControls() {
    const canControl = ["tv", "attendant", "manager", "admin"].includes(state.userRole);
    const nextButton = elements.callActionButtons.find((button) => button.dataset.tvCallAction === "next");
    const againButton = elements.callActionButtons.find((button) => button.dataset.tvCallAction === "again");
    if (againButton) againButton.hidden = IS_PITCHDAY;
    elements.callActionButtons.forEach((button) => {
      button.disabled = !canControl || !state.sectorId || state.actionInFlight;
      button.setAttribute("aria-disabled", String(button.disabled));
    });
    if (nextButton) {
      const isReady = canControl && state.hasAvailableTicket && !state.actionInFlight;
      nextButton.classList.toggle("is-ready", isReady);
      nextButton.dataset.state = isReady ? "ready" : "idle";
      nextButton.setAttribute("aria-label", isReady ? "Chamar próxima senha disponível" : "Chamar próxima senha");
    }
    if (!elements.callControlsStatus) return;
    if (state.actionInFlight) {
      elements.callControlsStatus.textContent = "Processando chamada...";
    } else if (canControl) {
      elements.callControlsStatus.textContent = state.userRole === "tv"
        ? "Ações liberadas para esta TV"
        : "Ações liberadas para este colaborador";
    } else {
      elements.callControlsStatus.textContent = "Entre como colaborador para usar";
    }
  }

  function handlePresenterKeydown(event) {
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target?.isContentEditable || event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;

    // Presentation remotes commonly report previous/next as arrows or page keys.
    const key = String(event.key || event.code || "").toLowerCase();
    const action = !IS_PITCHDAY && ["arrowup", "pageup"].includes(key)
      ? "previous"
      : ["arrowdown", "pagedown"].includes(key)
        ? "next"
        : "";
    if (!action || !["tv", "attendant", "manager", "admin"].includes(state.userRole) || !state.sectorId) return;

    event.preventDefault();
    const now = Date.now();
    if (state.actionInFlight || now - state.lastRemoteActionAt < 450) return;
    state.lastRemoteActionAt = now;
    void executeCallAction(action);
  }

  async function executeCallAction(action) {
    if (!["previous", "again", "next"].includes(action) || state.actionInFlight) return;
    if (IS_PITCHDAY && action !== "next") return;
    if (!["tv", "attendant", "manager", "admin"].includes(state.userRole)) {
      if (elements.feedback) elements.feedback.textContent = "Somente contas TV ou colaboradores podem controlar as chamadas.";
      return;
    }
    ensureCallAlertAudio();
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
      // A chamada originada na própria TV must show the alert immediately,
      // even if the next state poll has not received the new event yet.
      if (result.ticket && elements.callAlert?.hidden) {
        const ticket = result.ticket.ticket || result.ticket.code || result.ticket.ticketNumber;
        if (ticket) {
          if (IS_PITCHDAY) state.manuallyAnnouncedCalls.add(String(ticket));
          showCallAlert(
            { id: state.sectorId, name: elements.queueTitle?.textContent || "Açougue", prefix: String(ticket).match(/^[A-Z]+/i)?.[0] || "A" },
            { ...result.ticket, ticket, createdAt: result.ticket.calledAt || new Date().toISOString() },
            { autistic: isAutisticTicket(result.ticket) }
          );
        }
      }
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
    state.hasAvailableTicket = (sector.tickets || []).some((ticket) => ["aguardando", "proximo", "standby"].includes(ticket.status));
    state.autisticQueueCount = IS_PITCHDAY
      ? (sector.tickets || []).filter((ticket) =>
        ["aguardando", "proximo", "espera_inteligente", "standby"].includes(ticket.status)
        && isAutisticTicket(ticket)
      ).length
      : 0;
    const recentCalls = [...(sector.recentCalls || [])]
      .filter((call) => call.ticket || call.ticketNumber)
      .slice(0, 4);
    const latestCall = recentCalls.find((call) => call.action === "senha_chamada") || null;
    const latestCallTicket = String(latestCall?.ticket || latestCall?.ticketNumber || "");
    const activeTickets = (sector.tickets || []).filter((ticket) => ["chamado", "em_atendimento"].includes(ticket.status));
    const matchingActive = activeTickets.find((ticket) => (ticket.ticket || ticket.ticketNumber) === latestCallTicket) || null;
    const active = matchingActive
      || [...activeTickets].sort((left, right) => latestActivity(right) - latestActivity(left))[0]
      || null;
    const currentTicket = active?.ticket || active?.ticketNumber || latestCallTicket || (recentCalls.length ? sector.current : "--");
    const latestCallSignature = latestCall
      ? (IS_PITCHDAY ? latestCallTicket : `${latestCallTicket}|${latestCall.createdAt || ""}`)
      : "";
    const alreadyAnnouncedByAction = IS_PITCHDAY && state.manuallyAnnouncedCalls.delete(latestCallSignature);
    const changed = Boolean(
      latestCallSignature
      && state.lastCallSignature
      && latestCallSignature !== state.lastCallSignature
      && !alreadyAnnouncedByAction
    );
    const autisticCurrent = IS_PITCHDAY && isAutisticTicket(active);
    const autisticLatestCall = IS_PITCHDAY
      && (matchingActive ? isAutisticTicket(matchingActive) : isAutisticTicket(latestCall));

    if (latestCallSignature) state.lastCallSignature = latestCallSignature;
    if (elements.queueTitle) elements.queueTitle.textContent = sectorLabel;
    if (elements.currentTicket) elements.currentTicket.textContent = formatTicket(currentTicket, sector.prefix);
    elements.currentTicketCard?.classList.toggle("is-autistic-current", autisticCurrent);
    if (elements.currentStatus) elements.currentStatus.textContent = active
      ? (active.status === "em_atendimento" ? "Em atendimento" : "Dirija-se ao balcão")
      : "Aguardando próxima chamada";
    elements.recentCalls.innerHTML = recentCalls.length ? recentCalls.map((call, index) => callRow(call, sector, index === 0)).join("") : emptyRow("Nenhuma chamada recente");
    if (changed) showCallAlert(sector, latestCall, { autistic: autisticLatestCall });
  }

  function isAutisticTicket(ticket) {
    const reason = String(ticket?.priorityReason || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
    return reason === "tea" || reason.includes("autismo");
  }

  function callAlertVolumeScale() {
    if (state.autisticQueueCount >= AUTISM_QUEUE_HALF_VOLUME_THRESHOLD) return 0.5;
    if (state.autisticQueueCount > 0) return AUTISM_MINIMUM_VOLUME;
    return 1;
  }

  function latestActivity(ticket) {
    return new Date(ticket.serviceStartedAt || ticket.calledAt || ticket.updatedAt || ticket.createdAt || 0).getTime() || 0;
  }

  function showCallAlert(sector, call, options = {}) {
    if (!elements.callAlert || !call) return;
    const ticket = formatTicket(call.ticket || call.ticketNumber, sector.prefix);
    if (ticket === "--") return;
    if (state.callAlertTimer) window.clearTimeout(state.callAlertTimer);
    if (elements.callAlertTicket) elements.callAlertTicket.textContent = ticket;
    if (elements.callAlertSector) elements.callAlertSector.textContent = `${displaySectorName(sector.name || sector.id)} · Dirija-se ao balcão`;
    elements.callAlert.hidden = false;
    elements.callAlert.dataset.state = "active";
    const autisticCall = IS_PITCHDAY && (options.autistic === true || isAutisticTicket(call));
    elements.callAlert.dataset.autistic = autisticCall ? "true" : "false";
    if (autisticCall) stopCallAlertSound();
    else playCallAlertSound(callAlertVolumeScale());
    state.callAlertTimer = window.setTimeout(hideCallAlert, CALL_ALERT_DURATION_MS);
  }

  function hideCallAlert() {
    if (!elements.callAlert) return;
    stopCallAlertSound();
    elements.callAlert.hidden = true;
    elements.callAlert.dataset.state = "idle";
    state.callAlertTimer = null;
  }

  function playCallAlertSound(volumeScale = 1) {
    stopCallAlertSound();
    if (volumeScale <= 0) return;
    const context = ensureCallAlertAudio(volumeScale);
    if (!context) return;
    const startAlert = () => {
      const startAt = context.currentTime + 0.02;
      const endAt = startAt + CALL_ALERT_DURATION_MS / 1000;
      let pulseIndex = 0;

      for (let start = startAt; start < endAt; start += CALL_ALERT_SOUND_INTERVAL_MS / 1000) {
        const pulseEnd = Math.min(start + CALL_ALERT_SOUND_PULSE_MS / 1000, endAt);
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "square";
        oscillator.frequency.setValueAtTime(pulseIndex % 2 ? 880 : 660, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(CALL_ALERT_SOUND_GAIN, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, pulseEnd);
        oscillator.connect(gain);
        gain.connect(state.callAlertAudioMaster || context.destination);
        oscillator.start(start);
        oscillator.stop(pulseEnd + 0.01);
        state.callAlertAudioNodes.push(oscillator);
        pulseIndex += 1;
      }

      state.callAlertAudioStopTimer = window.setTimeout(stopCallAlertSound, CALL_ALERT_DURATION_MS + 150);
    };
    const resume = context.state === "suspended" ? context.resume() : Promise.resolve();
    resume.then(startAlert).catch(() => {});
  }

  function stopCallAlertSound() {
    if (state.callAlertAudioStopTimer) {
      window.clearTimeout(state.callAlertAudioStopTimer);
      state.callAlertAudioStopTimer = null;
    }
    state.callAlertAudioNodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        // O oscilador pode já ter terminado naturalmente.
      }
      try {
        node.disconnect();
      } catch {
        // O navegador pode já ter desconectado o nó.
      }
    });
    state.callAlertAudioNodes = [];
    if (state.callAlertAudioMaster) {
      try {
        state.callAlertAudioMaster.disconnect();
      } catch {
        // O contexto pode já ter sido encerrado pelo navegador.
      }
      state.callAlertAudioMaster = null;
    }
  }

  function ensureCallAlertAudio(volumeScale = 1) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    try {
      state.audioContext ||= new AudioContext();
      const context = state.audioContext;
      if (!state.callAlertAudioMaster) {
        const master = context.createGain();
        master.connect(context.destination);
        state.callAlertAudioMaster = master;
      }
      state.callAlertAudioMaster.gain.value = CALL_ALERT_SOUND_GAIN * volumeScale;
      if (context.state === "suspended") context.resume().catch(() => {});
      return context;
    } catch {
      // O navegador pode bloquear áudio sem interação; o destaque visual continua ativo.
      return null;
    }
  }

  function callRow(call, sector, latest) {
    const ticket = formatTicket(call.ticket || call.ticketNumber, sector.prefix);
    const time = call.createdAt ? new Date(call.createdAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : "--:--";
    return `<div class="tv-call-row ${latest ? "is-latest" : ""}"><span class="tv-call-sector">${escapeHtml(displaySectorName(sector.name || sector.id).toUpperCase())}</span><strong>${escapeHtml(ticket)}</strong><time>${time}</time></div>`;
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
      await sessionReady;
      let response = await fetch("/api/tv/media", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok && !state.tvDisplayAccess) {
        response = await fetch("/data/tv-playlist.json", { cache: "no-store" });
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.items)) throw new Error("Playlist indisponível");
      const visibleItems = state.tvDisplayAccess
        ? payload.items.filter((item) => String(item?.targetUserId || "") === state.userId)
        : payload.items;
      const playlist = visibleItems
        .filter((item) => item && item.active !== false && typeof item.src === "string" && item.src.trim())
        .map((item, index) => ({
          id: String(item.id || `video-${index + 1}`),
          title: String(item.title || `Vídeo ${index + 1}`).trim(),
          src: item.src.trim(),
          sourceKey: playlistSourceKey(item.src.trim()),
          videoUrl: typeof item.videoUrl === "string" ? item.videoUrl.trim() : "",
          type: item.type === "image" ? "image" : (item.type === "instagram" || isInstagramUrl(item.src) ? "instagram" : "video"),
          orientation: item.orientation === "portrait" ? "portrait" : "landscape",
          order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
          durationSeconds: Math.max(15, Number(item.durationSeconds) || 30)
        }))
        .sort((left, right) => left.order - right.order);
      const signature = playlist.map((item) => `${item.id}|${item.sourceKey}|${item.videoUrl}|${item.type}|${item.orientation}|${item.order}|${item.title}|${item.durationSeconds}`).join("||");
      if (signature === state.playlistSignature) {
        // Refresh short-lived stream URLs without replacing the objects used by
        // the current player and without restarting a video already in progress.
        state.playlist.forEach((currentItem) => {
          const freshItem = playlist.find((item) => item.id === currentItem.id);
          if (freshItem) currentItem.src = freshItem.src;
        });
        return;
      }
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
        <span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.title)}</strong><small>${item.type === "instagram" ? "Instagram" : item.type === "image" ? "Imagem" : (item.orientation === "portrait" ? "Vertical" : "Horizontal")}</small>
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
    stopMediaBackdrop();
    if (elements.videoStage) {
      elements.videoStage.dataset.state = "loading";
      elements.videoStage.dataset.orientation = item.orientation;
      elements.videoStage.dataset.mediaType = item.type;
    }
    if (elements.videoPlaceholder) elements.videoPlaceholder.hidden = true;
    if (elements.videoLabel) elements.videoLabel.textContent = item.title;
    if (elements.videoCounter) elements.videoCounter.textContent = `${nextIndex + 1}/${state.playlist.length}`;
    document.querySelectorAll(".tv-playlist-item").forEach((row) => row.classList.toggle("is-active", row.dataset.videoId === item.id));
    const isImage = item.type === "image";
    const isInstagram = item.type === "instagram";
    if (elements.image) {
      elements.image.hidden = !isImage;
      elements.image.removeAttribute("src");
    }
    if (elements.video) {
      elements.video.hidden = isImage;
      elements.video.pause();
      elements.video.removeAttribute("src");
      elements.video.load();
    }
    if (isImage) {
      if (!elements.image) return;
      elements.image.onload = () => {
        if (state.playlist[state.currentVideoIndex] !== item) return;
        if (item.orientation === "portrait") paintMediaBackdrop(elements.image);
        if (elements.videoStage) elements.videoStage.dataset.state = "playing";
        state.mediaAdvanceTimer = window.setTimeout(playNextVideo, item.durationSeconds * 1000);
      };
      elements.image.onerror = handleVideoError;
      elements.image.src = item.src;
      return;
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
    const item = state.playlist[state.currentVideoIndex];
    if (!item || !elements.videoStage) return;
    elements.videoStage.dataset.state = "playing";
    if (item.orientation !== "portrait" || !elements.videoBackdrop) return;
    paintMediaBackdrop(elements.video);
    if (!state.mediaBackdropTimer) {
      state.mediaBackdropTimer = window.setInterval(() => paintMediaBackdrop(elements.video), 250);
    }
  }

  function paintMediaBackdrop(media) {
    const canvas = elements.videoBackdrop;
    const width = media?.videoWidth || media?.naturalWidth;
    const height = media?.videoHeight || media?.naturalHeight;
    if (!canvas || !width || !height) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    try {
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      context.drawImage(media, 0, 0, width, height);
      canvas.hidden = false;
    } catch {
      canvas.hidden = true;
    }
  }

  function stopMediaBackdrop() {
    if (state.mediaBackdropTimer) window.clearInterval(state.mediaBackdropTimer);
    state.mediaBackdropTimer = null;
    if (elements.videoBackdrop) elements.videoBackdrop.hidden = true;
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
    stopMediaBackdrop();
    if (elements.videoStage) elements.videoStage.dataset.state = "empty";
    if (elements.image) {
      elements.image.hidden = true;
      elements.image.removeAttribute("src");
    }
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

  function isInstagramUrl(value) {
    return /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv)\//i.test(String(value || "").trim());
  }

  function playlistSourceKey(value) {
    try {
      const source = new URL(value, window.location.origin);
      if (source.pathname.startsWith("/api/tv/media/") && source.pathname.endsWith("/stream")) {
        source.searchParams.delete("token");
      }
      return `${source.pathname}${source.search}${source.hash}`;
    } catch {
      return value;
    }
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
