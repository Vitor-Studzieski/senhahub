const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { sanitizeDisplayState } = require("../server/display-state");
const { buildFfmpegArgs } = require("../server/integrations/tv-media-transcoder");

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
  assert.match(client, /showCallAlert\(sector, latestCall\)/);
  assert.doesNotMatch(client, /active\?\.currentCustomerName/);
});

test("TV oculta os blocos removidos do layout público", () => {
  const html = fs.readFileSync(path.join(root, "public/tv-acougue.html"), "utf8");
  const client = fs.readFileSync(path.join(root, "public/tv-acougue.js"), "utf8");

  assert.doesNotMatch(html, /Senhas em tempo real|SENHAS CHAMADAS|Aguarde sua chamada|tv-speaker/);
  assert.doesNotMatch(html, /Fique atento ao painel|Próximas senhas|tv-current-call|Controle do colaborador/);
  assert.doesNotMatch(html, /AO VIVO|tv-live-badge|tv-queue-status/);
  assert.doesNotMatch(client, /queueSubtitle|waitingSubtitle|currentCustomer/);
});

test("card de aguardando exibe a senha atual", () => {
  const html = fs.readFileSync(path.join(root, "public/tv-acougue.html"), "utf8");
  const client = fs.readFileSync(path.join(root, "public/tv-acougue.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

  assert.match(html, /<h2>Senha atual<\/h2>/);
  assert.match(html, /id="tvCurrentTicket"/);
  assert.match(html, /id="tvCurrentStatus"/);
  assert.doesNotMatch(html, /tvWaitingCount|tvWaitingTickets|pessoas na fila/);
  assert.match(client, /elements\.currentTicket\.textContent = formatTicket\(currentTicket, sector\.prefix\)/);
  assert.match(client, /elements\.currentStatus\.textContent/);
  assert.match(styles, /\.tv-current-ticket-content\s+strong\s*\{[\s\S]*?color: #000;/);
  assert.match(styles, /\.tv-current-ticket-content\s+span\s*\{[\s\S]*?color: #000;/);
});

test("TV exibe somente os comandos de repetir e chamar a próxima senha", () => {
  const html = fs.readFileSync(path.join(root, "public/tv-acougue.html"), "utf8");
  const styles = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");

  assert.match(html, /data-tv-call-action="again"[^>]*>[^<]*↻/);
  assert.match(html, /data-tv-call-action="next"[^>]*>[^<]*→/);
  assert.doesNotMatch(html, /data-tv-call-action="previous"/);
  assert.match(styles, /\.tv-call-controls-actions\s*\{/);
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
  assert.match(layout, /styles\.css\?v=20260922\.1/);
});

test("biblioteca de conteúdos da TV é restrita ao marketing e alimenta a reprodução", () => {
  const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260922090000_tv_content_library.sql"), "utf8");
  const runtime = fs.readFileSync(path.join(root, "server/integrations/supabase-runtime.js"), "utf8");
  const proxy = fs.readFileSync(path.join(root, "proxy.js"), "utf8");
  const page = fs.readFileSync(path.join(root, "app/marketing/conteudos-tv/page.jsx"), "utf8");
  const client = fs.readFileSync(path.join(root, "public/marketing-tv.js"), "utf8");

  assert.match(migration, /add value if not exists 'marketing'/);
  assert.match(migration, /create table if not exists public\.tv_media/);
  assert.match(migration, /enable row level security/);
  assert.match(runtime, /const MEDIA_MANAGEMENT_ROLES = \["marketing", \.\.\.ADMIN_ROLES\]/);
  assert.match(runtime, /tvMediaUploadIntentRoute/);
  assert.match(runtime, /storage\/v1\/object\/upload\/sign/);
  assert.match(runtime, /tvMediaDeleteRoute/);
  assert.match(proxy, /"\/marketing\/conteudos-tv": \["marketing", "manager", "admin"\]/);
  assert.match(page, /marketing-tv\.html/);
  assert.match(client, /\/api\/tv\/media\?manage=1/);
  assert.match(client, /O plano atual do Supabase bloqueou este arquivo/);
});

test("vídeos enviados para a TV são normalizados para H.264 e AAC", () => {
  const args = buildFfmpegArgs("/tmp/source", "/tmp/output.mp4");
  const runtime = fs.readFileSync(path.join(root, "server/integrations/supabase-runtime.js"), "utf8");
  const client = fs.readFileSync(path.join(root, "public/marketing-tv.js"), "utf8");
  const packageJson = fs.readFileSync(path.join(root, "package.json"), "utf8");

  assert.match(args.join(" "), /-c:v libx264/);
  assert.match(args.join(" "), /-profile:v baseline/);
  assert.match(args.join(" "), /-level 3\.1/);
  assert.match(args.join(" "), /scale=w='min\(720,iw\)':h=-2,format=yuv420p/);
  assert.match(args.join(" "), /-c:a aac/);
  assert.match(args.join(" "), /-movflags \+faststart/);
  assert.match(runtime, /transcodeSupabaseVideo/);
  assert.match(runtime, /mime_type: converted\.mimeType/);
  assert.match(runtime, /tvMediaStreamRoute/);
  assert.match(runtime, /accept-ranges/);
  assert.match(runtime, /\/api\/tv\/media\/\$\{row\.id\}\/stream/);
  assert.doesNotMatch(runtime, /storage\/v1\/object\/remove/);
  assert.match(runtime, /storage\/v1\/object\/\$\{encodeURIComponent\(TV_MEDIA_BUCKET\)\}/);
  assert.match(runtime, /method: "DELETE"/);
  assert.match(client, /Convertendo para o formato compatível com a TV/);
  assert.match(packageJson, /"@ffmpeg-installer\/ffmpeg": "1\.1\.0"/);
});
