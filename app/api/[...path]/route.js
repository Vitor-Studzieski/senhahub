export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function route(request) {
  if (process.env.DATA_BACKEND !== "supabase") {
    return Response.json({
      error: "A API oficial usa exclusivamente o Supabase. Configure DATA_BACKEND=supabase."
    }, { status: 503 });
  }

  const backend = await import("../../../server/integrations/supabase-runtime.js");
  return backend.handleRequest(request);
}

export const GET = route;
export const POST = route;
export const PUT = route;
export const PATCH = route;
export const DELETE = route;
