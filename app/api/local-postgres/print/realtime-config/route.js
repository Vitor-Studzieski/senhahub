import { verifyPrintAgentRequest } from "../../../../../server/kiosk/print-kiosk-service.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }
  const agent = verifyPrintAgentRequest(request.headers, process.env);
  if (agent.error) return Response.json({ error: agent.error }, { status: agent.status });
  let body = {};
  try { body = await request.json(); } catch { /* body opcional */ }
  const kioskId = String(body.kioskId || agent.kioskId).trim();
  if (kioskId !== agent.kioskId) return Response.json({ error: "Agente nao autorizado para este totem." }, { status: 403 });
  return Response.json({ enabled: false, kioskId, realtimeTopic: `senhahub:print:${kioskId}` });
}
