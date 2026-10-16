export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function route(request) {
  if (process.env.DATA_BACKEND === "supabase") {
    const backend = await import("../../../server/integrations/supabase-runtime.js");
    return backend.handleRequest(request);
  }

  if (process.env.DATA_BACKEND === "local-postgres" && process.env.LOCAL_POSTGRES_ROUTES_ENABLED === "1") {
    const backend = await import("../local-postgres/printer-paper-rolls/route.js");
    return backend[request.method](request);
  }

  return Response.json({ error: "Rota de contador de bobinas desativada." }, { status: 503 });
}

export const GET = route;
export const POST = route;
