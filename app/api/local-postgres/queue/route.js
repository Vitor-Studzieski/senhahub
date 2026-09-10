import { getLocalStaffState } from "../../../../server/data/local-repository.js";
import { requireLocalUser } from "../../../../server/platform/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const user = await requireLocalUser(request, ["attendant", "manager", "admin"]);
  if (user.response) return user.response;

  try {
    return Response.json({
      source: "postgres-local",
      ...(await getLocalStaffState(user.session.user))
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Falha ao consultar a fila no PostgreSQL local:", error.message);
    return Response.json(
      { error: "Não foi possível consultar o PostgreSQL local." },
      { status: 500 }
    );
  }
}
