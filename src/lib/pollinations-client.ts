import {
  API_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  MODEL_CATALOG_TIMEOUT_MS,
  SERVER_USER_AGENT
} from "./constants.js";
import { missingApiKeyMessage, parsePollinationsError } from "./errors.js";

type QueryValue = string | number | boolean | undefined;

export interface ImageGenerationOptions {
  prompt: string;
  model?: string;
  n?: number;
  quality?: "standard" | "hd" | "low" | "medium" | "high";
  response_format?: "url" | "b64_json";
  safe?: string;
  size?: string;
  width?: number;
  height?: number;
  seed?: number;
  enhance?: boolean;
  negative_prompt?: string;
  transparent?: boolean;
  user?: string;
  image?: string | string[];
}

export interface ImageEditOptions extends ImageGenerationOptions {
  image: string | string[];
}

export interface VideoGenerationOptions {
  prompt: string;
  model: string;
  width?: number;
  height?: number;
  seed?: number;
  safe?: string;
  quality?: "low" | "medium" | "high" | "hd";
  image?: string | string[];
  duration?: number;
  aspectRatio?: "16:9" | "9:16";
  audio?: boolean;
}

export interface ListModelsOptions {
  modality?: "image" | "video" | "all";
  search?: string;
  limit?: number;
  refresh?: boolean;
  sort_by?: "default" | "name" | "price";
  sort_order?: "asc" | "desc";
  paid_only?: boolean;
  supports_reference_images?: boolean;
  supports_end_frame?: boolean;
  supports_audio?: boolean;
}

export interface PollinationsModel {
  name?: string;
  id?: string;
  type?: string;
  modality?: string;
  modalities?: string[];
  category?: string;
  brand?: string;
  title?: string;
  description?: string;
  aliases?: string[];
  input_modalities?: string[];
  output_modalities?: string[];
  max_reference_images?: number;
  paid_only?: boolean;
  price?: unknown;
  pricing?: unknown;
  capabilities?: unknown;
  video_capabilities?: unknown;
  image_capabilities?: unknown;
  [key: string]: unknown;
}

const MODEL_CACHE_TTL_MS = 15 * 60 * 1000;
let modelCache: {
  fetchedAt: number;
  models: PollinationsModel[];
} | undefined;

export class PollinationsClient {
  private readonly apiKey: string | undefined;

  constructor(apiKey = process.env.POLLINATIONS_API_KEY) {
    this.apiKey = apiKey;
  }

  async listModels(options: ListModelsOptions = {}): Promise<PollinationsModel[]> {
    const models = await this.getModelCatalog(options.refresh ?? false);

    return models
      .filter((model) => matchesModality(model, options.modality ?? "all"))
      .filter((model) => matchesSearch(model, options.search))
      .filter((model) => matchesPaidOnly(model, options.paid_only))
      .filter((model) => matchesReferenceImages(model, options.supports_reference_images))
      .filter((model) => matchesEndFrame(model, options.supports_end_frame))
      .filter((model) => matchesAudio(model, options.supports_audio))
      .sort((a, b) => compareModels(a, b, options.sort_by ?? "default", options.sort_order ?? "asc"))
      .slice(0, options.limit ?? 50);
  }

