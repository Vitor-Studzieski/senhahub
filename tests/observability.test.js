const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createRequestContext,
  createRequestId,
  durationMs,
  summarizePrintAttempts
} = require("../server/platform/observability");

test("preserva um request ID válido e rejeita cabeçalhos inseguros", () => {
  assert.equal(createRequestId({ "x-request-id": "req-123_abc" }), "req-123_abc");
  assert.match(createRequestId({ "x-request-id": "valor com espaco" }), /^[0-9a-f-]{36}$/);
});

test("usa x-vercel-id quando não há request ID da aplicação", () => {
  assert.equal(createRequestId({ "x-vercel-id": "gru1::deployment-abc" }), "gru1::deployment-abc");
});

test("cria contexto com rota, método e relógio de início", () => {
  const context = createRequestContext({
    method: "GET",
    path: "/api/observability",
    headers: { "x-request-id": "admin-check-1" }
  });
  assert.equal(context.requestId, "admin-check-1");
  assert.equal(context.method, "GET");
  assert.equal(context.path, "/api/observability");
  assert.ok(Number.isFinite(context.startedAt));
});

test("habilita correlação de carga somente com configuração explícita e valida IDs", () => {
  const previous = process.env.LOAD_TEST_INSTRUMENTATION_ENABLED;
  try {
    delete process.env.LOAD_TEST_INSTRUMENTATION_ENABLED;
    const disabled = createRequestContext({ headers: { "x-load-test-run-id": "run-2026-09-14" } });
    assert.equal(disabled.loadTestRunId, null);

    process.env.LOAD_TEST_INSTRUMENTATION_ENABLED = "1";
    const enabled = createRequestContext({ headers: {
      "x-load-test-run-id": "run-2026-09-14",
      "x-load-test-user-id": "customer-001"
    } });
    assert.equal(enabled.loadTestRunId, "run-2026-09-14");
    assert.equal(enabled.testUserId, "customer-001");

    const invalid = createRequestContext({ headers: {
      "x-load-test-run-id": "run id with spaces",
      "x-load-test-user-id": "customer id"
    } });
    assert.equal(invalid.loadTestRunId, null);
    assert.equal(invalid.testUserId, null);
  } finally {
    if (previous === undefined) delete process.env.LOAD_TEST_INSTRUMENTATION_ENABLED;
    else process.env.LOAD_TEST_INSTRUMENTATION_ENABLED = previous;
  }
});

test("calcula duração e resumo das tentativas de impressão", () => {
  assert.equal(durationMs("2026-08-16T10:00:00.000Z", "2026-08-16T10:00:00.250Z"), 250);
  const summary = summarizePrintAttempts([
    { job_id: "job-1", attempt_number: 1, duration_ms: 100, status: "failed" },
    { job_id: "job-1", attempt_number: 2, duration_ms: 200, status: "printed" },
    { job_id: "job-2", attempt_number: 1, duration_ms: 300, status: "printed" },
    { job_id: "job-3", attempt_number: 1, duration_ms: null, status: "printing" }
  ]);
  assert.deepEqual(summary, {
    totalAttempts: 4,
    completedAttempts: 3,
    reprocessedJobs: 1,
    averageDurationMs: 200,
    p95DurationMs: 300
  });
});
