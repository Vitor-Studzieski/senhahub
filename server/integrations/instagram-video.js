const INSTAGRAM_TIMEOUT_MS = 8000;
const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);

function normalizeInstagramPostUrl(value) {
  const url = new URL(String(value || "").trim());
  const hostname = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (url.protocol !== "https:" || !INSTAGRAM_HOSTS.has(hostname) || segments.length !== 2 || !["p", "reel", "tv"].includes(segments[0])) {
    throw new Error("Publicação do Instagram inválida.");
  }

  return `https://www.instagram.com/${segments[0]}/${segments[1]}/`;
}

function decodeInstagramValue(value) {
  let decoded = String(value || "");
  for (let index = 0; index < 3; index += 1) {
    decoded = decoded
      .replace(/\\+u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
      .replace(/\\+\//g, "/");
  }
  return decoded.replace(/&amp;/g, "&");
}

function isAllowedVideoUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(?:^|\.)(?:fbcdn\.net|cdninstagram\.com)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function extractVideoUrl(html) {
  const candidates = [
    html.match(/video_url\\?":\\?"(https?:.+?)\\?"/)?.[1],
    html.match(/property=["']og:video["'][^>]*content=["']([^"']+)/i)?.[1]
  ];

  for (const candidate of candidates) {
    const videoUrl = decodeInstagramValue(candidate);
    if (isAllowedVideoUrl(videoUrl)) return videoUrl;
  }

  throw new Error("Vídeo do Instagram não encontrado.");
}

async function resolveInstagramVideoUrl(source) {
  const postUrl = normalizeInstagramPostUrl(source);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INSTAGRAM_TIMEOUT_MS);

  try {
    const response = await fetch(`${postUrl}embed/`, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0"
      },
      signal: controller.signal
    });
    const html = await response.text();
    if (!response.ok) throw new Error("Publicação do Instagram indisponível.");
    return extractVideoUrl(html);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchInstagramVideo(source, range = "") {
  const videoUrl = await resolveInstagramVideoUrl(source);
  const headers = { accept: "video/mp4" };
  if (range) headers.range = range;
  const response = await fetch(videoUrl, { headers });
  if (!response.ok || !response.body) throw new Error("Vídeo do Instagram indisponível.");
  return response;
}

module.exports = { fetchInstagramVideo, resolveInstagramVideoUrl };
