const crypto = require("node:crypto");

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const LOAD_TEST_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LOAD_TEST_USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  return String(headers[name] || headers[name.toLowerCase()] || "");
}

function createRequestId(headers) {
  const supplied = headerValue(headers, "x-request-id").trim();
  if (REQUEST_ID_PATTERN.test(supplied)) return supplied;

  const vercelId = headerValue(headers, "x-vercel-id").trim();
  if (REQUEST_ID_PATTERN.test(vercelId)) return vercelId;

  return crypto.randomUUID();
}

function createRequestContext({ method, path, headers } = {}) {
  const loadTestRunId = headerValue(headers, "x-load-test-run-id").trim();
  const requestedTestUserId = headerValue(headers, "x-load-test-user-id").trim();
  const loadTestInstrumentationEnabled = process.env.LOAD_TEST_INSTRUMENTATION_ENABLED === "1";
  return {
    requestId: createRequestId(headers),
    method: String(method || "GET"),
    path: String(path || ""),
    startedAt: Date.now(),
    loadTestRunId: loadTestInstrumentationEnabled && LOAD_TEST_RUN_ID_PATTERN.test(loadTestRunId) ? loadTestRunId : null,
    testUserId: loadTestInstrumentationEnabled && LOAD_TEST_USER_ID_PATTERN.test(requestedTestUserId) ? requestedTestUserId : null,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    runtime: process.env.NEXT_RUNTIME || "nodejs",
    region: process.env.VERCEL_REGION || null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || null,
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    ticketId: null
  };
}

function loadTestLogFields(context) {
  if (!context?.loadTestRunId) return {};
  return {
    load_test_run_id: context.loadTestRunId,
    test_user_id: context.testUserId || null,
    ticket_id: context.ticketId || null,
    environment: context.environment,
    runtime: context.runtime,
    region: context.region,
    deployment_id: context.deploymentId,
    commit_sha: context.commitSha
  };
}

function logStructured(level, event, fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields
  };
  const writer = level === "error" || level === "warn" ? console.error : console.log;
  writer(JSON.stringify(entry));
  return entry;
}

function finishRequest(context, status, extra = {}) {
  if (!context) return null;
  const durationMs = Math.max(0, Date.now() - context.startedAt);
  return logStructured(status >= 500 ? "error" : "info", "request.finished", {
    requestId: context.requestId,
    method: context.method,
    path: context.path,
    status,
    durationMs,
    ...loadTestLogFields(context),
    ...extra
  });
}

function errorDetails(error) {
  return {
    errorCode: error?.code || "INTERNAL_ERROR",
    errorMessage: String(error?.message || error || "Erro interno").slice(0, 500)
  };
}

async function dispatchObservabilityAlert({ event, severity = "error", requestId, ...fields }) {
  const payload = {
    event,
    severity,
    requestId: requestId || null,
    occurredAt: new Date().toISOString(),
    ...fields
  };

  logStructured(severity === "error" ? "error" : "warn", "operational.alert", payload);

  const webhookUrl = String(process.env.OBSERVABILITY_ALERT_WEBHOOK_URL || "").trim();
  if (!webhookUrl) return { sent: false, configured: false };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        content: `[SenhaHub] ${severity.toUpperCase()} — ${event}`,
        ...payload
      })
    });
    if (!response.ok) {
      logStructured("warn", "operational.alert_delivery_failed", {
        event,
        status: response.status,
        requestId: requestId || null
      });
      return { sent: false, configured: true, status: response.status };
    }
    logStructured("info", "operational.alert_delivered", { event, requestId: requestId || null });
    return { sent: true, configured: true };
  } catch (error) {
    logStructured("warn", "operational.alert_delivery_failed", {
      event,
      requestId: requestId || null,
      ...errorDetails(error)
    });
    return { sent: false, configured: true };
  }
}

function durationMs(startedAt, finishedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!clean.length) return 0;
  return Math.round(clean.reduce((total, value) => total + value, 0) / clean.length);
}

function percentile(values, percentileValue = 0.95) {
  const clean = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil(clean.length * percentileValue) - 1));
  return Math.round(clean[index]);
}

function summarizePrintAttempts(attempts = []) {
  const completed = attempts.filter((attempt) =>
    attempt.duration_ms !== null &&
    attempt.duration_ms !== undefined &&
    Number.isFinite(Number(attempt.duration_ms))
  );
  const durations = completed.map((attempt) => Number(attempt.duration_ms));
  const reprocessedJobs = new Set(
    attempts
      .filter((attempt) => Number(attempt.attempt_number) > 1)
      .map((attempt) => attempt.job_id)
  );
  return {
    totalAttempts: attempts.length,
    completedAttempts: completed.length,
    reprocessedJobs: reprocessedJobs.size,
    averageDurationMs: average(durations),
    p95DurationMs: percentile(durations)
  };
}

module.exports = {
  average,
  createRequestContext,
  createRequestId,
  dispatchObservabilityAlert,
  durationMs,
  errorDetails,
  finishRequest,
  loadTestLogFields,
  logStructured,
  summarizePrintAttempts
};
