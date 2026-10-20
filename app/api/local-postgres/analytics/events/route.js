import { allowLocalAnalyticsRequest, trackLocalAcquisitionEvent } from "../../../../../server/data/local-repository.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function requestKey(request) {
  const forwarded = String(request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  return forwarded || request.headers.get("x-real-ip") || "local-client";
}

export async function POST(request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "O corpo da requisição precisa ser um JSON válido." }, { status: 400 });
  }
  try {
    if (!(await allowLocalAnalyticsRequest(requestKey(request)))) {
      return Response.json({ error: "Limite de eventos atingido." }, { status: 429 });
    }
    const result = await trackLocalAcquisitionEvent(body.type, body.idempotencyKey);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: String(error?.message || "Não foi possível registrar o evento.") }, { status: 400 });
  }
}
