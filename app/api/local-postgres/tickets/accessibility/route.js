import { recordLocalAccessibilityEvents } from "../../../../../server/data/local-repository.js";
import { requireCsrf, readJson, requireLocalUser } from "../../../../../server/platform/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const result = await requireLocalUser(request, ["attendant", "manager", "admin"]);
  if (result.response) return result.response;
  const csrfError = requireCsrf(request, result.session);
  if (csrfError) return csrfError;
  const body = await readJson(request);
  if (!body) return Response.json({ error: "O corpo da requisição precisa ser um JSON válido." }, { status: 400 });
  try {
    return Response.json(await recordLocalAccessibilityEvents(body.ticketId, result.session.user, body.supports, body.action));
  } catch (error) {
    return Response.json({ error: String(error?.message || "Não foi possível registrar os recursos usados.") }, { status: 400 });
  }
}
