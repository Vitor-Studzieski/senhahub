import { NextResponse } from "next/server";

const pageRoles = {
  "/": ["customer", "manager", "admin"],
  "/attendant": ["attendant", "manager", "admin"],
  "/admin": ["manager", "admin"],
  "/admin/operacao": ["manager", "admin"],
  "/admin/setores": ["manager", "admin"],
  "/admin/totens": ["manager", "admin"],
  "/admin/usuarios": ["manager", "admin"],
  "/tablet": ["tablet", "attendant"],
  "/tv/acougue": ["tv", "attendant", "manager", "admin"]
};
const legacyPageRedirects = {
  "/index.html": "/",
  "/login.html": "/login",
  "/attendant.html": "/attendant",
  "/admin.html": "/admin",
  "/admin-operacao.html": "/admin/operacao",
  "/admin-setores.html": "/admin/setores",
  "/admin-totens.html": "/admin/totens",
  "/admin-usuarios.html": "/admin/usuarios",
  "/totem.html": "/totem",
  "/tv-acougue.html": "/tv/acougue",
  "/install.html": "/instalar",
  "/acompanhar.html": "/login"
};

export async function proxy(request) {
  const pathname = normalizePathname(request.nextUrl.pathname);
  const legacyTarget = legacyPageRedirects[pathname];
  if (legacyTarget) {
    const target = request.nextUrl.clone();
    target.pathname = legacyTarget;
    return NextResponse.redirect(target);
  }

  if ((pathname === "/totem" || pathname.startsWith("/totem/")) && !(await hasValidKioskSession(request))) {
    const user = await loadCurrentUser(request);
    if (!user) return redirectToLogin(request, pathname);
    if (!hasManagerRole(user)) return NextResponse.redirect(new URL(roleHome(user), request.url));
    return allowPage(request);
  }

  const roles = rolesForPath(pathname);
  if (!roles) return allowPage(request);

  // The signed cookie is only a bearer credential. The role is read again
  // through the protected API so a role/status change is not accepted until
  // the next long-lived cookie refresh.
  const user = await loadCurrentUser(request);
  if (user && roles.includes(normalizeRole(user.role))) return allowPage(request);
  if (user) {
    if (pathname === "/tablet") return redirectToLogin(request, pathname);
    return NextResponse.redirect(new URL(roleHome(user), request.url));
  }

  return redirectToLogin(request, pathname);
}

function rolesForPath(pathname) {
  if (pageRoles[pathname]) return pageRoles[pathname];
  if (pathname === "/attendant" || pathname.startsWith("/attendant/")) return ["attendant", "manager", "admin"];
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return ["manager", "admin"];
  if (pathname === "/tv/acougue") return ["tv", "attendant", "manager", "admin"];
  if (pathname === "/") return pageRoles["/"];
  return null;
}

function normalizePathname(pathname) {
  const normalized = String(pathname || "/").replace(/\/+$/, "");
  return normalized || "/";
}

function redirectToLogin(request, pathname) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

function allowPage(request) {
  const nonce = createNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", contentSecurityPolicy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

function createNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function buildContentSecurityPolicy(nonce) {
  const development = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' https://fonts.googleapis.com",
    "img-src 'self' data: https://source.unsplash.com https://images.unsplash.com",
    `connect-src 'self' https://api.open-meteo.com https://fonts.googleapis.com${development ? " ws: http://localhost:*" : ""}`,
    "font-src 'self' https://fonts.gstatic.com",
    "worker-src 'self'",
    "media-src 'self' https://*.fbcdn.net https://*.cdninstagram.com data: blob:",
    "frame-src 'self' https://www.instagram.com",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}

function hasManagerRole(user) {
  return ["manager", "admin"].includes(normalizeRole(user?.role));
}

async function hasValidKioskSession(request) {
  const token = request.cookies.get("senhahub_kiosk")?.value || "";
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "kiosk") return false;
  const [, encoded, signature] = parts;
  if (!safeEqual(signature, await signValue(encoded))) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
    return Boolean(
      payload?.kioskId &&
      payload?.csrfToken &&
      payload?.sessionNonce &&
      new Date(payload.expiresAt).getTime() > Date.now()
    );
  } catch {
    return false;
  }
}

async function loadCurrentUser(request) {
  const sessionToken = request.cookies.get("senhahub_auth")?.value || "";
  const cookieHeader = request.cookies.toString() || request.headers.get("cookie") || "";
  try {
    const response = await fetch(new URL("/api/auth/me", request.url), {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      cache: "no-store"
    });
    if (response.ok) {
      const payload = await response.json();
      return payload?.user || null;
    }
    if (response.status < 500) return null;
  } catch {
    // O servidor local pode nao expor a API interna ao runtime do middleware.
  }
  const session = await verifySessionToken(sessionToken);
  return session?.user || null;
}

async function verifySessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "session") return null;
  const [, encoded, signature] = parts;
  const expected = await signValue(encoded);
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
    if (!payload.email || !payload.csrfToken || new Date(payload.expiresAt).getTime() <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function signValue(value) {
  const secret = authSecret();
  if (!secret) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function authSecret() {
  const secret = process.env.AUTH_SECRET || "";
  if (secret.length >= 32) return secret;
  if (process.env.NODE_ENV !== "production") return "senhahub-demo-auth-secret-change-before-production";
  return "";
}

function safeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeRole(role) {
  return role === "admin" ? "manager" : role;
}

function roleHome(user) {
  if (normalizeRole(user.role) === "tv") return "/tv/acougue";
  if (normalizeRole(user.role) === "tablet") return "/tablet";
  return normalizeRole(user.role) === "attendant" ? "/attendant" : "/";
}

export const config = {
  matcher: [
    "/",
    "/attendant/:path*",
    "/admin/:path*",
    "/tablet/:path*",
    "/tv/acougue",
    "/login",
    "/login/:path*",
    "/instalar",
    "/instalar/:path*",
    "/acompanhar/:path*",
    "/totem",
    "/totem/:path*",
    "/index.html",
    "/login.html",
    "/attendant.html",
    "/admin.html",
    "/admin-operacao.html",
    "/admin-setores.html",
    "/admin-totens.html",
    "/admin-usuarios.html",
    "/totem.html",
    "/install.html",
    "/acompanhar.html"
  ]
};
