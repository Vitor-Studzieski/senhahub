const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { sanitizeDisplayState } = require("../server/display-state");

const root = path.join(__dirname, "..");

test("estado da TV não expõe nome nem identificador do cliente", () => {
  const sanitized = sanitizeDisplayState({
    source: "supabase",
    sectors: [{
      id: "acougue-loja-1",
      currentCustomerName: "Cliente Confidencial",
      tickets: [{ ticket: "A001", customerName: "Cliente Confidencial", customerId: "customer-1", status: "chamado" }],
      recentCalls: [{ ticket: "A001", customerName: "Cliente Confidencial", createdAt: "2026-09-21T12:00:00.000Z" }]
    }]
  });

  assert.equal(sanitized.sectors[0].currentCustomerName, undefined);
  assert.equal(sanitized.sectors[0].tickets[0].customerName, undefined);
  assert.equal(sanitized.sectors[0].tickets[0].customerId, undefined);
  assert.equal(sanitized.sectors[0].recentCalls[0].customerName, undefined);
  assert.equal(sanitized.sectors[0].tickets[0].ticket, "A001");
});

test("TV legada é redirecionada e a fila SQLite possui rota protegida", () => {
  const proxy = fs.readFileSync(path.join(root, "proxy.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "server/server.js"), "utf8");

  assert.match(proxy, /"\/tv-acougue\.html": "\/tv\/acougue"/);
  assert.match(server, /"\/tv-acougue\.html": "\/tv\/acougue"/);
  assert.match(server, /const DISPLAY_ROLES = \["tv", \.\.\.STAFF_ROLES\]/);
  assert.match(server, /url\.pathname === "\/api\/display\/state"/);
  assert.match(server, /requireAuth\(req, res, DISPLAY_ROLES\)/);
});

test("conta TV exige permissão de setor em todos os backends", () => {
  const standalone = fs.readFileSync(path.join(root, "server/server.js"), "utf8");
  const supabase = fs.readFileSync(path.join(root, "server/integrations/supabase-runtime.js"), "utf8");
  const localPostgres = fs.readFileSync(path.join(root, "server/data/local-legacy.js"), "utf8");
  const localRepository = fs.readFileSync(path.join(root, "server/data/local-repository.js"), "utf8");

  assert.match(standalone, /role === "tv" && \(!sectorIds\.length/);
  assert.match(supabase, /role === "tv"[\s\S]*!sectorIds\.length/);
  assert.match(localPostgres, /role === "tv" && !sectorIds\.length/);
  assert.match(localRepository, /\["attendant", "tv"\]\.includes\(user\.role\)/);
});

test("TV atualiza conexão, identifica re-chamadas e dispara destaque visual", () => {
  const client = fs.readFileSync(path.join(root, "public/tv-acougue.js"), "utf8");

  assert.match(client, /\["tv", "attendant", "manager", "admin"\]\.includes\(state\.userRole\)/);
  assert.match(client, /updateConnection\("online", "Online"\)/);
  assert.match(client, /updateConnection\("offline", "Offline"\)/);
  assert.match(client, /latestCallSignature/);
  assert.match(client, /triggerCallArrival\(\)/);
  assert.doesNotMatch(client, /active\?\.currentCustomerName/);
});

test("conta TV pode usar os comandos de chamada sem ganhar acesso administrativo", () => {
  const standalone = fs.readFileSync(path.join(root, "server/server.js"), "utf8");
  const supabase = fs.readFileSync(path.join(root, "server/integrations/supabase-runtime.js"), "utf8");
  const callNext = fs.readFileSync(path.join(root, "app/api/local-postgres/staff/call-next/route.js"), "utf8");
  const callControl = fs.readFileSync(path.join(root, "app/api/local-postgres/staff/call-control/route.js"), "utf8");

  assert.match(standalone, /const CALL_CONTROL_ROLES = \["tv", \.\.\.STAFF_ROLES\]/);
  assert.match(standalone, /requireAuth\(req, res, CALL_CONTROL_ROLES\)/g);
  assert.match(supabase, /const CALL_CONTROL_ROLES = \["tv", \.\.\.STAFF_ROLES\]/);
  assert.match(supabase, /requireUser\(request, CALL_CONTROL_ROLES\)/g);
  assert.match(callNext, /\["tv", "attendant", "manager", "admin"\]\.includes\(session\.user\.role\)/);
  assert.match(callControl, /\["tv", "attendant", "manager", "admin"\]\.includes\(session\.user\.role\)/);
  assert.match(standalone, /const ADMIN_ROLES = \["manager", "admin"\]/);
  assert.match(supabase, /const ADMIN_ROLES = \["manager", "admin"\]/);
});

test("nova chamada abre destaque exclusivo por sete segundos e tenta emitir aviso sonoro", () => {
  const client = fs.readFileSync(path.join(root, "public/tv-acougue.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "public/tv-acougue.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
  const layout = fs.readFileSync(path.join(root, "app/layout.jsx"), "utf8");

  assert.match(html, /id="tvCallAlert"[^>]*aria-live="assertive"/);
  assert.match(client, /const CALL_ALERT_DURATION_MS = 7000/);
  assert.match(client, /showCallAlert\(sector, latestCall\)/);
  assert.match(client, /state\.callAlertTimer = window\.setTimeout\(hideCallAlert, CALL_ALERT_DURATION_MS\)/);
  assert.match(client, /AudioContext = window\.AudioContext \|\| window\.webkitAudioContext/);
  assert.match(client, /ensureCallAlertAudio\(\)/);
  assert.match(client, /function playCallAlertSound\(\)/);
  assert.match(client, /const CALL_ALERT_SOUND_INTERVAL_MS = 480/);
  assert.match(client, /const CALL_ALERT_SOUND_PULSE_MS = 300/);
  assert.match(client, /const CALL_ALERT_SOUND_GAIN = 0\.9/);
  assert.match(client, /oscillator\.type = "square"/);
  assert.match(client, /state\.callAlertAudioStopTimer = window\.setTimeout\(stopCallAlertSound, CALL_ALERT_DURATION_MS \+ 150\)/);
  assert.match(client, /stopCallAlertSound\(\)/);
  assert.match(styles, /\.tv-call-alert\[hidden\]/);
  assert.match(styles, /\.tv-call-alert\s*\{[\s\S]*?inset: 0;[\s\S]*?background: #fff;/);
  assert.match(styles, /\.tv-screen \.tv-call-alert-card/);
  assert.match(layout, /styles\.css\?v=20260921\.8/);
});
