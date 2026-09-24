function bindLoginUi() {
window.senhaHubAuthSecurityReady = initializeAuthSecurity();

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#loginError");
  const submit = form.querySelector(".yellow-action");
  error.textContent = "";
  setSubmitting(submit, true);

  try {
    await window.senhaHubAuthSecurityReady;
    const result = await api("/api/auth/login", {
      method: "POST",
      body: formValues(form)
    });
    resetCaptcha(form);
    if (result.mfaRequired) {
      showMfaChallenge(result);
      return;
    }
    const next = new URLSearchParams(location.search).get("next");
    location.href = allowedNextForRole(result.user.role, next);
  } catch (exception) {
    resetCaptcha(form);
    error.textContent = exception.message;
    showLoginToast(exception.message);
  } finally {
    setSubmitting(submit, false);
  }
});

document.querySelector("#mfaForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#mfaError");
  const submit = form.querySelector(".yellow-action");
  const code = String(new FormData(form).get("code") || "").replace(/\D/g, "");
  error.textContent = "";
  if (!/^\d{6}$/.test(code)) {
    error.textContent = "Informe o código válido do aplicativo autenticador.";
    return;
  }
  setSubmitting(submit, true);
  try {
    const result = await api("/api/auth/mfa/verify", {
      method: "POST",
      body: { code }
    });
    const next = new URLSearchParams(location.search).get("next");
    location.href = allowedNextForRole(result.user.role, next);
  } catch (exception) {
    error.textContent = exception.message;
  } finally {
    setSubmitting(submit, false);
  }
});

document.querySelector("#cancelMfa").addEventListener("click", async () => {
  try {
    await api("/api/auth/mfa/cancel", { method: "POST", body: {} });
  } catch {
    // O cookie temporário expira rapidamente mesmo se o cancelamento falhar.
  }
  document.querySelector("#mfaCode").value = "";
  activatePanel("login");
});

document.querySelector("#passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#passwordError");
  const submit = form.querySelector(".yellow-action");
  error.textContent = "";
  setSubmitting(submit, true);

  try {
    await window.senhaHubAuthSecurityReady;
    const result = await api("/api/auth/change-password", {
      method: "POST",
      body: formValues(form)
    });
    resetCaptcha(form);
    form.reset();
    showLoginToast(result.message || "Senha alterada com sucesso.");
    activatePanel("login");
  } catch (exception) {
    resetCaptcha(form);
    error.textContent = exception.message;
    showLoginToast(exception.message);
  } finally {
    setSubmitting(submit, false);
  }
});

document.querySelector("#recoverForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#recoverError");
  const submit = form.querySelector(".yellow-action");
  error.textContent = "";
  setSubmitting(submit, true);

  try {
    await window.senhaHubAuthSecurityReady;
    const result = await api("/api/auth/forgot-password", {
      method: "POST",
      body: formValues(form)
    });
    resetCaptcha(form);
    form.reset();
    showLoginToast(result.message || "Confira seu e-mail para continuar.");
  } catch (exception) {
    resetCaptcha(form);
    error.textContent = exception.message;
    showLoginToast(exception.message);
  } finally {
    setSubmitting(submit, false);
  }
});

document.querySelector("#resetForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#resetError");
  const data = formValues(form);
  const submit = form.querySelector(".yellow-action");
  error.textContent = "";

  if (data.newPassword !== data.confirmPassword) {
    error.textContent = "As senhas precisam ser iguais.";
    showLoginToast(error.textContent);
    return;
  }
  if (!isStrongPassword(data.newPassword)) {
    error.textContent = "Use ao menos 12 caracteres, letras maiusculas, minusculas e numeros. Evite senhas comuns.";
    showLoginToast(error.textContent);
    return;
  }

  setSubmitting(submit, true);
  try {
    const result = await api("/api/auth/reset-password", {
      method: "POST",
      body: { accessToken: recoveryAccessToken(), newPassword: data.newPassword }
    });
    form.reset();
    history.replaceState({}, document.title, `${location.pathname}${location.search}`);
    showLoginToast(result.message || "Senha redefinida com sucesso.");
    activatePanel("login");
  } catch (exception) {
    error.textContent = exception.message;
    showLoginToast(exception.message);
  } finally {
    setSubmitting(submit, false);
  }
});

