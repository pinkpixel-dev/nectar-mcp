import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_TIMEOUT_MS, SERVER_USER_AGENT } from "./constants.js";

export interface SaveMediaOptions {
  output_dir?: string;
  filename_prefix?: string;
}

export interface SavedMediaFile {
  path: string;
  source: "base64" | "url";
  bytes: number;
  mediaType?: string;
  originalUrl?: string;
}

export interface SaveMediaResult {
  files: SavedMediaFile[];
  errors: string[];
}

interface PollinationsImageItem {
  url?: unknown;
  b64_json?: unknown;
}

const DEFAULT_OUTPUT_DIR = "nectar-output";

export async function saveImageGenerationResult(
  result: unknown,
  options: SaveMediaOptions = {}
): Promise<SaveMediaResult> {
  const data = getImageItems(result);
  const files: SavedMediaFile[] = [];
  const errors: string[] = [];

  for (const [index, item] of data.entries()) {
    if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
      try {
        files.push(await saveBase64Media(item.b64_json, { ...options, index }));
      } catch (error) {
        errors.push(formatSaveError("base64 image", error));
      }

      continue;
    }

    if (typeof item.url === "string" && item.url.length > 0) {
      try {
        files.push(await downloadMedia(item.url, { ...options, index }));
      } catch (error) {
        errors.push(formatSaveError(item.url, error));
      }
    }
  }

  return { files, errors };
}

export async function saveMediaUrl(
  url: string,
  options: SaveMediaOptions = {}
): Promise<SaveMediaResult> {
  try {
    const file = await downloadMedia(url, { ...options, index: 0 });
    return { files: [file], errors: [] };
  } catch (error) {
    return {
      files: [],
      errors: [formatSaveError(url, error)]
    };
  }
}

function getImageItems(result: unknown): PollinationsImageItem[] {
  if (!isRecord(result) || !Array.isArray(result.data)) {
    return [];
  }

  return result.data.filter(isRecord);
}

async function saveBase64Media(
  b64Json: string,
  options: SaveMediaOptions & { index: number }
): Promise<SavedMediaFile> {
  const buffer = Buffer.from(stripDataUrlPrefix(b64Json), "base64");
  const mediaType = mediaTypeFromBuffer(buffer);
  const extension = extensionFromMediaType(mediaType) ?? "bin";
  const filePath = await buildOutputPath(options, extension);

  await writeFile(filePath, buffer);

  return {
    path: filePath,
    source: "base64",
    bytes: buffer.byteLength,
    mediaType
  };
}

async function downloadMedia(
  url: string,
  options: SaveMediaOptions & { index: number }
): Promise<SavedMediaFile> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: downloadHeaders(url),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`download failed with HTTP ${response.status}`);
    }

    const declaredMediaType = response.headers.get("content-type")?.split(";")[0]?.trim();
    const buffer = Buffer.from(await response.arrayBuffer());
    const detectedMediaType = mediaTypeFromBuffer(buffer);
    const mediaType = declaredMediaType && declaredMediaType !== "application/octet-stream"
      ? declaredMediaType
      : detectedMediaType ?? declaredMediaType;
    const extension =
      extensionFromMediaType(mediaType) ??
      extensionFromUrl(url) ??
      extensionFromMediaType(detectedMediaType) ??
      "bin";
    const filePath = await buildOutputPath(options, extension);

    await writeFile(filePath, buffer);

    return {
      path: filePath,
      source: "url",
      bytes: buffer.byteLength,
      mediaType,
      originalUrl: url
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildOutputPath(
  options: SaveMediaOptions & { index: number },
  extension: string
): Promise<string> {
  const outputDir = path.resolve(options.output_dir ?? process.env.NECTAR_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR);
  const prefix = sanitizeFilenamePart(options.filename_prefix ?? "nectar");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${prefix}-${timestamp}-${options.index + 1}.${extension}`;

  await mkdir(outputDir, { recursive: true });
  return path.join(outputDir, fileName);
}

function stripDataUrlPrefix(value: string): string {
  return value.replace(/^data:[^;]+;base64,/, "");
}

function downloadHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": SERVER_USER_AGENT
  };

  if (isPollinationsUrl(url) && process.env.POLLINATIONS_API_KEY) {
    headers.Authorization = `Bearer ${process.env.POLLINATIONS_API_KEY}`;
  }

  return headers;
}

function isPollinationsUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "pollinations.ai" || hostname.endsWith(".pollinations.ai");
  } catch {
    return false;
  }
}

function mediaTypeFromBuffer(buffer: Buffer): string | undefined {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WAVE"
  ) {
    return "audio/wav";
  }

  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) {
    return "audio/aac";
  }

  if (
    buffer.subarray(0, 3).toString("ascii") === "ID3" ||
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  ) {
    return "audio/mpeg";
  }

  if (buffer.subarray(0, 4).toString("ascii") === "fLaC") {
    return "audio/flac";
  }

  if (buffer.subarray(0, 4).toString("ascii") === "OggS") {
    return buffer.subarray(0, 64).includes(Buffer.from("OpusHead"))
      ? "audio/opus"
      : "audio/ogg";
  }

  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return "video/mp4";
  }

  return undefined;
}

function extensionFromMediaType(mediaType: string | undefined): string | undefined {
  switch (mediaType) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
    case "audio/wave":
    case "audio/vnd.wave":
      return "wav";
    case "audio/flac":
    case "audio/x-flac":
      return "flac";
    case "audio/ogg":
    case "application/ogg":
      return "ogg";
    case "audio/opus":
      return "opus";
    case "audio/aac":
      return "aac";
    case "audio/mp4":
      return "m4a";
    case "audio/webm":
      return "webm";
    case "audio/pcm":
    case "audio/l16":
      return "pcm";
    case "application/octet-stream":
      return undefined;
    default:
      return undefined;
  }
}

function extensionFromUrl(url: string): string | undefined {
  try {
    const extension = path.extname(new URL(url).pathname).replace(".", "").toLowerCase();
    return extension || undefined;
  } catch {
    return undefined;
  }
}

function sanitizeFilenamePart(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return sanitized || "nectar";
}

function formatSaveError(source: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Could not save ${source}: ${message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
