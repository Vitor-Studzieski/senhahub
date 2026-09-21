import { getLocalDisplayState } from "../../../../../server/data/local-repository.js";
import { requireLocalUser } from "../../../../../server/platform/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const user = await requireLocalUser(request, ["tv", "attendant", "manager", "admin"]);
  if (user.response) return user.response;

  try {
    return Response.json({
      source: "postgres-local",
      ...(await getLocalDisplayState(user.session.user))
    }, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    console.error("Falha ao consultar o estado da TV do açougue:", error.message);
    return Response.json({ error: "Não foi possível carregar a fila do açougue." }, { status: 500 });
  }
}
