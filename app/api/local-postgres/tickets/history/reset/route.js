import { resetLocalTicketHistory } from "../../../../../../server/data/local-legacy.js";
import { requireCsrf, requireLocalUser } from "../../../../../../server/platform/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const user = await requireLocalUser(request, ["manager", "admin"]);
  if (user.response) return user.response;
  const csrfError = requireCsrf(request, user.session);
  if (csrfError) return csrfError;

  try {
    const result = await resetLocalTicketHistory(user.session.user.id);
    return Response.json({ source: "postgres-local", ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Falha ao limpar histórico local de senhas:", error.message);
    return Response.json({ error: "Não foi possível limpar o histórico de senhas." }, { status: 500 });
  }
}
