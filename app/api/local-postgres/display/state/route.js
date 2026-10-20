import { getLocalDisplayState } from "../../../../../server/data/local-repository.js";
import { requireLocalUser } from "../../../../../server/platform/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const result = await requireLocalUser(request);
  if (result.response) return result.response;
  const sessionUser = result.session.user;
  const isPitchdayTvAccount = String(sessionUser?.email || "").trim().toLowerCase() === "pitchday@superpompeia.com"
    && sessionUser?.role === "tablet";
  if (!isPitchdayTvAccount && !["tv", "attendant", "manager", "admin"].includes(sessionUser?.role)) {
    return Response.json({ error: "Acesso negado." }, { status: 403 });
  }
  if (isPitchdayTvAccount && !(sessionUser.sectorIds || []).includes("pitch-day")) {
    return Response.json({ error: "Esta conta não está vinculada ao setor Pitch Day." }, { status: 403 });
  }
  const user = isPitchdayTvAccount
    ? { ...sessionUser, role: "tv", sectorIds: ["pitch-day"] }
    : sessionUser;

  try {
    return Response.json({
      source: "postgres-local",
      ...(await getLocalDisplayState(user))
    }, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    console.error("Falha ao consultar o estado da TV do açougue:", error.message);
    return Response.json({ error: "Não foi possível carregar a fila do açougue." }, { status: 500 });
  }
}
