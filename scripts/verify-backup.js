const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

const configuredOffsiteRoot = String(process.env.BACKUP_OFFSITE_DIR || "").trim();
const offsiteRoot = configuredOffsiteRoot ? path.resolve(configuredOffsiteRoot) : "";
const statusFile = path.resolve(String(process.env.BACKUP_STATUS_FILE || (offsiteRoot ? path.join(offsiteRoot, "latest.json") : "")).trim());
const encryptionKey = String(process.env.BACKUP_ENCRYPTION_KEY || "");
const maximumAgeHours = Number(process.env.BACKUP_MAX_AGE_HOURS || 30);

if (!offsiteRoot) fail("BACKUP_OFFSITE_DIR precisa apontar para o destino externo.");
if (encryptionKey.length < 32) fail("BACKUP_ENCRYPTION_KEY precisa ter ao menos 32 caracteres.");
if (!isWithin(statusFile, offsiteRoot)) fail("BACKUP_STATUS_FILE precisa ficar dentro do destino externo.");
if (!Number.isFinite(maximumAgeHours) || maximumAgeHours <= 0) fail("BACKUP_MAX_AGE_HOURS precisa ser positivo.");

try {
  const status = readJson(statusFile);
  const backupDir = path.resolve(String(status.backupDir || ""));
  if (!isWithin(backupDir, offsiteRoot) || backupDir === offsiteRoot) fail("o status aponta para uma pasta de backup inválida.");

  const manifest = readJson(path.join(backupDir, "manifest.json"));
  const createdAt = new Date(manifest.createdAt || status.createdAt || 0).getTime();
  if (!Number.isFinite(createdAt)) fail("manifesto sem data válida.");
  if (Date.now() - createdAt > maximumAgeHours * 60 * 60 * 1000) {
    fail(`backup mais antigo que ${maximumAgeHours} horas.`);
  }

  const expected = manifest.format === "senhahub-postgres-backup-v1"
    ? new Set(["roles.sql.enc", "database.sql.enc"])
    : manifest.format === "senhahub-supabase-backup-v1"
      ? new Set(["roles.sql.enc", "schema.sql.enc", "data.sql.enc"])
      : null;
  if (!expected || !Array.isArray(manifest.files) || manifest.files.length !== expected.size || manifest.files.some((file) => !expected.has(file))) {
    fail("manifesto de backup desconhecido ou incompleto.");
  }

  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "senhahub-backup-verify-"));
  try {
    for (const fileName of manifest.files) {
      const encryptedPath = path.join(backupDir, fileName);
      const permissions = fs.statSync(encryptedPath).mode & 0o777;
      if (permissions & 0o077) fail(`permissões abertas no arquivo ${fileName}.`);
      decryptFile(encryptedPath, path.join(temporaryDir, fileName.replace(/\.enc$/, "")), encryptionKey);
    }
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    ok: true,
    format: manifest.format,
    createdAt: manifest.createdAt,
    backupDir,
    files: manifest.files
  }, null, 2));
} catch (error) {
  fail(error.message);
}

function decryptFile(inputPath, outputPath, passphrase) {
  const file = fs.readFileSync(inputPath);
  if (file.subarray(0, 5).toString() !== "SHBK1") throw new Error(`cabecalho inválido: ${path.basename(inputPath)}`);
  const salt = file.subarray(5, 21);
  const iv = file.subarray(21, 33);
  const tag = file.subarray(33, 49);
  const ciphertext = file.subarray(49);
  const key = crypto.pbkdf2Sync(passphrase, salt, 600_000, 32, "sha256");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  fs.writeFileSync(outputPath, plaintext, { mode: 0o600, flag: "wx" });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`arquivo não encontrado: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isWithin(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
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
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function fail(message) {
  console.error(`Verificação de backup reprovada: ${message}`);
  process.exit(1);
}
