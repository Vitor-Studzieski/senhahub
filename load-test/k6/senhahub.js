import http from "k6/http";
import { check, fail, sleep } from "k6";
import exec from "k6/execution";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = String(__ENV.BASE_URL || "").replace(/\/+$/, "");
const STAGING_URL = String(__ENV.STAGING_URL || "").replace(/\/+$/, "");
const RUN_ID = String(__ENV.LOAD_TEST_RUN_ID || "");
const TARGET_ENV = String(__ENV.TARGET_ENV || "");
const MODE = String(__ENV.MODE || "main");
const FLOW = String(__ENV.FLOW || "customer");
const REQUEST_TIMEOUT = __ENV.REQUEST_TIMEOUT || "10s";
const POLL_SECONDS = Number(__ENV.POLL_SECONDS || 20);
const TV_REFRESH_SECONDS = Number(__ENV.TV_REFRESH_SECONDS || 5);
const MANAGER_REFRESH_SECONDS = Number(__ENV.MANAGER_REFRESH_SECONDS || 30);
const SESSION_SECONDS = Number(__ENV.SESSION_SECONDS || (MODE === "smoke" ? 180 : 120));
const REQUESTS = new Counter("senhahub_requests");
const SUCCESSES = new Rate("senhahub_success_rate");
const STATUS_4XX = new Counter("senhahub_status_4xx");
const STATUS_5XX = new Counter("senhahub_status_5xx");
const STATUS_429 = new Counter("senhahub_status_429");
const TIMEOUTS = new Counter("senhahub_timeouts");
const SESSIONS = new Counter("senhahub_sessions");
const TICKETS = new Counter("senhahub_tickets_created");
const SSE_RECONNECTS = new Counter("senhahub_sse_reconnects");
const ROUTE_LATENCY = new Trend("senhahub_route_latency", true);
let requestSequence = 0;
let roleSessionReady = false;
let lastBackgroundActionAt = 0;
let peakCustomerCreated = false;
let rolePageLoaded = false;
let managerUsersLoaded = false;
let lastTvWeatherAt = 0;
let lastTvPlaylistAt = 0;

const commonThresholds = {
  http_req_failed: ["rate<0.01"],
  senhahub_success_rate: ["rate>0.99"],
  senhahub_status_5xx: ["count==0"],
  senhahub_status_429: ["count==0"],
  senhahub_timeouts: ["count==0"],
  "senhahub_route_latency{class:critical}": ["p(95)<1500"],
  "senhahub_route_latency{class:simple}": ["p(95)<1000"]
};

function scenarioForCustomer() {
  if (MODE === "smoke") {
    return {
      customer_smoke: {
        executor: "per-vu-iterations",
        vus: 5,
        iterations: 1,
        maxDuration: "4m",
        gracefulStop: "5s"
      }
    };
  }
  if (MODE === "peak") {
    return {
      customer_peak: {
        executor: "ramping-vus",
        startVUs: 0,
        stages: [
          { duration: "5m", target: 200 },
          { duration: "12m", target: 200 },
          { duration: "5m", target: 0 }
        ],
        gracefulRampDown: "30s",
        gracefulStop: "30s"
      }
    };
  }
  if (MODE !== "main") throw new Error("MODE deve ser smoke, main ou peak.");
  return {
    customer_main: {
      executor: "constant-arrival-rate",
      rate: 200,
      timeUnit: "1h",
      duration: "1h",
      preAllocatedVUs: 12,
      maxVUs: 40,
      gracefulStop: "30s"
    }
  };
}

function scenarioForBackground() {
  if (!["tv", "attendant", "manager", "kiosk"].includes(FLOW)) {
    throw new Error("FLOW deve ser customer, tv, attendant, manager ou kiosk.");
  }
  if (MODE !== "background") throw new Error("Use MODE=background para os fluxos de dispositivo/equipe.");
  return {
    [`${FLOW}_background`]: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 1),
      duration: __ENV.DURATION || "1h",
      gracefulStop: "15s"
    }
  };
}

export const options = {
  scenarios: FLOW === "customer" ? scenarioForCustomer() : scenarioForBackground(),
  thresholds: commonThresholds
};

