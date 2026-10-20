import { markLocalPushClicked } from "../../../../../server/data/local-repository.js";
import { requireCsrf, requireLocalUser, readJson } from "../../../../../server/platform/local-route-helpers.js";

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

export async function POST(request) {
  if (!sameOrigin(request)) return Response.json({ error: "Origem não autorizada." }, { status: 403 });
  const result = await requireLocalUser(request, ["customer"]);
  if (result.response) return result.response;
  const csrfError = requireCsrf(request, result.session);
  if (csrfError) return csrfError;
  const body = await readJson(request);
  if (!body?.eventId) return Response.json({ error: "Evento não informado." }, { status: 400 });
  try {
    return Response.json(await markLocalPushClicked(result.session.user.id, body.eventId));
  } catch (error) {
    return Response.json({ error: String(error?.message || "Não foi possível registrar a abertura.") }, { status: 400 });
  }
}