document.querySelector("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#registerError");
  const submit = form.querySelector(".yellow-action");
  const data = formValues(form);
  error.textContent = "";

  if (data.password !== data.confirmPassword) {
    error.textContent = "As senhas precisam ser iguais.";
    showLoginToast(error.textContent);
    return;
  }
  if (!isStrongPassword(data.password)) {
    error.textContent = "Use ao menos 12 caracteres, letras maiusculas, minusculas e numeros. Evite senhas comuns.";
    showLoginToast(error.textContent);
    return;
  }

  setSubmitting(submit, true);
  try {
    await window.senhaHubAuthSecurityReady;
    const result = await api("/api/auth/register", {
      method: "POST",
      body: {
        name: data.name,
        email: data.email,
        password: data.password,
        captchaToken: data.captchaToken
      }
    });
    resetCaptcha(form);
    form.reset();
    showLoginToast(result.message || "Conta criada com sucesso. Entre usando seu e-mail e senha.");
    activatePanel("login");
  } catch (exception) {
    resetCaptcha(form);
    error.textContent = exception.message;
    showLoginToast(exception.message);
  } finally {
    setSubmitting(submit, false);
  }
});

document.querySelectorAll("[data-login-panel]").forEach((button) => {
  button.addEventListener("click", () => activatePanel(button.dataset.loginPanel));
});

if (recoveryAccessToken()) activatePanel("reset");

document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = button.parentElement?.querySelector("input");
    if (!input) return;
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    button.textContent = visible ? "Ver" : "Ocultar";
    button.setAttribute("aria-label", visible ? "Mostrar senha" : "Ocultar senha");
  });
});
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindLoginUi, { once: true });
} else {
  bindLoginUi();
}

function formValues(form) {
  const values = {};
  for (let index = 0; index < form.elements.length; index += 1) {
    const field = form.elements[index];
    if (field.name && !field.disabled) values[field.name] = field.value;
  }
  return values;
}

function activatePanel(panel) {
  document.querySelectorAll("[data-login-panel]").forEach((button) => {
    button.classList.toggle("active", button.dataset.loginPanel === panel);
  });
  document.querySelectorAll(".login-panel").forEach((form) => {
    form.classList.toggle("active", form.id === `${panel}Form`);
  });
  document.querySelectorAll(".login-error").forEach((error) => {
    error.textContent = "";
  });
}

function recoveryAccessToken() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  return hash.get("access_token") || new URLSearchParams(location.search).get("access_token") || "";
}

function isStrongPassword(value) {
  return typeof value === "string"
    && value.length >= 12
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /\d/.test(value);
}

function showLoginToast(message) {
  const toast = document.querySelector("#loginToast");
  if (!toast) {
    alert(message);
    return;
  }
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showLoginToast.timer);
  showLoginToast.timer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 4200);
}

function setSubmitting(button, submitting) {
  if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
  button.disabled = submitting;
  button.textContent = submitting ? "Aguarde..." : button.dataset.defaultText;
}

async function initializeAuthSecurity() {
  try {
    const config = await api("/api/auth/config");
    if (config.captcha?.enabled) await initializeTurnstile(config.captcha.siteKey);
  } catch {
    document.querySelectorAll("[data-captcha-widget]").forEach((widget) => {
      widget.hidden = false;
      widget.querySelector(".captcha-status").textContent = "Não foi possível carregar a verificação de segurança. Atualize a página e tente novamente.";
    });
  }
}

