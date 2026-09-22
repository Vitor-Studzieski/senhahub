const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { spawn } = require("node:child_process");
const ffmpeg = require("@ffmpeg-installer/ffmpeg");

const MAX_TRANSCODE_BYTES = 512 * 1024 * 1024;
const TRANSCODE_TOTAL_TIMEOUT_MS = 50_000;
const TRANSCODE_PHASE_TIMEOUT_MS = 30_000;

function buildFfmpegArgs(inputPath, outputPath) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    "scale=w='min(720,iw)':h=-2,format=yuv420p",
    "-c:v",
    "libx264",
    "-profile:v",
    "baseline",
    "-level",
    "3.1",
    "-preset",
    "veryfast",
    "-crf",
    "24",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    outputPath
  ];
}

async function transcodeSupabaseVideo({ supabaseUrl, serviceRoleKey, bucket, sourceStoragePath, targetStoragePath }) {
  if (!ffmpeg.path) throw new Error("FFmpeg não está disponível neste ambiente.");
  if (!supabaseUrl || !serviceRoleKey || !bucket || !sourceStoragePath || !targetStoragePath) {
    throw new Error("Configuração incompleta para conversão do vídeo.");
  }

  const temporaryDir = await fsp.mkdtemp(path.join(os.tmpdir(), "senhahub-tv-media-"));
  const inputPath = path.join(temporaryDir, "source");
  const outputPath = path.join(temporaryDir, "tv-compatible.mp4");
  const deadline = Date.now() + TRANSCODE_TOTAL_TIMEOUT_MS;

  try {
    await downloadStorageObject({ supabaseUrl, serviceRoleKey, bucket, storagePath: sourceStoragePath, destination: inputPath, deadline });
    await runFfmpeg(inputPath, outputPath, deadline);
    const outputStats = await fsp.stat(outputPath);
    if (!outputStats.isFile() || outputStats.size <= 0 || outputStats.size > MAX_TRANSCODE_BYTES) {
      throw new Error("O vídeo convertido ficou inválido ou excedeu o limite permitido.");
    }
    await uploadStorageObject({ supabaseUrl, serviceRoleKey, bucket, storagePath: targetStoragePath, source: outputPath, fileSize: outputStats.size, deadline });
    return { fileSize: outputStats.size, mimeType: "video/mp4", storagePath: targetStoragePath };
  } finally {
    await fsp.rm(temporaryDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadStorageObject({ supabaseUrl, serviceRoleKey, bucket, storagePath, destination, deadline }) {
  const response = await fetch(storageObjectUrl(supabaseUrl, bucket, storagePath), {
    headers: storageHeaders(serviceRoleKey),
    signal: AbortSignal.timeout(remainingTime(deadline))
  });
  if (!response.ok || !response.body) {
    throw new Error(`Não foi possível ler o vídeo enviado (Storage ${response.status}).`);
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_TRANSCODE_BYTES) throw new Error("O vídeo enviado excede o limite permitido.");
  await pipeline(response.body, fs.createWriteStream(destination, { flags: "wx" }));
  const stats = await fsp.stat(destination);
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_TRANSCODE_BYTES) {
    throw new Error("O vídeo enviado ficou inválido ou excedeu o limite permitido.");
  }
}

async function uploadStorageObject({ supabaseUrl, serviceRoleKey, bucket, storagePath, source, fileSize, deadline }) {
  const response = await fetch(storageObjectUrl(supabaseUrl, bucket, storagePath), {
    method: "POST",
    headers: {
      ...storageHeaders(serviceRoleKey),
      "content-type": "video/mp4",
      "content-length": String(fileSize),
      "cache-control": "3600",
      "x-upsert": "true"
    },
    body: fs.createReadStream(source),
    duplex: "half",
    signal: AbortSignal.timeout(remainingTime(deadline))
  });
  if (!response.ok) throw new Error(`Não foi possível publicar o vídeo convertido (Storage ${response.status}).`);
}

function runFfmpeg(inputPath, outputPath, deadline) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg.path, buildFfmpegArgs(inputPath, outputPath), {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("A conversão do vídeo excedeu o tempo limite."));
    }, remainingTime(deadline));

    child.stderr.on("data", (chunk) => {
      if (stderr.length < 12_000) stderr += String(chunk);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (code === 0) return finish(null);
      finish(new Error(stderr.trim() || `FFmpeg encerrou com código ${code}.`));
    });

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    }
  });
}

function remainingTime(deadline) {
  const remaining = Number(deadline) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("A conversão do vídeo excedeu o tempo limite.");
  return Math.min(TRANSCODE_PHASE_TIMEOUT_MS, remaining);
}

function storageObjectUrl(supabaseUrl, bucket, storagePath) {
  const encodedPath = [bucket, ...String(storagePath).split("/")].map(encodeURIComponent).join("/");
  return `${String(supabaseUrl).replace(/\/+$/, "")}/storage/v1/object/${encodedPath}`;
}

function storageHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`
  };
}

module.exports = {
  buildFfmpegArgs,
  transcodeSupabaseVideo
};
