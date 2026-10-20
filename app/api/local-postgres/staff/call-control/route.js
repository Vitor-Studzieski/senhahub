import { authenticateLocalRequest, hasValidCsrf } from "../../../../../server/auth/local-http-auth.js";
import { callControlLocalTicket } from "../../../../../server/data/local-repository.js";
import { dispatchLocalPushEvent } from "../../../../../server/notifications/local-push.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }
  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessão não encontrada." }, { status: 401 });
  const isPitchdayTvAccount = String(session.user?.email || "").trim().toLowerCase() === "pitchday@superpompeia.com"
    && session.user?.role === "tablet";
  if (!["tv", "attendant", "manager", "admin"].includes(session.user.role) && !isPitchdayTvAccount) {
    return Response.json({ error: "Acesso negado." }, { status: 403 });
  }
  if (!hasValidCsrf(request, session)) {
    return Response.json({ error: "Token CSRF inválido." }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (isPitchdayTvAccount && (body?.sectorId !== "pitch-day" || body?.action !== "next"
    || !(session.user.sectorIds || []).includes("pitch-day"))) {
    return Response.json({ error: "Esta conta só pode chamar a próxima senha do setor Pitch Day." }, { status: 403 });
  }

  try {
    const callUser = isPitchdayTvAccount
      ? { ...session.user, role: "tv", sectorIds: ["pitch-day"] }
      : session.user;
    const result = await callControlLocalTicket(body?.sectorId, body?.action, callUser);
    if (result.ticket?.customerId) {
      void dispatchLocalPushEvent({
        type: body?.action === "next" && Number(result.ticket.absenceCount || 0) === 0 ? "queue_called" : "queue_recalled",
        eventKey: `local-call-control:${result.ticket.id}:${result.ticket.calledAt || Date.now()}`,
        userId: result.ticket.customerId,
        ticketId: result.ticket.id,
        payloadVersion: 1,
        context: {
          customerName: result.ticket.customerName,
          sector: result.ticket.sector,
          counter: result.ticket.counterLabel,
          ticket: result.ticket.ticket
        }
      });
    }
    return Response.json({ source: "postgres-local", ...result });
  } catch (error) {
    return Response.json({ error: String(error?.message || "Não foi possível executar a chamada.") }, { status: 400 });
  }
}
