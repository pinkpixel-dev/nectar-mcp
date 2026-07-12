import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { formatBoolean, jsonResponse, textResponse } from "../lib/format.js";
import { PollinationsClient, type PollinationsModel } from "../lib/pollinations-client.js";
import { toToolError } from "../lib/errors.js";

const LIST_MODELS_DESCRIPTION = [
  "List currently available Pollinations image and video models from /image/models. Results are cached in memory for 15 minutes, so repeated calls are fast. Use this before generation when model choice, pricing, modality, reference-image support, end-frame support, or audio support is unclear. This tool does not require POLLINATIONS_API_KEY.",
  "Args:",
  "- modality (string, optional, default all): all, image, or video. Use image before image generation/editing. Use video before video generation.",
  "- search (string, optional): Case-insensitive search across model names, aliases, brands, descriptions, pricing, capabilities, and raw metadata. Examples: 'gpt', 'transparent', 'end_frame', 'audio', 'seedance', 'banana', 'edit'. Do not use search='cheap' to find cheapest; inspect the Pricing lines instead.",
  "- limit (number, optional, default 50, max 100): Maximum number of models to return.",
  "- detail (string, optional, default summary): summary returns compact model cards; full returns richer metadata for listed models. For one model, prefer pollinations_get_model_details.",
  "- sort_by (string, optional, default default): default, name, or price. Use sort_by=price and sort_order=asc to find cheaper models.",
  "- sort_order (string, optional, default asc): asc or desc.",
  "- paid_only (boolean, optional): Filter by paid_only flag.",
  "- supports_reference_images (boolean, optional): true returns models with max_reference_images > 0.",
  "- supports_end_frame (boolean, optional): true returns video models with end_frame capability.",
  "- supports_audio (boolean, optional): true returns models that output audio or support audio_output.",
  "- refresh (boolean, optional, default false): Bypass the 15-minute in-memory cache and refetch /image/models.",
  "- response_format (string, optional, default markdown): markdown for readable summaries, json for structured compact/full metadata.",
  "Returns: Compact model names, category, pricing, input/output modalities, and key capability flags by default. Use pollinations_get_model_details for complete raw metadata for one model.",
  "Examples: Cheapest images: modality=image, sort_by=price, sort_order=asc, limit=5. Cheapest videos: modality=video, sort_by=price, sort_order=asc, limit=5. First/last-frame videos: modality=video, supports_end_frame=true. Image editing/reference models: modality=image, supports_reference_images=true.",
  "Error handling: If no models match, retry with modality=all, remove search, or remove capability filters. Use refresh=true only when you need current model changes."
].join(" ");

const listModelsSchema = z.object({
  modality: z
    .enum(["all", "image", "video"])
    .default("all")
    .describe("Filter models by modality: all, image, or video. Use video before video generation and image before image generation/editing."),
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Optional case-insensitive search across names, aliases, brands, descriptions, capabilities, pricing, and metadata. Examples: gpt, transparent, end_frame, audio, edit, seedance, banana. Do not use cheap as a search term; inspect Pricing instead."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Maximum number of models to return."),
  detail: z
    .enum(["summary", "full"])
    .default("summary")
    .describe("summary returns compact low-context model cards. full returns richer metadata for listed models. Use pollinations_get_model_details for one model's full raw metadata."),
  sort_by: z
    .enum(["default", "name", "price"])
    .default("default")
    .describe("Sort models by default API order, name, or lowest numeric pricing value."),
  sort_order: z
    .enum(["asc", "desc"])
    .default("asc")
    .describe("Sort direction for name or price sorting."),
  paid_only: z
    .boolean()
    .optional()
    .describe("Optional paid_only filter. true returns paid-only models; false returns models not marked paid-only."),
  supports_reference_images: z
    .boolean()
    .optional()
    .describe("Optional filter for models with max_reference_images greater than zero."),
  supports_end_frame: z
    .boolean()
    .optional()
    .describe("Optional filter for video models with end_frame capability."),
  supports_audio: z
    .boolean()
    .optional()
    .describe("Optional filter for models that output audio or support video audio_output."),
  refresh: z
    .boolean()
    .default(false)
    .describe("Bypass the 15-minute in-memory cache and refetch the Pollinations model catalog."),
  response_format: z
    .enum(["markdown", "json"])
    .default("markdown")
    .describe("MCP response format: markdown for readable summaries, json for raw model metadata.")
});

