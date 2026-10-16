const crypto = require("node:crypto");

const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_BASE_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MAX_MS = 60 * 60 * 1000;
const LOGIN_LOCK_RESET_MS = 24 * 60 * 60 * 1000;
const LOGIN_IP_RATE_LIMIT = 10;
const LOGIN_IP_RATE_WINDOW_SECONDS = 60;
const LOGIN_IP_BURST_LIMIT = 3;
const LOGIN_IP_BURST_WINDOW_SECONDS = 10;

function loginAccountAttemptKey(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return null;
  const digest = crypto.createHash("sha256").update(normalizedEmail).digest("hex");
  return `login:account:${digest}`;
}

function calculateAccountLoginFailure(previous, now = Date.now()) {
  const firstAttemptAt = epochMilliseconds(previous?.first_attempt_at);
  const lastFailureAt = epochMilliseconds(previous?.last_failure_at);
  const failureWindowIsActive = firstAttemptAt > 0 && now >= firstAttemptAt && now - firstAttemptAt < LOGIN_FAILURE_WINDOW_MS;
  const resetLockoutLevel = lastFailureAt > 0 && now - lastFailureAt >= LOGIN_LOCK_RESET_MS;
  let lockoutLevel = resetLockoutLevel ? 0 : Math.max(0, Number(previous?.lockout_level) || 0);
  let count = failureWindowIsActive ? Math.max(0, Number(previous?.count) || 0) + 1 : 1;
  let windowStartedAt = failureWindowIsActive ? firstAttemptAt : now;
  let lockedUntil = 0;

  if (count >= LOGIN_FAILURE_LIMIT) {
    lockoutLevel += 1;
    const lockDuration = Math.min(LOGIN_LOCK_MAX_MS, LOGIN_LOCK_BASE_MS * (2 ** Math.min(lockoutLevel - 1, 10)));
    lockedUntil = now + lockDuration;
    count = 0;
    windowStartedAt = now;
  }

  return {
    count,
    firstAttemptAt: windowStartedAt,
    lastFailureAt: now,
    lockoutLevel,
    lockedUntil
  };
}

function epochMilliseconds(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  const normalized = String(value || "").trim();
  if (!normalized) return 0;
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized) || 0;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

module.exports = {
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_MS,
  LOGIN_IP_BURST_LIMIT,
  LOGIN_IP_BURST_WINDOW_SECONDS,
  LOGIN_IP_RATE_LIMIT,
  LOGIN_IP_RATE_WINDOW_SECONDS,
  calculateAccountLoginFailure,
  loginAccountAttemptKey
};
