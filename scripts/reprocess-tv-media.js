const { transcodeSupabaseVideo } = require("../server/integrations/tv-media-transcoder");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const BUCKET = "tv-media";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
}

async function main() {
  const rows = await supabaseJson(`/rest/v1/tv_media?select=id,title,storage_path,media_type,mime_type,file_size&media_type=eq.video&active=eq.true&upload_status=eq.ready&order=created_at.asc`);
  for (const media of rows) {
    const targetStoragePath = `tv/${media.id}.h264.mp4`;
    if (media.storage_path === targetStoragePath && media.mime_type === "video/mp4") {
      console.log(`Já normalizado: ${media.title}`);
      continue;
    }
    console.log(`Convertendo: ${media.title}`);
    const converted = await transcodeSupabaseVideo({
      supabaseUrl: SUPABASE_URL,
      serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      bucket: BUCKET,
      sourceStoragePath: media.storage_path,
      targetStoragePath
    });
    await supabaseJson(`/rest/v1/tv_media?id=eq.${encodeURIComponent(media.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: {
        storage_path: converted.storagePath,
        mime_type: converted.mimeType,
        file_size: converted.fileSize,
        updated_at: new Date().toISOString()
      }
    });
    if (media.storage_path !== converted.storagePath) await removeObject(media.storage_path);
    console.log(`Publicado: ${media.title} (${converted.fileSize} bytes)`);
  }
}

async function removeObject(storagePath) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: { ...storageHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ prefixes: [storagePath] }),
  });
  if (!response.ok && response.status !== 404) {
    const details = (await response.text()).slice(0, 200);
    console.warn(`Arquivo antigo não foi removido (${response.status}): ${details}`);
  }
}

async function supabaseJson(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: { ...storageHeaders(), "content-type": "application/json", ...(options.headers || {}) },
    ...(options.body && typeof options.body !== "string" ? { body: JSON.stringify(options.body) } : {})
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase respondeu ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function storageHeaders() {
  return { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