function initializeTurnstile(siteKey) {
  if (!siteKey) throw new Error("CAPTCHA sem chave pública.");
  document.querySelectorAll("[data-captcha-widget]").forEach((widget) => {
    widget.hidden = false;
    widget.dataset.enabled = "true";
    widget.querySelector(".captcha-status").textContent = "Carregando verificação de segurança…";
  });

  return new Promise((resolve, reject) => {
    window.senhaHubTurnstileReady = () => {
      try {
        document.querySelectorAll("[data-captcha-widget]").forEach((widget) => {
          const slot = widget.querySelector(".captcha-slot");
          const tokenInput = widget.querySelector('input[name="captchaToken"]');
          widget.dataset.widgetId = window.turnstile.render(slot, {
            sitekey: siteKey,
            callback(token) {
              tokenInput.value = token;
              widget.querySelector(".captcha-status").textContent = "Verificação concluída.";
            },
            "expired-callback"() {
              tokenInput.value = "";
              widget.querySelector(".captcha-status").textContent = "A verificação expirou. Confirme novamente.";
            },
            "error-callback"() {
              tokenInput.value = "";
              widget.querySelector(".captcha-status").textContent = "Não foi possível concluir a verificação. Tente novamente.";
            }
          });
          widget.closest("form")?.addEventListener("submit", (event) => {
            if (!tokenInput.value) {
              event.preventDefault();
              const error = widget.closest("form").querySelector(".login-error");
              if (error) error.textContent = "Conclua a verificação de segurança para continuar.";
            }
          }, true);
          widget.querySelector(".captcha-status").textContent = "Conclua a verificação de segurança.";
        });
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=senhaHubTurnstileReady&render=explicit";
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Não foi possível carregar o CAPTCHA."));
    document.head.appendChild(script);
  });
}

function resetCaptcha(form) {
  const widget = form?.querySelector("[data-captcha-widget]");
  const tokenInput = widget?.querySelector('input[name="captchaToken"]');
  if (!widget?.dataset.widgetId || !window.turnstile) return;
  if (tokenInput) tokenInput.value = "";
  window.turnstile.reset(widget.dataset.widgetId);
  widget.querySelector(".captcha-status").textContent = "Conclua a verificação de segurança.";
}

function showMfaChallenge(result) {
  const enrollment = document.querySelector("#mfaEnrollment");
  const qrCode = document.querySelector("#mfaQrCode");
  const secret = document.querySelector("#mfaSecret");
  const instructions = document.querySelector("#mfaInstructions");
  const isEnrollment = result.mfaMode === "enrollment";
  enrollment.hidden = !isEnrollment;
  qrCode.removeAttribute("src");
  secret.textContent = "";
  if (isEnrollment) {
    if (result.qrCode) qrCode.src = result.qrCode;
    secret.textContent = result.secret || "";
    instructions.textContent = "Configure o aplicativo autenticador com o QR code ou a chave abaixo e informe o código gerado.";
  } else {
    instructions.textContent = "Informe o código atual do seu aplicativo autenticador.";
  }
  document.querySelector("#mfaCode").value = "";
  activatePanel("mfa");
  document.querySelector("#mfaCode").focus();
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
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
      cache: "no-store"
    });
    const payload = await parseApiPayload(response);
    window.senhaHubPwa?.reportNetworkSuccess();
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

function allowedNextForRole(role, next) {
  const home = {
    customer: "/",
    attendant: "/attendant",
    manager: "/",
    admin: "/",
    tablet: "/tablet",
    tv: "/tv/acougue",
    marketing: "/marketing/conteudos-tv"
  }[role] || "/";
  const normalizedRole = role === "admin" ? "manager" : role;
  if (!next) return home;
  if (normalizedRole === "manager" && ["/", "/totem"].includes(next)) return next;
  if (role === "attendant" && ["/attendant", "/tablet"].includes(next)) return next;
  if (role === "customer" && next === "/") return next;
  if (role === "tablet" && next === "/tablet") return next;
  if (role === "tv" && next === "/tv/acougue") return next;
  if (role === "marketing" && next === "/marketing/conteudos-tv") return next;
  return home;
}