export function setup() {
  validateConfiguration();
  const response = http.get(`${BASE_URL}/api/ready`, {
    headers: { "X-Load-Test-Run-Id": RUN_ID },
    timeout: REQUEST_TIMEOUT,
    tags: { route: "readiness", flow: FLOW }
  });
  if (response.status !== 200 || jsonBody(response).backend !== "supabase") {
    throw new Error(`Readiness recusada (HTTP ${response.status}); confirme que esta URL aponta para o staging isolado usando Supabase.`);
  }
  return { ready: true };
}

function validateConfiguration() {
  if (!BASE_URL || !/^https:\/\//i.test(BASE_URL)) {
    throw new Error("Defina BASE_URL para a URL HTTPS do ambiente de homologação.");
  }
  if (!STAGING_URL || BASE_URL !== STAGING_URL || new URL(BASE_URL).hostname.toLowerCase() === "senhahub.vercel.app") {
    throw new Error("Execução bloqueada: BASE_URL precisa corresponder exatamente à STAGING_URL confirmada e não pode usar o domínio público de produção.");
  }
  if (TARGET_ENV !== "staging" || __ENV.CONFIRM_STAGING_TARGET !== "yes") {
    throw new Error("Execução bloqueada: defina TARGET_ENV=staging e CONFIRM_STAGING_TARGET=yes após validar o ambiente isolado.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(RUN_ID)) {
    throw new Error("LOAD_TEST_RUN_ID é obrigatório e deve ser um identificador sem espaços.");
  }
  if (!/^[A-Za-z0-9_-]{2,80}$/.test(String(__ENV.SECTOR_ID || ""))) {
    throw new Error("Defina SECTOR_ID com um setor exclusivo de teste.");
  }
  if (FLOW === "customer") {
    if (!String(__ENV.CUSTOMER_EMAIL_TEMPLATE || "").includes("{n}") || !__ENV.CUSTOMER_EMAIL_DOMAIN || !__ENV.CUSTOMER_PASSWORD) {
      throw new Error("Configure CUSTOMER_EMAIL_TEMPLATE (com {n}), CUSTOMER_EMAIL_DOMAIN e CUSTOMER_PASSWORD para as contas sintéticas pré-criadas.");
    }
  } else if (FLOW === "kiosk") {
    if (!__ENV.KIOSK_COOKIE || __ENV.ENABLE_KIOSK_ISSUANCE !== "yes" || __ENV.CONFIRM_PRINT_AGENT_DISABLED !== "yes") {
      throw new Error("Totem bloqueado: configure KIOSK_COOKIE e confirme ENABLE_KIOSK_ISSUANCE=yes e CONFIRM_PRINT_AGENT_DISABLED=yes somente no staging isolado.");
    }
  } else {
    const prefix = FLOW.toUpperCase();
    if (!__ENV[`${prefix}_EMAIL`] || !__ENV[`${prefix}_PASSWORD`]) {
      throw new Error(`Configure ${prefix}_EMAIL e ${prefix}_PASSWORD para uma conta exclusiva de homologação.`);
    }
  }
}

function actorIdForCustomer(index) {
  return `customer-${String(index).padStart(3, "0")}`;
}

function customerAccount(index) {
  const localPart = String(__ENV.CUSTOMER_EMAIL_TEMPLATE).replaceAll("{n}", String(index).padStart(3, "0"));
  return `${localPart}@${__ENV.CUSTOMER_EMAIL_DOMAIN}`;
}

function routeClass(route) {
  return ["auth_login", "sessions_create", "ticket_create", "ticket_call", "ticket_finish"].includes(route)
    ? "critical"
    : "simple";
}

function request(method, path, body, route, actorId) {
  requestSequence += 1;
  const url = `${BASE_URL}${path}`;
  const headers = {
    accept: "application/json",
    "X-Load-Test-Run-Id": RUN_ID,
    "X-Load-Test-User-Id": actorId,
    "X-Request-Id": `${RUN_ID.slice(0, 36)}:${actorId.slice(0, 36)}:${requestSequence}`
  };
  if (FLOW === "kiosk") {
    headers.cookie = __ENV.KIOSK_COOKIE;
    const kioskCsrf = String(__ENV.KIOSK_COOKIE).split(";").map((item) => item.trim())
      .find((item) => item.startsWith("senhahub_kiosk_csrf="))?.slice("senhahub_kiosk_csrf=".length);
    if (kioskCsrf && !["GET", "HEAD"].includes(method)) headers["x-kiosk-csrf"] = decodeURIComponent(kioskCsrf);
  }
  if (body !== undefined) headers["content-type"] = "application/json";
  const csrf = http.cookieJar().cookiesForURL(BASE_URL).senhahub_csrf?.[0];
  if (csrf && !["GET", "HEAD"].includes(method)) headers["x-csrf-token"] = csrf;

  const startedAt = Date.now();
  const response = http.request(method, url, body === undefined ? null : JSON.stringify(body), {
    headers,
    timeout: REQUEST_TIMEOUT,
    tags: { route, flow: FLOW },
    redirects: 0
  });
  const duration = Date.now() - startedAt;
  const tags = { route, class: routeClass(route), flow: FLOW };
  REQUESTS.add(1, tags);
  ROUTE_LATENCY.add(duration, tags);
  SUCCESSES.add(response.status >= 200 && response.status < 400, { route, flow: FLOW });
  if (response.status >= 400 && response.status < 500) STATUS_4XX.add(1, { route, flow: FLOW });
  if (response.status >= 500) STATUS_5XX.add(1, { route, flow: FLOW });
  if (response.status === 429) STATUS_429.add(1, { route, flow: FLOW });
  if (response.status === 0 || /timeout|deadline/i.test(String(response.error || ""))) TIMEOUTS.add(1, { route, flow: FLOW });
  check(response, {
    [`${route}: returned HTTP response`]: (res) => res.status > 0,
    [`${route}: no server error or rate limit`]: (res) => res.status < 500 && res.status !== 429
  });
  return response;
}

function jsonBody(response) {
  try {
    return response.json();
  } catch {
    return {};
  }
}

function assertStatus(response, allowed, label) {
  if (!allowed.includes(response.status)) {
    fail(`${label} retornou HTTP ${response.status}; confira o resumo k6 e os logs do ambiente de teste.`);
  }
}

function login(email, password, actorId) {
  const page = request("GET", "/login", undefined, "page_login", actorId);
  assertStatus(page, [200], "GET /login");
  const response = request("POST", "/api/auth/login", { email, password }, "auth_login", actorId);
  assertStatus(response, [200], "POST /api/auth/login");
  const payload = jsonBody(response);
  if (!payload.user?.id) fail("O login não retornou um usuário autenticado.");
  const csrf = http.cookieJar().cookiesForURL(BASE_URL).senhahub_csrf?.[0];
  if (!csrf) fail("O login não criou o cookie CSRF esperado.");
  return payload.user;
}

function getAuthenticatedUser(actorId) {
  const response = request("GET", "/api/auth/me", undefined, "auth_me", actorId);
  assertStatus(response, [200], "GET /api/auth/me");
  const user = jsonBody(response).user;
  if (!user?.id) fail("A sessão autenticada não foi reconhecida.");
  return user;
}

function startCustomerSession(index) {
  const actorId = actorIdForCustomer(index);
  const user = login(customerAccount(index), __ENV.CUSTOMER_PASSWORD, actorId);
  const appPage = request("GET", "/", undefined, "page_customer", actorId);
  assertStatus(appPage, [200], "GET /");
  const authenticatedUser = getAuthenticatedUser(actorId);
  const identity = {
    customerId: authenticatedUser.customerId || authenticatedUser.id,
    deviceId: `load-${RUN_ID}-${String(index).padStart(3, "0")}`
  };
  const session = request("POST", "/api/sessions", identity, "sessions_create", actorId);
  assertStatus(session, [200], "POST /api/sessions");
  SESSIONS.add(1, { flow: FLOW });
  const initialState = request("GET", `/api/state?customer_id=${encodeURIComponent(identity.customerId)}`, undefined, "customer_state", actorId);
  assertStatus(initialState, [200], "GET /api/state");
  const ticketResponse = request("POST", "/api/tickets", {
    ...identity,
    sectorId: __ENV.SECTOR_ID,
    load_test_run_id: RUN_ID
  }, "ticket_create", actorId);
  assertStatus(ticketResponse, [200, 201], "POST /api/tickets");
  const ticket = jsonBody(ticketResponse).ticket;
  if (!ticket?.id) fail("A emissão não retornou uma senha identificável.");
  TICKETS.add(1, { flow: FLOW });
  return { actorId, identity, ticketId: ticket.id };
}

function customerIndex() {
  if (MODE === "peak") return exec.vu.idInTest;
  return exec.scenario.iterationInTest + 1;
}

function customerFlow() {
  validateConfiguration();
  if (MODE === "peak") {
    if (!peakCustomerCreated) {
      const session = startCustomerSession(customerIndex());
      roleSessionReady = true;
      peakCustomerCreated = true;
      sleep(POLL_SECONDS);
      return session;
    }
    if (!roleSessionReady) fail("Estado interno da sessão de pico inválido.");
    const actorId = actorIdForCustomer(customerIndex());
    const state = request("GET", "/api/state", undefined, "customer_state", actorId);
    assertStatus(state, [200], "GET /api/state");
    sleep(POLL_SECONDS);
    return;
  }

  const session = startCustomerSession(customerIndex());
  const deadline = Date.now() + SESSION_SECONDS * 1000;
  while (Date.now() < deadline) {
    sleep(Math.min(POLL_SECONDS, Math.max(1, (deadline - Date.now()) / 1000)));
    const state = request("GET", "/api/state", undefined, "customer_state", session.actorId);
    assertStatus(state, [200], "GET /api/state");
  }
}

function startRoleSession() {
  if (FLOW === "kiosk") {
    roleSessionReady = true;
    return { actorId: `kiosk-vu-${exec.vu.idInTest}`, user: null };
  }
  const prefix = FLOW.toUpperCase();
  const actorId = `${FLOW}-vu-${exec.vu.idInTest}`;
  const user = login(__ENV[`${prefix}_EMAIL`], __ENV[`${prefix}_PASSWORD`], actorId);
  const authenticatedUser = getAuthenticatedUser(actorId);
  roleSessionReady = true;
  return { actorId, user: authenticatedUser || user };
}

function backgroundFlow() {
  validateConfiguration();
  if (!roleSessionReady) startRoleSession();
  const actorId = `${FLOW}-vu-${exec.vu.idInTest}`;
  if (FLOW === "kiosk") {
    if (!rolePageLoaded) {
      const page = request("GET", "/totem", undefined, "page_kiosk", actorId);
      assertStatus(page, [200], "GET /totem");
      rolePageLoaded = true;
    }
    const status = request("GET", "/api/kiosk/status", undefined, "kiosk_status", actorId);
    assertStatus(status, [200], "GET /api/kiosk/status");
    if (jsonBody(status).paired !== true) fail("O totem sintético não está pareado no staging.");
    const keyRunPart = RUN_ID.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 72);
    const key = `load-${keyRunPart}-${exec.vu.idInTest}-${exec.vu.iterationInScenario}-${requestSequence}`;
    const issue = request("POST", "/api/kiosk/tickets", {
      idempotencyKey: key,
      sectorId: __ENV.SECTOR_ID,
      priority: false,
      load_test_run_id: RUN_ID
    }, "kiosk_ticket_create", actorId);
    assertStatus(issue, [201], "POST /api/kiosk/tickets");
    const result = jsonBody(issue);
    if (!result.ticket?.id || !result.printJob?.id) fail("A emissão não retornou senha e trabalho de impressão sintéticos.");
    TICKETS.add(1, { flow: FLOW });
    sleep(1.2);
    const printJob = request("GET", `/api/kiosk/print-jobs/${encodeURIComponent(result.printJob.id)}`, undefined, "kiosk_print_job_status", actorId);
    assertStatus(printJob, [200, 409], "GET /api/kiosk/print-jobs/:jobId");
    sleep(Number(__ENV.KIOSK_INTERVAL_SECONDS || 18));
    return;
  }
  if (FLOW === "tv") {
    if (!rolePageLoaded) {
      const page = request("GET", "/tv/acougue", undefined, "page_tv", actorId);
      assertStatus(page, [200], "GET /tv/acougue");
      rolePageLoaded = true;
    }
    const state = request("GET", "/api/display/state", undefined, "display_state", actorId);
    assertStatus(state, [200], "GET /api/display/state");
    if (__ENV.INCLUDE_TV_WEATHER === "1" && Date.now() - lastTvWeatherAt >= 25 * 60 * 1000) {
      lastTvWeatherAt = Date.now();
      const weather = request("GET", "/api/weather", undefined, "tv_weather", actorId);
      if (![200, 503].includes(weather.status)) fail(`GET /api/weather retornou HTTP ${weather.status}.`);
    }
    if (Date.now() - lastTvPlaylistAt >= 5 * 60 * 1000) {
      lastTvPlaylistAt = Date.now();
      const playlist = request("GET", "/data/tv-playlist.json", undefined, "tv_playlist", actorId);
      assertStatus(playlist, [200], "GET /data/tv-playlist.json");
    }
    sleep(TV_REFRESH_SECONDS);
    return;
  }

  if (FLOW === "attendant") {
    if (!rolePageLoaded) {
      const page = request("GET", "/attendant", undefined, "page_attendant", actorId);
      assertStatus(page, [200], "GET /attendant");
      rolePageLoaded = true;
      const initialState = request("GET", "/api/staff/state", undefined, "staff_state", actorId);
      assertStatus(initialState, [200], "GET /api/staff/state");
    }
    const events = request("GET", "/api/events?scope=staff", undefined, "staff_events_sse", actorId);
    assertStatus(events, [200], "GET /api/events?scope=staff");
    SSE_RECONNECTS.add(1, { flow: FLOW });
    if (__ENV.ENABLE_STAFF_MUTATIONS === "1" && Date.now() - lastBackgroundActionAt >= Number(__ENV.STAFF_ACTION_INTERVAL_SECONDS || 90) * 1000) {
      if (!__ENV.SECTOR_ID) fail("Defina o setor sintético exclusivo para habilitar ações de atendente.");
      lastBackgroundActionAt = Date.now();
      const call = request("POST", `/api/sectors/${encodeURIComponent(__ENV.SECTOR_ID)}/call-next`, {}, "ticket_call", actorId);
      assertStatus(call, [200], "POST /api/sectors/:sectorId/call-next");
      const ticket = jsonBody(call).ticket;
      if (ticket?.id) {
        const confirm = request("POST", `/api/tickets/${encodeURIComponent(ticket.id)}/confirm`, {}, "ticket_confirm", actorId);
        assertStatus(confirm, [200], "POST /api/tickets/:ticketId/confirm");
        const finish = request("POST", `/api/tickets/${encodeURIComponent(ticket.id)}/finish`, {}, "ticket_finish", actorId);
        assertStatus(finish, [200], "POST /api/tickets/:ticketId/finish");
      }
    }
    sleep(Number(__ENV.EVENT_RECONNECT_SECONDS || 3));
    return;
  }

  if (!rolePageLoaded) {
    const page = request("GET", "/admin", undefined, "page_admin", actorId);
    assertStatus(page, [200], "GET /admin");
    rolePageLoaded = true;
  }
  const staffState = request("GET", "/api/staff/state", undefined, "staff_state", actorId);
  assertStatus(staffState, [200], "GET /api/staff/state");
  const metrics = request("GET", `/api/metrics?date=${encodeURIComponent(__ENV.METRICS_DATE || new Date().toISOString().slice(0, 10))}`, undefined, "manager_metrics", actorId);
  assertStatus(metrics, [200], "GET /api/metrics");
  if (__ENV.INCLUDE_MANAGER_USERS === "1" && !managerUsersLoaded) {
    const users = request("GET", "/api/users", undefined, "manager_users", actorId);
    assertStatus(users, [200], "GET /api/users");
    managerUsersLoaded = true;
  }
  sleep(MANAGER_REFRESH_SECONDS);
}

export default function () {
  if (FLOW === "customer") customerFlow();
  else backgroundFlow();
}