export function registerListModelsTool(server: McpServer): void {
  server.registerTool(
    "pollinations_list_models",
    {
      title: "List Pollinations Models",
      description: LIST_MODELS_DESCRIPTION,
      inputSchema: listModelsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({
      modality,
      search,
      limit,
      detail,
      sort_by,
      sort_order,
      paid_only,
      supports_reference_images,
      supports_end_frame,
      supports_audio,
      refresh,
      response_format
    }) => {
      try {
        const client = new PollinationsClient();
        const models = await client.listModels({
          modality,
          search,
          limit,
          refresh,
          sort_by,
          sort_order,
          paid_only,
          supports_reference_images,
          supports_end_frame,
          supports_audio
        });

        if (response_format === "json") {
          return jsonResponse({
            count: models.length,
            detail,
            cached_for_seconds: 900,
            models: detail === "summary" ? models.map(toModelSummary) : models
          });
        }

        return textResponse(formatModels(models, { modality, search, detail, sort_by, sort_order }));
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}

function formatModels(
  models: PollinationsModel[],
  filters: {
    modality: string;
    search?: string;
    detail: "summary" | "full";
    sort_by: string;
    sort_order: string;
  }
): string {
  const lines = [
    "# Pollinations Models",
    "",
    `Returned ${models.length} model${models.length === 1 ? "" : "s"}.`,
    `Filter: ${filters.modality}${filters.search ? `, search: ${filters.search}` : ""}`,
    `Detail: ${filters.detail}. Sort: ${filters.sort_by} ${filters.sort_order}. Cache: 15 minutes.`,
    ""
  ];

  for (const model of models) {
    if (filters.detail === "summary") {
      lines.push(formatModelSummary(model), "");
      continue;
    }

    const name = String(model.name ?? model.id ?? "unnamed-model");
    lines.push(`## ${name}`);
    lines.push(`- Category: ${String(model.category ?? model.type ?? model.modality ?? "unknown")}`);
    if (model.title) {
      lines.push(`- Title: ${model.title}`);
    }
    if (model.brand) {
      lines.push(`- Brand: ${model.brand}`);
    }
    if (model.description) {
      lines.push(`- Description: ${model.description}`);
    }
    if (model.aliases?.length) {
      lines.push(`- Aliases: ${model.aliases.join(", ")}`);
    }
    if (model.input_modalities?.length) {
      lines.push(`- Input modalities: ${model.input_modalities.join(", ")}`);
    }
    if (model.output_modalities?.length) {
      lines.push(`- Output modalities: ${model.output_modalities.join(", ")}`);
    }
    lines.push(`- Supports video: ${formatBoolean(hasVideoCapability(model))}`);
    lines.push(`- Supports image: ${formatBoolean(hasImageCapability(model))}`);
    if (typeof model.max_reference_images === "number") {
      lines.push(`- Max reference images: ${model.max_reference_images}`);
    }
    if (typeof model.paid_only === "boolean") {
      lines.push(`- Paid only: ${formatBoolean(model.paid_only)}`);
    }

    if (model.pricing ?? model.price) {
      lines.push(`- Pricing: \`${JSON.stringify(model.pricing ?? model.price)}\``);
    }

    if (model.capabilities) {
      lines.push(`- Capabilities: \`${JSON.stringify(model.capabilities)}\``);
    }

    if (model.video_capabilities) {
      lines.push(`- Video capabilities: \`${JSON.stringify(model.video_capabilities)}\``);
    }

    if (model.image_capabilities) {
      lines.push(`- Image capabilities: \`${JSON.stringify(model.image_capabilities)}\``);
    }

    lines.push("");
  }

  if (models.length === 0) {
    lines.push("No models matched those filters. Try `modality: \"all\"`, remove `search`, or remove capability filters.");
  }

  return lines.join("\n");
}

function formatModelSummary(model: PollinationsModel): string {
  const summary = toModelSummary(model);
  const lines = [
    `## ${summary.name}`,
    `- Category: ${summary.category}`,
    `- Price: ${summary.price ?? "unknown"}`,
    `- Input: ${summary.input_modalities.length ? summary.input_modalities.join(", ") : "unknown"}`,
    `- Output: ${summary.output_modalities.length ? summary.output_modalities.join(", ") : "unknown"}`,
    `- Max refs: ${summary.max_reference_images}`,
    `- Capabilities: ${summary.key_capabilities.length ? summary.key_capabilities.join(", ") : "none listed"}`
  ];

  if (summary.paid_only) {
    lines.push("- Paid only: yes");
  }

  return lines.join("\n");
}

function toModelSummary(model: PollinationsModel): {
  name: string;
  category: string;
  title?: string;
  brand?: string;
  price?: string;
  input_modalities: string[];
  output_modalities: string[];
  max_reference_images: number;
  paid_only: boolean;
  key_capabilities: string[];
} {
  return {
    name: String(model.name ?? model.id ?? "unnamed-model"),
    category: String(model.category ?? model.type ?? model.modality ?? "unknown"),
    title: model.title,
    brand: model.brand,
    price: formatPricing(model.pricing ?? model.price),
    input_modalities: model.input_modalities ?? [],
    output_modalities: model.output_modalities ?? [],
    max_reference_images: model.max_reference_images ?? 0,
    paid_only: model.paid_only ?? false,
    key_capabilities: [
      ...stringArray(model.capabilities),
      ...stringArray(model.video_capabilities),
      ...stringArray(model.image_capabilities)
    ]
  };
}

function formatPricing(pricing: unknown): string | undefined {
  if (!pricing || typeof pricing !== "object") {
    return undefined;
  }

  return Object.entries(pricing)
    .filter(([key]) => key !== "currency")
    .map(([key, value]) => `${key}=${String(value)} pollen`)
    .join(", ");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function hasVideoCapability(model: PollinationsModel): boolean {
  return model.category === "video" || model.output_modalities?.includes("video") === true;
}

function hasImageCapability(model: PollinationsModel): boolean {
  return model.category === "image" || model.output_modalities?.includes("image") === true;
}
