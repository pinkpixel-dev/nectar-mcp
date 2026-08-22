import {
  API_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  MODEL_CATALOG_TIMEOUT_MS,
  SERVER_USER_AGENT
} from "./constants.js";
import { missingApiKeyMessage, parsePollinationsError } from "./errors.js";
import {
  filterModels,
  findModel,
  type ListModelsOptions,
  type PollinationsModel
} from "./model-catalog.js";

export type { ListModelsOptions, PollinationsModel } from "./model-catalog.js";

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

export interface AudioGenerationOptions {
  prompt: string;
  model: string;
  voice?: string;
  safe?: string;
}

const MODEL_CACHE_TTL_MS = 15 * 60 * 1000;
type ModelCatalogKind = "visual" | "audio";

const modelCaches: Partial<Record<ModelCatalogKind, {
  fetchedAt: number;
  models: PollinationsModel[];
}>> = {};

export class PollinationsClient {
  private readonly apiKey: string | undefined;

  constructor(apiKey = process.env.POLLINATIONS_API_KEY) {
    this.apiKey = apiKey;
  }

  async listModels(options: ListModelsOptions = {}): Promise<PollinationsModel[]> {
    const models = await this.getModelsForModality(
      options.modality ?? "all",
      options.refresh ?? false
    );

    return filterModels(models, options);
  }

  async getModel(name: string, refresh = false): Promise<PollinationsModel | undefined> {
    const models = await this.getModelsForModality("all", refresh);
    return findModel(models, name);
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

  async generateAudio(options: AudioGenerationOptions): Promise<{
    url: string;
    contentType: string | null;
    contentLength: string | null;
  }> {
    const query = toQueryString({
      model: options.model,
      voice: options.voice,
      safe: options.safe
    });
    const path = `/audio/${encodeURIComponent(options.prompt)}${query}`;
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

  private async getModelsForModality(
    modality: NonNullable<ListModelsOptions["modality"]>,
    refresh: boolean
  ): Promise<PollinationsModel[]> {
    if (modality === "audio") {
      return this.getModelCatalog("audio", refresh);
    }

    if (modality === "image" || modality === "video") {
      return this.getModelCatalog("visual", refresh);
    }

    const [visualModels, audioModels] = await Promise.all([
      this.getModelCatalog("visual", refresh),
      this.getModelCatalog("audio", refresh)
    ]);

    return [...visualModels, ...audioModels];
  }

  private async getModelCatalog(
    kind: ModelCatalogKind,
    refresh: boolean
  ): Promise<PollinationsModel[]> {
    const now = Date.now();
    const cached = modelCaches[kind];

    if (!refresh && cached && now - cached.fetchedAt < MODEL_CACHE_TTL_MS) {
      return cached.models;
    }

    let models: PollinationsModel[];

    try {
      const path = kind === "audio" ? "/audio/models" : "/image/models";
      models = await this.requestJson<PollinationsModel[]>(path, {
        requireAuth: false,
        timeoutMs: MODEL_CATALOG_TIMEOUT_MS,
        headers: {
          Accept: "application/json",
          Connection: "close"
        }
      });
    } catch (error) {
      if (cached) {
        return cached.models;
      }

      throw error;
    }

    modelCaches[kind] = {
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
