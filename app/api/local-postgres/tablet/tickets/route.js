import {
  authenticateLocalRequest,
  hasValidCsrf
} from "../../../../../server/auth/local-http-auth.js";
import { issueLocalPhysicalTicketForTablet } from "../../../../../server/kiosk/local-kiosk.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }

  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessão não encontrada." }, { status: 401 });
  if (session.user.role !== "tablet") return Response.json({ error: "Acesso negado." }, { status: 403 });
  if (!hasValidCsrf(request, session)) return Response.json({ error: "Token CSRF inválido." }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "O corpo da requisição precisa ser um JSON válido." }, { status: 400 });
  }

  try {
    const result = await issueLocalPhysicalTicketForTablet(session.user, body);
    return Response.json({
      source: "postgres-local",
      ticket: result.ticket,
      tickets: [result.ticket],
      printJob: result.printJob,
      alreadyExists: result.alreadyExists
    }, { status: result.alreadyExists ? 200 : 201 });
  } catch (error) {
    const message = String(error?.message || "Não foi possível emitir a senha.");
    const clientError = /obrigatório|inválido|não encontrado|inativo|fechado|não pertence|não está vinculado|outra loja|impressora|configurad|Limite de|atingido|não pode/i.test(message);
    console.error("Falha ao emitir senha pelo tablet no PostgreSQL local:", message);
    return Response.json(
      { error: clientError ? message : "Não foi possível emitir a senha." },
      { status: clientError ? 400 : 500 }
    );
  }
}
