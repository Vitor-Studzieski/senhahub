(function initializeTracking() {
  const SUCCESS_MESSAGE_MS = 5000;
  const token = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");
  const AUTO_RETURN_SECONDS = 12;
  const loading = document.querySelector("#trackingLoading");
  const content = document.querySelector("#trackingContent");
  const scanSuccess = document.querySelector("#trackingScanSuccess");
  const feedback = document.querySelector("#trackingFeedback");
  const feedbackIcon = document.querySelector("#trackingFeedbackIcon");
  const feedbackEyebrow = document.querySelector("#trackingFeedbackEyebrow");
  const feedbackTitle = document.querySelector("#trackingFeedbackTitle");
  const feedbackMessage = document.querySelector("#trackingFeedbackMessage");
  const retryButton = document.querySelector("#trackingRetry");
  const autoReturn = document.querySelector("#trackingAutoReturn");
  const vibration = document.querySelector("#trackingVibration");
  const vibrationMessage = document.querySelector("#trackingVibrationMessage");
  const vibrationButton = document.querySelector("#trackingVibrationButton");
  const callAlert = document.querySelector("#trackingCallAlert");
  const callAlertMessage = document.querySelector("#trackingCallAlertMessage");
  const singleView = document.querySelector("#trackingSingleView");
  const ticketsList = document.querySelector("#trackingTicketsList");
  let timer = null;
  let autoReturnTimer = null;
  let autoReturnRemaining = 0;
  let successTimer = null;
  let retryInFlight = false;
  let currentTickets = [];
  let vibrationReady = window.Notification?.permission === "granted";

  vibrationButton?.addEventListener("click", () => {
    enableTrackingAlerts();
  });

  updateVibrationControl();

  const FEEDBACK_STATES = {
    invalid: {
      icon: "!",
      eyebrow: "Leitura não reconhecida",
      title: "QR Code inválido",
      message: "Este código não é válido para acompanhar uma senha. Peça um novo QR Code ou tente ler novamente."
    },
    expired: {
      icon: "⌛",
      eyebrow: "O tempo de leitura terminou",
      title: "QR Code expirado",
      message: "Este código ficou disponível por tempo limitado. Solicite uma nova senha para receber outro QR Code."
    },
    used: {
      icon: "✓",
      eyebrow: "Leitura concluída",
      title: "QR Code já utilizado",
      message: "Esta senha já foi concluída e este QR Code não pode mais ser usado."
    },
    communication: {
      icon: "↻",
      eyebrow: "Não foi possível consultar",
      title: "Erro de comunicação",
      message: "Verifique sua conexão e tente novamente. Se o problema continuar, volte ao início."
    }
  };

  retryButton?.addEventListener("click", retryLoad);

  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    showFeedback("invalid");
  } else {
    loadTicket();
  }

  async function loadTicket() {
    clearTimeout(timer);
    try {
      const response = await fetch(`/api/tickets/track/${encodeURIComponent(token)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      const tickets = Array.isArray(payload.tickets) && payload.tickets.length
        ? payload.tickets
        : (payload.ticket ? [payload.ticket] : []);
      if (!response.ok || payload.error || !tickets.length) {
        const error = new Error(payload.error || "Senha não encontrada.");
        error.code = payload.code || payload.errorCode || inferErrorCode(response.status, payload.error);
        error.status = response.status;
        throw error;
      }
      if (isAlreadyUsed(payload, tickets)) {
        showFeedback("used");
        return;
      }
      render(tickets);
      notifyTicketAlerts(tickets);
      if (tickets.some((ticket) => !isFinished(ticket))) timer = setTimeout(loadTicket, 5000);
    } catch (error) {
      showFeedback(errorState(error));
    }
  }

  function showLoading() {
    clearTimeout(successTimer);
    clearAutoReturn();
    loading.hidden = false;
    content.hidden = true;
    feedback.hidden = true;
    scanSuccess.hidden = true;
    if (retryButton) retryButton.disabled = false;
  }

  function render(tickets) {
    const shouldAnnounceSuccess = content.hidden;
    currentTickets = tickets.filter(Boolean);
    clearAutoReturn();

    if (currentTickets.length && currentTickets.every((ticket) => ticket.status === "atendido")) {
      showFeedback("used");
      return;
    }
    if (currentTickets.length && currentTickets.every((ticket) => ticket.status === "expirado")) {
      showFeedback("expired");
      return;
    }

    loading.hidden = true;
    feedback.hidden = true;
    content.hidden = false;
    if (shouldAnnounceSuccess) showScanSuccess();
    if (currentTickets.length > 1) {
      singleView.hidden = true;
      ticketsList.hidden = false;
      ticketsList.innerHTML = [
        ...currentTickets.map(renderBundleTicket),
        '<p class="tracking-message tracking-bundle-message">Obrigado por usar o SenhaHub.</p>'
      ].join("");
      return;
    }
    singleView.hidden = false;
    ticketsList.hidden = true;
    ticketsList.innerHTML = "";
    renderSingle(currentTickets[0]);
  }

  async function enableTrackingAlerts() {
    const result = await window.SenhaHubVibration?.enable?.();
    vibrationReady = Boolean(result?.vibrated || result?.permission === "granted");
    updateVibrationControl();
    if (vibrationReady) notifyTicketAlerts(currentTickets);
  }

  function notifyTicketAlerts(tickets) {
    if (!window.SenhaHubVibration) return;
    tickets.filter((ticket) => ["chamado", "em_atendimento"].includes(ticket?.status)).forEach((ticket) => {
      const callIdentity = ticket.calledAt || `${ticket.ticket || "ticket"}:${ticket.status}`;
      const result = window.SenhaHubVibration.signalOnce?.(`${token}:${callIdentity}`)
        || { reason: "unsupported" };
      if (["ok", "duplicate"].includes(result.reason)) {
        vibrationReady = true;
        updateVibrationControl();
      }
      void window.SenhaHubVibration.notifyOnce(`${token}:${callIdentity}`, {
        title: `${ticket.ticket || "Sua senha"} foi chamada`,
        body: `Dirija-se ao ${ticket.counterLabel || "balcão"} do setor ${ticket.sector || "de atendimento"}.`
      }).then((notification) => {
        if (["ok", "duplicate"].includes(notification.reason)) {
          vibrationReady = true;
          updateVibrationControl();
        }
      });
    });

    tickets.filter((ticket) => {
      const ahead = Number(ticket?.ahead);
      return !["chamado", "em_atendimento", "atendido", "cancelado", "expirado"].includes(ticket?.status)
        && Number.isFinite(ahead)
        && ahead > 0
        && ahead <= 3;
    }).forEach((ticket) => {
      const ahead = Math.max(1, Math.round(Number(ticket.ahead)));
      const nearIdentity = `${token}:near-three:${ticket.ticket || "ticket"}`;
      const message = `Faltam ${ahead} ${ahead === 1 ? "senha" : "senhas"} para o seu atendimento.`;
      window.SenhaHubVibration.signalOnce?.(nearIdentity);
      void window.SenhaHubVibration.notifyOnce(nearIdentity, {
        title: "Seu atendimento está próximo",
        body: message
      });
      showQueueAlert(message);
    });
  }

  function showQueueAlert(message) {
    if (!callAlert || !callAlertMessage) return;
    callAlert.hidden = false;
    callAlert.dataset.state = "near";
    callAlert.querySelector("strong").textContent = "Seu atendimento está próximo";
    callAlertMessage.textContent = message;
  }

  function updateVibrationControl() {
    const canVibrate = Boolean(window.SenhaHubVibration?.supported());
    const canNotify = typeof window.Notification !== "undefined";
    if (!vibration || (!canVibrate && !canNotify)) return;
    vibration.hidden = false;
    if (vibrationReady) {
      vibrationMessage.textContent = canVibrate
        ? "Alerta e vibração ativados neste dispositivo."
        : "Alertas ativados neste dispositivo. Este navegador não oferece vibração web.";
      vibrationButton.hidden = true;
      return;
    }
    vibrationMessage.textContent = canVibrate
      ? "Ative uma vez para receber alerta e vibração neste dispositivo."
      : "Ative uma vez para receber alerta neste dispositivo.";
    vibrationButton.hidden = false;
  }

  function renderSingle(ticket) {
    document.querySelector("#trackingCurrent").textContent = ticket.current || "--";
    document.querySelector("#trackingTicket").textContent = ticket.ticket || "--";
    document.querySelector("#trackingSector").textContent = ticket.sector || "Setor";
    document.querySelector("#trackingPriority").hidden = !ticket.priority;
    document.querySelector("#trackingStatus").textContent = statusLabel(ticket.status);
    document.querySelector("#trackingStatusDot").dataset.state = statusTone(ticket.status);
    document.querySelector("#trackingMessage").textContent = trackingMessage(ticket);
    document.querySelector("#trackingUpdated").textContent = updatedLabel();
    const isCalled = ["chamado", "em_atendimento"].includes(ticket.status);
    if (callAlert && isCalled) {
      callAlert.dataset.state = "called";
      callAlert.querySelector("strong").textContent = "Sua senha foi chamada";
    }
    if (callAlert && !isCalled && Number(ticket.ahead) > 3) callAlert.hidden = true;
    if (callAlertMessage && isCalled) {
      callAlertMessage.textContent = ticket.counterLabel
        ? `Dirija-se ao ${ticket.counterLabel}.`
        : "Dirija-se ao balcão.";
    }
  }

  function renderBundleTicket(ticket) {
    const priority = ticket.priority
      ? '<span class="tracking-badge">Atendimento preferencial</span>'
      : "";
    return `
      <article class="tracking-bundle-ticket">
        <div class="tracking-bundle-sector"><span>Setor</span><h2>${escapeHtml(ticket.sector || "Setor")}</h2></div>
        ${priority}
        <div class="tracking-ticket-overview">
          <div class="tracking-ticket-panel tracking-ticket-current">
            <span>Senha atual</span>
            <strong>${escapeHtml(ticket.current || "--")}</strong>
          </div>
          <div class="tracking-ticket-panel tracking-ticket-yours">
            <span>Sua senha</span>
            <strong>${escapeHtml(ticket.ticket || "--")}</strong>
          </div>
        </div>
        <div class="tracking-status">
          <span class="tracking-status-dot" data-state="${statusTone(ticket.status)}" aria-hidden="true"></span>
          <div><strong>${escapeHtml(statusLabel(ticket.status))}</strong><span class="tracking-status-message">${escapeHtml(trackingMessage(ticket))}</span></div>
        </div>
      </article>`;
  }

  function trackingMessage(ticket) {
    if (ticket.status === "chamado") return `Sua senha foi chamada. Dirija-se ao ${ticket.counterLabel || "balcão"}.`;
    if (ticket.status === "em_atendimento") return "Seu atendimento está acontecendo agora.";
    if (ticket.status === "atendido") return "Atendimento concluído. Obrigado por usar o SenhaHub.";
    if (ticket.status === "cancelado" || ticket.status === "expirado") return "Esta senha não está mais ativa.";
    if (Number(ticket.ahead) === 0) return "Você é o próximo. Fique atento ao chamado.";
    return "Você será avisado quando estiver próximo do atendimento.";
  }

  function statusLabel(status) {
    return {
      aguardando: "Aguardando",
      proximo: "Você é o próximo",
      chamado: "Senha chamada",
      em_atendimento: "Em atendimento",
      atendido: "Atendimento concluído",
      cancelado: "Senha cancelada",
      expirado: "Senha expirada",
      standby: "Aguardando retorno",
      espera_inteligente: "Espera inteligente"
    }[status] || "Aguardando";
  }

  function statusTone(status) {
    if (["chamado", "em_atendimento"].includes(status)) return "attention";
    if (["atendido", "cancelado", "expirado"].includes(status)) return "done";
    return "waiting";
  }

  function updatedLabel() {
    return `Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  }

  function isFinished(ticket) {
    return ["atendido", "cancelado", "expirado"].includes(ticket?.status);
  }

  function errorState(error) {
    const code = String(error?.code || "").toUpperCase();
    if (code.includes("EXPIRED") || code.includes("EXPIR") || /expirad/i.test(error?.message || "")) return "expired";
    if (code.includes("USED") || code.includes("UTILIZ") || code.includes("USAD") || error?.status === 409 || /já foi utilizado|ja foi utilizado/i.test(error?.message || "")) return "used";
    if (code.includes("COMMUNICATION") || error?.name === "TypeError" || Number(error?.status) === 408 || Number(error?.status) === 429) return "communication";
    if (Number(error?.status) >= 500) return "communication";
    return "invalid";
  }

  function inferErrorCode(status, message) {
    if (/expirad/i.test(message || "")) return "QR_CODE_EXPIRED";
    if (/já foi utilizado|ja foi utilizado|já foi usado|ja foi usado/i.test(message || "")) return "QR_CODE_USED";
    if (status >= 500 || status === 429) return "COMMUNICATION_ERROR";
    return "QR_CODE_INVALID";
  }

  function isAlreadyUsed(payload, tickets) {
    const code = String(payload?.code || payload?.errorCode || payload?.reason || "").toUpperCase();
    return code.includes("USED")
      || code.includes("UTILIZ")
      || code.includes("USAD")
      || payload?.alreadyUsed === true
      || tickets.length > 0 && tickets.every((ticket) => Boolean(ticket?.alreadyUsed || ticket?.qrUsed || ticket?.qrStatus === "used"));
  }

  function showScanSuccess() {
    clearTimeout(successTimer);
    scanSuccess.hidden = false;
    successTimer = setTimeout(() => {
      scanSuccess.hidden = true;
    }, SUCCESS_MESSAGE_MS);
  }

  function showFeedback(type) {
    const state = FEEDBACK_STATES[type] || FEEDBACK_STATES.invalid;
    clearTimeout(timer);
    clearTimeout(successTimer);
    scanSuccess.hidden = true;
    loading.hidden = true;
    content.hidden = true;
    feedback.hidden = false;
    feedback.dataset.state = type;
    feedbackIcon.textContent = state.icon;
    feedbackEyebrow.textContent = state.eyebrow;
    feedbackTitle.textContent = state.title;
    feedbackMessage.textContent = state.message;
    retryButton.textContent = "Tentar novamente";
    retryButton.disabled = false;
    autoReturnRemaining = AUTO_RETURN_SECONDS;
    autoReturn.hidden = false;
    clearInterval(autoReturnTimer);
    autoReturnTimer = setInterval(() => {
      autoReturnRemaining -= 1;
      updateAutoReturn();
      if (autoReturnRemaining <= 0) goHome();
    }, 1000);
    updateAutoReturn();
    feedback.focus({ preventScroll: true });
  }

  function updateAutoReturn() {
    autoReturn.textContent = `Voltando ao início em ${autoReturnRemaining}s. Tente novamente se preferir.`;
  }

  function clearAutoReturn() {
    clearInterval(autoReturnTimer);
    autoReturnTimer = null;
    if (autoReturn) autoReturn.hidden = true;
  }

  async function retryLoad() {
    if (retryInFlight) return;
    retryInFlight = true;
    retryButton.disabled = true;
    retryButton.textContent = "Tentando...";
    try {
      showLoading();
      await loadTicket();
    } finally {
      retryInFlight = false;
      if (!feedback.hidden) retryButton.disabled = false;
    }
  }

  function goHome() {
    window.location.assign("/");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
