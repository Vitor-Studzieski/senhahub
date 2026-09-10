const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const databaseUrl = String(
  process.env.SECURITY_DATABASE_URL
    || (process.env.DATA_BACKEND === "local-postgres" ? process.env.LOCAL_DATABASE_URL : process.env.DATABASE_URL)
    || ""
).trim();
const internalTables = [
  "app_sessions",
  "calls",
  "devices",
  "events",
  "login_attempts",
  "print_jobs",
  "print_kiosks",
  "profile_sector_permissions",
  "push_notification_events",
  "push_rate_limits",
  "ratings",
  "security_rate_limits",
  "services",
  "ticket_counters"
];

if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) fail("SECURITY_DATABASE_URL, LOCAL_DATABASE_URL ou DATABASE_URL precisa apontar para PostgreSQL.");

const client = new Client({
  connectionString: databaseUrl,
  ssl: process.env.SECURITY_DATABASE_SSL === "1" ? { rejectUnauthorized: process.env.SECURITY_DATABASE_SSL_VERIFY !== "0" } : undefined
});

main().catch((error) => {
  console.error(`Preflight de segurança falhou: ${error.message}`);
  process.exitCode = 1;
}).finally(() => client.end().catch(() => {}));

async function main() {
  await client.connect();
  const errors = [];
  const rls = await client.query(`
    SELECT n.nspname AS schema_name, c.relname AS table_name, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = 'public'
  `);
  const publicWithoutRls = rls.rows.filter((row) => !row.rls_enabled).map((row) => row.table_name);
  if (publicWithoutRls.length) errors.push(`Tabelas públicas sem RLS: ${publicWithoutRls.join(", ")}`);

  const columns = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (
        ('profiles', 'store_code'),
        ('sectors', 'store_code'),
        ('print_kiosks', 'store_code')
      )
  `);
  const presentColumns = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  for (const expected of ["profiles.store_code", "sectors.store_code", "print_kiosks.store_code"]) {
    if (!presentColumns.has(expected)) errors.push(`Coluna ausente: public.${expected}`);
  }

  const mismatches = await client.query(`
    SELECT
      (SELECT count(*) FROM public.profile_sector_permissions permissions
       JOIN public.profiles profiles ON profiles.id = permissions.profile_id
       JOIN public.sectors sectors ON sectors.id = permissions.sector_id
       WHERE profiles.store_code IS NOT NULL AND profiles.store_code <> sectors.store_code) AS permission_store_mismatches,
      (SELECT count(*) FROM public.tickets tickets
       JOIN public.print_kiosks kiosks ON kiosks.id = tickets.kiosk_id
       JOIN public.sectors sectors ON sectors.id = tickets.sector_id
       WHERE tickets.source = 'physical' AND tickets.kiosk_id IS NOT NULL
         AND kiosks.store_code <> sectors.store_code) AS physical_ticket_store_mismatches
  `);
  const mismatch = mismatches.rows[0] || {};
  if (Number(mismatch.permission_store_mismatches) > 0) errors.push("Permissões de perfil atravessam lojas.");
  if (Number(mismatch.physical_ticket_store_mismatches) > 0) errors.push("Tickets físicos atravessam lojas.");

  const triggers = await client.query(`
    SELECT tgname
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname = ANY($1::text[])
  `, [["profile_sector_store_boundary", "tickets_physical_store_boundary"]]);
  const triggerNames = new Set(triggers.rows.map((row) => row.tgname));
  for (const triggerName of ["profile_sector_store_boundary", "tickets_physical_store_boundary"]) {
    if (!triggerNames.has(triggerName)) errors.push(`Trigger ausente: ${triggerName}`);
  }

  const internalProtection = await client.query(`
    SELECT
      c.relname AS table_name,
      c.relrowsecurity AS rls_enabled,
      count(p.policyname)::integer AS policy_count,
      coalesce(bool_or(p.policyname = 'senhahub_deny_external_access'), false) AS has_deny_policy
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_policies p
      ON p.schemaname = n.nspname
     AND p.tablename = c.relname
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = ANY($1::text[])
    GROUP BY c.relname, c.relrowsecurity
  `, [internalTables]);
  const protectionByTable = new Map(internalProtection.rows.map((row) => [row.table_name, row]));
  for (const table of internalTables) {
    const protection = protectionByTable.get(table);
    if (!protection) {
      errors.push(`Tabela interna ausente: public.${table}`);
    } else if (!protection.rls_enabled) {
      errors.push(`Tabela interna sem RLS: public.${table}`);
    } else if (Number(protection.policy_count) > 0 && !protection.has_deny_policy) {
      errors.push(`Tabela interna com policies sem deny explícito: public.${table}`);
    }
  }

  const roles = await client.query(`
    SELECT rolname, rolsuper, rolbypassrls
    FROM pg_roles
    WHERE rolname = 'senhahub_service'
  `);
  const runtimeRole = roles.rows[0];
  if (runtimeRole?.rolsuper) errors.push("senhahub_service não pode ser superusuário.");
  if (runtimeRole?.rolbypassrls) errors.push("senhahub_service não pode usar BYPASSRLS.");

  console.log(JSON.stringify({
    ok: errors.length === 0,
    publicTables: rls.rows.length,
    publicTablesWithRls: rls.rows.filter((row) => row.rls_enabled).length,
    permissionStoreMismatches: Number(mismatch.permission_store_mismatches || 0),
    physicalTicketStoreMismatches: Number(mismatch.physical_ticket_store_mismatches || 0),
    policiesChecked: internalTables.length,
    internalTablesDenyByDefault: internalProtection.rows.filter((row) => row.rls_enabled && Number(row.policy_count) === 0).map((row) => row.table_name),
    runtimeRoleChecked: Boolean(runtimeRole),
    errors
  }, null, 2));
  if (errors.length) process.exitCode = 1;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = unquote(match[2]);
  }
}

function unquote(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function fail(message) {
  console.error(`Preflight de segurança não iniciado: ${message}`);
  process.exit(1);
}
