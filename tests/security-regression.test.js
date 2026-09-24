const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Readable } = require("node:stream");

test("a fila local exige sessão de equipe antes de consultar o PostgreSQL", async () => {
  const previousBackend = process.env.DATA_BACKEND;
  const previousRoutes = process.env.LOCAL_POSTGRES_ROUTES_ENABLED;
  process.env.DATA_BACKEND = "local-postgres";
  process.env.LOCAL_POSTGRES_ROUTES_ENABLED = "1";

  try {
    const { GET } = await import("../app/api/local-postgres/queue/route.js");
    const response = await GET(new Request("http://localhost/api/local-postgres/queue"));

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Sessão não encontrada." });
  } finally {
    if (previousBackend === undefined) delete process.env.DATA_BACKEND;
    else process.env.DATA_BACKEND = previousBackend;
    if (previousRoutes === undefined) delete process.env.LOCAL_POSTGRES_ROUTES_ENABLED;
    else process.env.LOCAL_POSTGRES_ROUTES_ENABLED = previousRoutes;
  }
});

test("o servidor rejeita corpos maiores que o limite antes de encaminhar a rota", async () => {
  const { readRawRequestBody } = require("../server/server.js");
  const request = Readable.from([Buffer.alloc(1_000_001)]);

  await assert.rejects(
    readRawRequestBody(request),
    (error) => error?.code === "PAYLOAD_TOO_LARGE"
  );
});

test("tracking público não devolve o nome do cliente atualmente chamado", () => {
  const runtime = fs.readFileSync(path.join(__dirname, "..", "server/integrations/supabase-runtime.js"), "utf8");
  const standalone = fs.readFileSync(path.join(__dirname, "..", "server/server.js"), "utf8");
  const publicRuntime = extractFunction(runtime, "function publicTicketView");
  const publicStandalone = extractFunction(standalone, "function publicTicketView");
  assert.doesNotMatch(publicRuntime, /currentCustomerName/);
  assert.doesNotMatch(publicStandalone, /currentCustomerName/);
});

test("a migration cria a barreira de loja para permissões de setor", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "supabase/migrations/20260910130134_security_isolation_round2.sql"), "utf8");
  assert.match(migration, /profile_sector_store_boundary/);
  assert.match(migration, /profile_sector_store_mismatch/);
  assert.match(migration, /deferrable initially deferred/i);
});

test("o runtime Supabase mantém tabelas e RPCs privilegiados em allowlists", () => {
  const runtime = fs.readFileSync(path.join(__dirname, "..", "server/integrations/supabase-runtime.js"), "utf8");
  const privilegeMigration = fs.readFileSync(path.join(__dirname, "..", "supabase/migrations/20260910132048_restrict_service_role_direct_print_tables.sql"), "utf8");
  assert.match(runtime, /SERVICE_ROLE_TABLE_ALLOWLIST/);
  assert.match(runtime, /SERVICE_ROLE_RPC_ALLOWLIST/);
  assert.match(runtime, /assertServiceRoleTable\(table\)/);
  assert.match(runtime, /claim_next_print_job_v2/);
  assert.match(runtime, /resolve_print_job_v2/);
  assert.match(privilegeMigration, /revoke all on table[\s\S]*print_enrollments[\s\S]*maintenance_leases[\s\S]*from service_role/i);
});

