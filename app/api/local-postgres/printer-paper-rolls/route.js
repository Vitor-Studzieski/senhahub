import {
  PAPER_ROLL_CAPACITY,
  PAPER_ROLL_MAX_INITIAL_COUNT,
  PAPER_ROLL_URGENT_AT,
  PAPER_ROLL_WARNING_AT,
  buildPrinterPaperStatus,
  parsePrinterPaperKey
} from "../../../../server/kiosk/paper-roll.js";
import { query, withTransaction } from "../../../../server/data/local-postgres.js";
import { readJson, requireCsrf, requireLocalUser } from "../../../../server/platform/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { response } = await requireLocalUser(request, ["manager", "admin"]);
  if (response) return response;
  try {
    const [printerResult, eventResult, reviewResult] = await Promise.all([
      query(`SELECT kiosk.id, kiosk.name, kiosk.printer_name, kiosk.active, kiosk.sector_id,
                    sector.name AS sector_name
             FROM public.print_kiosks AS kiosk
             LEFT JOIN public.sectors AS sector ON sector.id = kiosk.sector_id
             ORDER BY kiosk.printer_name, kiosk.id`),
      query(`
        SELECT DISTINCT ON (printer_key)
               printer_key, printer_name, event_type, baseline_count,
               actor_name, created_at
        FROM public.print_paper_roll_events
        ORDER BY printer_key, created_at DESC, id DESC
      `),
      query("SELECT kiosk_id FROM public.print_jobs WHERE status = 'needs_review'")
    ]);
    const events = eventResult.rows;
    const earliestEvent = events
      .map((event) => event.created_at)
      .sort((left, right) => new Date(left) - new Date(right))[0];
    const printedResult = earliestEvent
      ? await query(
          `SELECT kiosk_id, payload, updated_at
           FROM public.print_jobs
           WHERE status = 'printed' AND updated_at >= $1
           ORDER BY updated_at, id`,
          [earliestEvent]
        )
      : { rows: [] };

    return Response.json({
      source: "postgres-local",
      capacity: PAPER_ROLL_CAPACITY,
      warningAt: PAPER_ROLL_WARNING_AT,
      urgentAt: PAPER_ROLL_URGENT_AT,
      printers: buildPrinterPaperStatus({
        printers: printerResult.rows,
        events,
        printedJobs: printedResult.rows,
        reviewJobs: reviewResult.rows
      }),
      generatedAt: new Date().toISOString()
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Falha ao consultar contadores de bobina:", error.message);
    return Response.json({ error: "Não foi possível consultar o contador das bobinas." }, { status: 500 });
  }
}

export async function POST(request) {
  const { session, response } = await requireLocalUser(request, ["manager", "admin"]);
  if (response) return response;
  const csrfResponse = requireCsrf(request, session);
  if (csrfResponse) return csrfResponse;

  const body = await readJson(request);
  const action = String(body?.action || "");
  const printerKey = String(body?.printerKey || "");
  const kioskId = parsePrinterPaperKey(printerKey);
  const requestId = String(body?.requestId || "");
  if (!kioskId || !UUID_PATTERN.test(requestId) || !["initialize", "replace"].includes(action)) {
    return Response.json({ error: "Dados para registrar a bobina inválidos." }, { status: 400 });
  }

  let baselineCount = 0;
  if (action === "initialize") {
    const rawCount = body?.initialCount;
    baselineCount = Number(rawCount);
    if (rawCount === undefined || rawCount === null || String(rawCount).trim() === ""
      || !Number.isInteger(baselineCount) || baselineCount < 0 || baselineCount > PAPER_ROLL_MAX_INITIAL_COUNT) {
      return Response.json({ error: `Informe uma estimativa entre 0 e ${PAPER_ROLL_MAX_INITIAL_COUNT} senhas.` }, { status: 400 });
    }
  }

  try {
    const result = await withTransaction(async (client) => {
      const printerResult = await client.query(
        "SELECT id, printer_name FROM public.print_kiosks WHERE id = $1 FOR UPDATE",
        [kioskId]
      );
      const printer = printerResult.rows[0];
      if (!printer) return { status: 404, error: "Impressora não encontrada." };

      const duplicateResult = await client.query(
        `SELECT printer_key, event_type, actor_id
         FROM public.print_paper_roll_events
         WHERE request_id = $1
         LIMIT 1`,
        [requestId]
      );
      const duplicate = duplicateResult.rows[0];
      if (duplicate) {
        const sameOperation = duplicate.printer_key === printerKey
          && duplicate.event_type === (action === "initialize" ? "initialized" : "replaced")
          && duplicate.actor_id === String(session.user.id);
        return sameOperation
          ? { ok: true, repeated: true }
          : { status: 409, error: "Este pedido já foi usado para outra operação." };
      }

      const latestResult = await client.query(
        `SELECT event_type
         FROM public.print_paper_roll_events
         WHERE printer_key = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [printerKey]
      );
      const latestEvent = latestResult.rows[0] || null;
      if ((action === "initialize" && latestEvent) || (action === "replace" && !latestEvent)) {
        return {
          status: 409,
          error: action === "initialize"
            ? "O contador desta impressora já foi iniciado. Atualize a dashboard."
            : "Inicie o contador antes de registrar uma troca."
        };
      }

      const reviewResult = await client.query(
        "SELECT id FROM public.print_jobs WHERE kiosk_id = $1 AND status = 'needs_review' LIMIT 1",
        [kioskId]
      );
      if (reviewResult.rowCount) {
        return { status: 409, error: "Resolva as impressões em conferência antes de iniciar ou trocar a bobina." };
      }

      await client.query(
        `INSERT INTO public.print_paper_roll_events
           (id, printer_key, printer_name, event_type, baseline_count, actor_id, actor_name, request_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [
          printerKey,
          printer.printer_name || "Impressora",
          action === "initialize" ? "initialized" : "replaced",
          baselineCount,
          String(session.user.id),
          String(session.user.name || session.user.email || "Gerente").slice(0, 160),
          requestId
        ]
      );
      return { ok: true };
    });

    if (result.status) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result, { status: result.repeated ? 200 : 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Falha ao registrar troca de bobina:", error.message);
    return Response.json({ error: "Não foi possível registrar a troca da bobina." }, { status: 500 });
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
