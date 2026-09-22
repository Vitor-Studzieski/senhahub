(function initializeTvContentManager() {
  const form = document.querySelector("#tvMediaUploadForm");
  const fileInput = document.querySelector("#tvMediaFile");
  const titleInput = document.querySelector("#tvMediaTitle");
  const orientationInput = document.querySelector("#tvMediaOrientation");
  const durationInput = document.querySelector("#tvMediaDuration");
  const feedback = document.querySelector("#tvMediaUploadFeedback");
  const progress = document.querySelector("#tvMediaProgress");
  const library = document.querySelector("#tvMediaLibrary");
  const status = document.querySelector("#tvMediaLibraryStatus");

  document.querySelector("#logoutButton")?.addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } finally { window.location.href = "/login"; }
  });
  document.querySelector("#tvMediaRefresh")?.addEventListener("click", loadLibrary);
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file && !titleInput.value.trim()) titleInput.value = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    if (file && file.type.startsWith("video/")) durationInput.value = "30";
  });
  form?.addEventListener("submit", uploadMedia);
  library?.addEventListener("click", handleLibraryClick);
  loadLibrary();

  async function loadLibrary() {
    try {
      const payload = await api("/api/tv/media?manage=1");
      renderLibrary(Array.isArray(payload.items) ? payload.items : []);
    } catch (error) {
      if (library) library.innerHTML = `<p class="manager-empty">${escapeHtml(error.message)}</p>`;
      if (status) status.textContent = "Não foi possível carregar a biblioteca.";
    }
  }

  function renderLibrary(items) {
    if (status) status.textContent = `${items.length} ${items.length === 1 ? "conteúdo cadastrado" : "conteúdos cadastrados"}`;
    if (!library) return;
    if (!items.length) {
      library.innerHTML = `<p class="manager-empty">Nenhum conteúdo cadastrado. Envie o primeiro arquivo acima.</p>`;
      return;
    }
    library.innerHTML = items.map((item) => `
      <article class="tv-media-library-item ${item.active ? "is-active" : "is-inactive"}" data-media-id="${escapeHtml(item.id)}">
        <div class="tv-media-thumb">${item.type === "image" ? `<img src="${escapeHtml(item.src)}" alt="" loading="lazy" />` : `<video src="${escapeHtml(item.src)}" muted preload="metadata"></video>`}</div>
        <div class="tv-media-library-fields">
          <label>Título<input data-field="title" value="${escapeHtml(item.title)}" maxlength="120" /></label>
          <div class="tv-media-form-row">
            <label>Ordem<input data-field="order" type="number" min="0" value="${Number(item.order) || 0}" /></label>
            <label>Duração (s)<input data-field="duration" type="number" min="5" max="3600" value="${Number(item.durationSeconds) || 30}" /></label>
          </div>
          <small>${item.type === "image" ? "Imagem" : "Vídeo"} · ${formatBytes(item.fileSize)} · ${item.uploadStatus === "ready" ? "enviado" : "upload pendente"}</small>
        </div>
        <div class="tv-media-library-actions">
          <button class="manager-button" data-action="save" type="button">Salvar</button>
          <button class="manager-button secondary" data-action="toggle" type="button">${item.active ? "Desativar" : "Ativar"}</button>
          <button class="manager-button danger" data-action="delete" type="button">Excluir</button>
        </div>
      </article>
    `).join("");
  }

  async function uploadMedia(event) {
    event.preventDefault();
    const file = fileInput?.files?.[0];
    if (!file) return setFeedback("Selecione um arquivo.", true);
    setFeedback("Preparando o upload…", false);
    setProgress(8);
    try {
      const intent = await api("/api/tv/media/upload-intent", {
        method: "POST",
        body: {
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          title: titleInput.value,
          orientation: orientationInput.value,
          durationSeconds: Number(durationInput.value)
        }
      });
      setFeedback("Enviando arquivo…", false);
      setProgress(25);
      const upload = await fetch(intent.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type, "x-upsert": "false", "cache-control": "3600" },
        body: file
      });
      if (!upload.ok) {
        if (upload.status === 413) throw new Error("O plano atual do Supabase bloqueou este arquivo por tamanho. Use um arquivo menor ou aumente o limite do projeto.");
        throw new Error("O Storage não aceitou o arquivo.");
      }
      setProgress(82);
      if (file.type.startsWith("video/")) setFeedback("Convertendo para o formato compatível com a TV…", false);
      await api(`/api/tv/media/${encodeURIComponent(intent.item.id)}/complete`, { method: "POST", body: { active: true } });
      setProgress(100);
      setFeedback("Conteúdo publicado. A TV atualizará a programação automaticamente.", false);
      form.reset();
      durationInput.value = "10";
      await loadLibrary();
    } catch (error) {
      setFeedback(error.message || "Não foi possível enviar o arquivo.", true);
    } finally {
      window.setTimeout(() => { if (progress) progress.hidden = true; }, 900);
    }
  }

  async function handleLibraryClick(event) {
    const button = event.target.closest("button[data-action]");
    const card = event.target.closest("[data-media-id]");
    if (!button || !card) return;
    const id = card.dataset.mediaId;
    const action = button.dataset.action;
    try {
      if (action === "delete") {
        if (!window.confirm("Excluir este conteúdo e o arquivo do Storage?")) return;
        await api(`/api/tv/media/${encodeURIComponent(id)}`, { method: "DELETE" });
      } else if (action === "toggle") {
        await api(`/api/tv/media/${encodeURIComponent(id)}`, { method: "PATCH", body: { active: button.textContent.includes("Ativar") } });
      } else if (action === "save") {
        await api(`/api/tv/media/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: {
            title: card.querySelector('[data-field="title"]').value,
            sortOrder: Number(card.querySelector('[data-field="order"]').value),
            durationSeconds: Number(card.querySelector('[data-field="duration"]').value)
          }
        });
      }
      await loadLibrary();
    } catch (error) {
      window.alert(error.message || "Não foi possível atualizar este conteúdo.");
    }
  }

  function setFeedback(message, isError) {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.dataset.state = isError ? "error" : "success";
  }

  function setProgress(value) {
    if (!progress) return;
    progress.hidden = false;
    progress.querySelector("span").style.width = `${Math.max(0, Math.min(100, value))}%`;
  }

  async function api(url, options = {}) {
    const method = options.method || "GET";
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json", ...(method === "GET" ? {} : { "content-type": "application/json" }), ...csrfHeader() },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      throw new Error("Login necessário.");
    }
    if (!response.ok || payload.error) throw new Error(payload.error || "Falha na operação.");
    return payload;
  }

  function csrfHeader() {
    const token = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("senhahub_csrf="))?.split("=")[1];
    return token ? { "x-csrf-token": decodeURIComponent(token) } : {};
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (!bytes) return "tamanho não informado";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  }
})();
