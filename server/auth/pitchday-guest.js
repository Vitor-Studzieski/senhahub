const crypto = require("node:crypto");

const PITCHDAY_GUEST_COOKIE = "senhahub_pitchday_guest";
const PITCHDAY_GUEST_TTL_SECONDS = 7 * 24 * 60 * 60;

function createPitchdayGuestToken({ customerId, deviceId }, secret, now = Date.now()) {
  const payload = {
    purpose: "pitchday-guest",
    customerId: String(customerId || ""),
    deviceId: String(deviceId || ""),
    expiresAt: now + PITCHDAY_GUEST_TTL_SECONDS * 1000
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `pitchday.${encoded}.${sign(encoded, secret)}`;
}

function verifyPitchdayGuestToken(token, secret, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "pitchday") return null;
  const [, encoded, signature] = parts;
  if (!safeEqual(signature, sign(encoded, secret))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload.purpose !== "pitchday-guest"
      || !isUuid(payload.customerId)
      || !/^device-[a-f0-9-]{36}$/i.test(payload.deviceId)
      || !Number.isFinite(payload.expiresAt)
      || payload.expiresAt <= now) return null;
    return { customerId: payload.customerId, deviceId: payload.deviceId };
  } catch {
    return null;
  }
}

function pitchdayGuestCookie(token, secure = false) {
  return `${PITCHDAY_GUEST_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${PITCHDAY_GUEST_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function sign(value, secret) {
  return crypto.createHmac("sha256", String(secret || "")).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length > 0
    && leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
  PITCHDAY_GUEST_COOKIE,
  PITCHDAY_GUEST_TTL_SECONDS,
  createPitchdayGuestToken,
  pitchdayGuestCookie,
  verifyPitchdayGuestToken
};
