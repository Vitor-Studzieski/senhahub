import {
  authenticateLocalRequest,
  hasValidCsrf
} from "../../../../../server/auth/local-http-auth.js";
import {
  confirmLocalTabletRawbtPrint,
  getLocalTabletPrintJob
} from "../../../../../server/kiosk/local-kiosk.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }

  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessão não encontrada." }, { status: 401 });
  if (session.user.role !== "tablet") return Response.json({ error: "Acesso negado." }, { status: 403 });

  const requestUrl = new URL(request.url);
  const pathMatch = requestUrl.pathname.match(/^\/api\/(?:local-postgres\/)?tablet\/print-jobs\/([^/]+)$/);
  const jobId = pathMatch ? decodeURIComponent(pathMatch[1]) : requestUrl.searchParams.get("jobId");
  if (!jobId || !/^[0-9a-f-]{20,}$/i.test(jobId)) {
    return Response.json({ error: "Trabalho de impressão inválido." }, { status: 400 });
  }

  try {
    const job = await getLocalTabletPrintJob(session.user, jobId);
    return job
      ? Response.json({ job }, { headers: { "cache-control": "no-store" } })
      : Response.json({ error: "Trabalho de impressão não encontrado." }, { status: 404 });
  } catch (error) {
    console.error("Falha ao consultar trabalho de impressão do tablet:", error.message);
    return Response.json({ error: "Não foi possível consultar a impressão." }, { status: 500 });
  }
}

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }

  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessão não encontrada." }, { status: 401 });
  if (session.user.role !== "tablet") return Response.json({ error: "Acesso negado." }, { status: 403 });
  if (!hasValidCsrf(request, session)) return Response.json({ error: "Token CSRF inválido." }, { status: 403 });

  const requestUrl = new URL(request.url);
  const pathMatch = requestUrl.pathname.match(/^\/api\/(?:local-postgres\/)?tablet\/print-jobs\/([^/]+)\/rawbt$/);
  const jobId = pathMatch ? decodeURIComponent(pathMatch[1]) : requestUrl.searchParams.get("jobId");
  if (!jobId || !/^[0-9a-f-]{20,}$/i.test(jobId)) {
    return Response.json({ error: "Trabalho de impressão inválido." }, { status: 400 });
  }

  try {
    const job = await confirmLocalTabletRawbtPrint(session.user, jobId);
    return Response.json({ transport: "rawbt", job }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = String(error?.message || "Não foi possível preparar a impressão.");
    const status = /não encontrado|já está sendo processado/i.test(message) ? 409 : 500;
    console.error("Falha ao confirmar impressão RawBT no PostgreSQL local:", message);
    return Response.json({ error: status === 409 ? message : "Não foi possível preparar a impressão." }, { status });
  }
}