test("reset do histórico fica limitado a gestores e senhas encerradas", () => {
  const runtime = fs.readFileSync(path.join(__dirname, "..", "server/integrations/supabase-runtime.js"), "utf8");
  const route = fs.readFileSync(path.join(__dirname, "..", "app/api/local-postgres/tickets/history/reset/route.js"), "utf8");
  const migration = fs.readFileSync(path.join(__dirname, "..", "supabase/migrations/20260916004407_reset_ticket_history.sql"), "utf8");
  const printSafeMigration = fs.readFileSync(path.join(__dirname, "..", "supabase/migrations/20260916005405_reset_ticket_history_skip_unresolved_print_jobs.sql"), "utf8");
  const printAuditMigration = fs.readFileSync(path.join(__dirname, "..", "supabase/migrations/20260916011059_reset_ticket_history_preserve_print_audit.sql"), "utf8");
  assert.match(runtime, /reset_ticket_history/);
  assert.match(runtime, /requireUser\(request, ADMIN_ROLES\)/);
  assert.match(runtime, /verifyCsrf\(request, user\)/);
  assert.match(route, /requireLocalUser\(request, \["manager", "admin"\]\)/);
  assert.match(route, /requireCsrf\(request, user\.session\)/);
  assert.match(migration, /p\.role in \('manager'::public\.user_role, 'admin'::public\.user_role\)/i);
  assert.match(migration, /array\['atendido', 'cancelado', 'expirado'\]/i);
  assert.match(migration, /revoke all on function public\.reset_ticket_history\(uuid\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.reset_ticket_history\(uuid\) to service_role/i);
  assert.match(printSafeMigration, /not exists[\s\S]*from public\.print_jobs[\s\S]*j\.status <> 'printed'[\s\S]*j\.resolved_at is null/i);
  assert.match(printSafeMigration, /'skippedTickets'/);
  assert.match(printAuditMigration, /create or replace function public\.protect_unresolved_print_ticket\(\)/i);
  assert.match(printAuditMigration, /j\.status = 'failed'[\s\S]*coalesce\(j\.attempts, 0\) >= 5[\s\S]*j\.next_attempt_at is null[\s\S]*j\.send_started_at is null/i);
  assert.match(printAuditMigration, /receipts are retained as audit rows/i);
  assert.match(printAuditMigration, /revoke all on function public\.reset_ticket_history\(uuid\) from public, anon, authenticated/i);
});

test("tickets históricos da Pompeia são reclassificados para os setores da Loja 2", () => {
  const migration = fs.readFileSync(path.join(__dirname, "..", "supabase/migrations/20260910131734_reclassify_pompeia_physical_tickets_store_2.sql"), "utf8");
  assert.match(migration, /acougue-loja-1.*acougue-loja-2/s);
  assert.match(migration, /frios-loja-1.*frios-loja-2/s);
  assert.match(migration, /padaria-loja-1.*padaria-loja-2/s);
  assert.match(migration, /update public\.events/);
  assert.match(migration, /update public\.print_jobs/);
});

test("proxy só aceita forwarded headers quando explicitamente confiável", () => {
  const standalone = fs.readFileSync(path.join(__dirname, "..", "server/server.js"), "utf8");
  const runtime = fs.readFileSync(path.join(__dirname, "..", "server/integrations/supabase-runtime.js"), "utf8");
  assert.match(standalone, /function trustedProxyHeader\(req, name\)/);
  assert.match(standalone, /TRUST_PROXY_HEADERS !== "1"/);
  assert.match(standalone, /function nodeRequestProtocol\(req, url\)/);
  assert.match(runtime, /process\.env\.TRUST_PROXY_HEADERS === "1"/);
});

test("login aplica limites por IP e por conta sem lockout global", () => {
  const standalone = fs.readFileSync(path.join(__dirname, "..", "server/server.js"), "utf8");
  const runtime = fs.readFileSync(path.join(__dirname, "..", "server/integrations/supabase-runtime.js"), "utf8");
  assert.match(standalone, /login:ip/);
  assert.match(standalone, /login:account/);
  assert.match(runtime, /login:ip/);
  assert.match(runtime, /login:account/);
  assert.match(runtime, /LOGIN_ACCOUNT_RATE_LIMIT/);
});

test("troca de senha limita tentativas por IP e por conta antes de validar credenciais", () => {
  const standalone = fs.readFileSync(path.join(__dirname, "..", "server/server.js"), "utf8");
  const runtime = fs.readFileSync(path.join(__dirname, "..", "server/integrations/supabase-runtime.js"), "utf8");
  for (const [source, signature] of [
    [standalone, "async function changeSupabasePassword"],
    [runtime, "async function changePassword(request)"]
  ]) {
    const changePassword = extractFunction(source, signature);
    assert.match(changePassword, /change-password:ip/);
    assert.match(changePassword, /change-password:account/);
    assert.ok(changePassword.indexOf("change-password:account") < changePassword.indexOf("validatePasswordPolicy"));
  }
  const localChangePassword = extractFunction(standalone, "async function changeLocalPassword");
  assert.match(localChangePassword, /change-password:ip/);
  assert.match(localChangePassword, /change-password:account/);
});

test("autorização de TV ignora user_metadata editável", () => {
  const runtime = fs.readFileSync(path.join(__dirname, "..", "server/integrations/supabase-runtime.js"), "utf8");
  const login = extractFunction(runtime, "async function login(request)");
  const getAuthUser = extractFunction(runtime, "async function getAuthUser(request)");
  const listUsers = extractFunction(runtime, "async function listUsers()");
  const createUser = extractFunction(runtime, "async function createUser(body)");

  assert.match(login, /trustedAccessMode\(auth\.user\.app_metadata\?\.access_mode\)/);
  assert.doesNotMatch(login, /auth\.user\.user_metadata/);
  assert.match(getAuthUser, /trustedAccessMode\(session\.accessMode\)/);
  assert.doesNotMatch(getAuthUser, /session\.user\.role/);
  assert.match(listUsers, /user\.app_metadata\?\.access_mode/);
  assert.doesNotMatch(listUsers, /user\.user_metadata/);
  assert.match(createUser, /app_metadata:\s*\{ access_mode: "tv" \}/);
  assert.doesNotMatch(createUser, /user_metadata:\s*\{\s*name,\s*role/);
  assert.match(createUser, /"tablet"/);
});

test("a verificação de backup valida manifesto, idade, permissões e AES-GCM", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senhahub-security-backup-"));
  const backupDir = path.join(root, "20260910T000000Z");
  const key = "k".repeat(48);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  try {
    const fileName = "database.sql.enc";
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const derivedKey = crypto.pbkdf2Sync(key, salt, 600_000, 32, "sha256");
    const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey, iv);
    const ciphertext = Buffer.concat([cipher.update("select 1;"), cipher.final()]);
    fs.writeFileSync(path.join(backupDir, fileName), Buffer.concat([Buffer.from("SHBK1"), salt, iv, cipher.getAuthTag(), ciphertext]), { mode: 0o600 });
    const manifest = {
      format: "senhahub-postgres-backup-v1",
      createdAt: new Date().toISOString(),
      files: ["roles.sql.enc", "database.sql.enc"]
    };
    for (const requiredFile of ["roles.sql.enc"]) fs.copyFileSync(path.join(backupDir, fileName), path.join(backupDir, requiredFile));
    fs.writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(root, "latest.json"), `${JSON.stringify({ ...manifest, backupDir })}\n`, { mode: 0o600 });

    const result = spawnSync(process.execPath, ["scripts/verify-backup.js"], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, BACKUP_OFFSITE_DIR: root, BACKUP_STATUS_FILE: path.join(root, "latest.json"), BACKUP_ENCRYPTION_KEY: key },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("lockout não é aplicado quando o IP não foi identificado com confiança", () => {
  const localAuth = fs.readFileSync(path.join(__dirname, "..", "server/auth/local-auth.js"), "utf8");
  const runtime = fs.readFileSync(path.join(__dirname, "..", "server/integrations/supabase-runtime.js"), "utf8");
  assert.match(localAuth, /count >= LOGIN_LIMIT && shouldApplyLoginLock\(attemptKey\)/);
  assert.match(runtime, /attempts >= LOGIN_ATTEMPT_LIMIT && shouldApplyLoginLock\(key\)/);
  assert.match(runtime, /isKnownClientIp\(requestIp\)/);
});

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} não encontrado`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${signature} sem fechamento`);
}