  async getModel(name: string, refresh = false): Promise<PollinationsModel | undefined> {
    const models = await this.getModelCatalog(refresh);
    const normalizedName = name.toLowerCase();

    return models.find((model) => {
      const names = [
        model.name,
        model.id,
        ...(Array.isArray(model.aliases) ? model.aliases : [])
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

      return names.includes(normalizedName);
    });
  }

  async checkBalance(): Promise<unknown> {
    return this.requestJson<unknown>("/account/balance", {
      requireAuth: true
    });
  }

  async generateImage(options: ImageGenerationOptions): Promise<unknown> {
    return this.requestJson<unknown>("/v1/images/generations", {
      method: "POST",
      requireAuth: true,
      body: normalizeImageBody(options)
    });
  }

  async editImage(options: ImageEditOptions): Promise<unknown> {
    return this.requestJson<unknown>("/v1/images/edits", {
      method: "POST",
      requireAuth: true,
      body: normalizeImageBody(options)
    });
  }

  async generateVideo(options: VideoGenerationOptions): Promise<{
    url: string;
    contentType: string | null;
    contentLength: string | null;
  }> {
    const query = toQueryString({
      model: options.model,
      width: options.width,
      height: options.height,
      seed: options.seed,
      safe: options.safe,
      quality: options.quality,
      image: Array.isArray(options.image) ? options.image.join("|") : options.image,
      duration: options.duration,
      aspectRatio: options.aspectRatio,
      audio: options.audio
    });
    const path = `/video/${encodeURIComponent(options.prompt)}${query}`;
    const response = await this.request(path, {
      requireAuth: true
    });

    return {
      url: response.url,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length")
    };
  }

  private async requestJson<T>(
    path: string,
    options: {
      method?: "GET" | "POST";
      requireAuth: boolean;
      body?: Record<string, unknown>;
      timeoutMs?: number;
      headers?: Record<string, string>;
    }
  ): Promise<T> {
    const response = await this.request(path, options);
    return (await response.json()) as T;
  }

  private async request(
    path: string,
    options: {
      method?: "GET" | "POST";
      requireAuth: boolean;
      body?: Record<string, unknown>;
      timeoutMs?: number;
      headers?: Record<string, string>;
    }
  ): Promise<Response> {
    if (options.requireAuth && !this.apiKey) {
      throw new Error(missingApiKeyMessage());
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const requestInit: RequestInit = {
      method: options.method ?? "GET",
      headers: {
        ...this.headers(options.requireAuth, options.body !== undefined),
        ...options.headers
      },
      signal: controller.signal
    };

    if (options.body !== undefined) {
      requestInit.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(`${API_BASE_URL}${path}`, requestInit);

      if (!response.ok) {
        throw await parsePollinationsError(response);
      }

      return response;
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`Pollinations request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private headers(requireAuth: boolean, hasBody: boolean): HeadersInit {
    const headers: Record<string, string> = {
      "User-Agent": SERVER_USER_AGENT
    };

    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }

    if (requireAuth && this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  private async getModelCatalog(refresh: boolean): Promise<PollinationsModel[]> {
    const now = Date.now();

    if (!refresh && modelCache && now - modelCache.fetchedAt < MODEL_CACHE_TTL_MS) {
      return modelCache.models;
    }

    let models: PollinationsModel[];

    try {
      models = await this.requestJson<PollinationsModel[]>("/image/models", {
        requireAuth: false,
        timeoutMs: MODEL_CATALOG_TIMEOUT_MS,
        headers: {
          Accept: "application/json",
          Connection: "close"
        }
      });
    } catch (error) {
      if (modelCache) {
        return modelCache.models;
      }

      throw error;
    }

    modelCache = {
      fetchedAt: now,
      models
    };

    return models;
  }
}

function normalizeImageBody(options: ImageGenerationOptions): Record<string, unknown> {
  const size = options.size ?? (
    options.width !== undefined && options.height !== undefined
      ? `${options.width}x${options.height}`
      : undefined
  );

  return {
    ...options,
    size,
    image: Array.isArray(options.image) ? options.image : options.image
  };
}

function toQueryString(values: Record<string, QueryValue>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

function matchesSearch(model: PollinationsModel, search: string | undefined): boolean {
  if (!search) {
    return true;
  }

  const haystack = JSON.stringify(model).toLowerCase();
  return haystack.includes(search.toLowerCase());
}

function matchesPaidOnly(model: PollinationsModel, paidOnly: boolean | undefined): boolean {
  if (paidOnly === undefined) {
    return true;
  }

  return model.paid_only === paidOnly;
}

function matchesReferenceImages(model: PollinationsModel, required: boolean | undefined): boolean {
  if (required === undefined) {
    return true;
  }

  return ((model.max_reference_images ?? 0) > 0) === required;
}

function matchesEndFrame(model: PollinationsModel, required: boolean | undefined): boolean {
  if (required === undefined) {
    return true;
  }

  return stringArray(model.video_capabilities).includes("end_frame") === required;
}

function matchesAudio(model: PollinationsModel, required: boolean | undefined): boolean {
  if (required === undefined) {
    return true;
  }

  const supportsAudio =
    stringArray(model.output_modalities).includes("audio") ||
    stringArray(model.video_capabilities).includes("audio_output");

  return supportsAudio === required;
}

function compareModels(
  a: PollinationsModel,
  b: PollinationsModel,
  sortBy: "default" | "name" | "price",
  sortOrder: "asc" | "desc"
): number {
  if (sortBy === "default") {
    return 0;
  }

  const direction = sortOrder === "asc" ? 1 : -1;

  if (sortBy === "name") {
    return String(a.name ?? "").localeCompare(String(b.name ?? "")) * direction;
  }

  const aPrice = modelLowestPrice(a);
  const bPrice = modelLowestPrice(b);

  if (aPrice === undefined && bPrice === undefined) {
    return 0;
  }
  if (aPrice === undefined) {
    return 1;
  }
  if (bPrice === undefined) {
    return -1;
  }

  return (aPrice - bPrice) * direction;
}

function modelLowestPrice(model: PollinationsModel): number | undefined {
  if (!isRecord(model.pricing)) {
    return undefined;
  }

  const values = Object.entries(model.pricing)
    .filter(([key]) => key !== "currency")
    .map(([, value]) => Number(value))
    .filter((value) => Number.isFinite(value));

  return values.length > 0 ? Math.min(...values) : undefined;
}

function matchesModality(model: PollinationsModel, modality: "image" | "video" | "all"): boolean {
  if (modality === "all") {
    return true;
  }

  if (model.category === modality) {
    return true;
  }

  if (model.output_modalities?.includes(modality)) {
    return true;
  }

  const searchable = [
    model.type,
    model.modality,
    model.category,
    ...(Array.isArray(model.modalities) ? model.modalities : []),
    ...(Array.isArray(model.output_modalities) ? model.output_modalities : []),
    JSON.stringify(model.capabilities ?? {}),
    JSON.stringify(model.video_capabilities ?? {}),
    JSON.stringify(model.image_capabilities ?? {})
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchable.includes(modality);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
