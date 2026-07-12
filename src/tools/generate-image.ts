import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { jsonResponse, textResponse } from "../lib/format.js";
import { saveImageGenerationResult, type SaveMediaResult } from "../lib/media.js";
import { PollinationsClient } from "../lib/pollinations-client.js";
import { toToolError } from "../lib/errors.js";

const GENERATE_IMAGE_DESCRIPTION = [
  "Generate an image from a text prompt using Pollinations image models. This calls Pollinations' OpenAI-compatible image generation endpoint and returns either a generated image URL or base64 image data. Use this when the user wants a new image from text, optionally with reference images for image-to-image generation. Do NOT use this for editing an existing image with specific source-image transformation instructions; use pollinations_edit_image instead.",
  "Args:",
  "- prompt (string, required): Text description of the desired image. Be specific about subject, style, composition, lighting, colors, and any text that should appear.",
  "- model (string, optional): Pollinations image model slug. Known image models include kontext, nanobanana, nanobanana-2, nanobanana-2-lite, nanobanana-pro, seedream5, seedream5-pro, seedream, seedream-pro, ideogram-v4-turbo, ideogram-v4-balanced, ideogram-v4-quality, gptimage, gptimage-large, gpt-image-2, flux, zimage, wan-image, wan-image-pro, qwen-image, grok-imagine, grok-imagine-pro, klein, p-image, p-image-edit, nova-canvas. Call pollinations_list_models first for current pricing/capabilities.",
  "- n (number, optional, default 1): Number of images. Pollinations currently supports max 1.",
  "- size (string, optional): Output size as WIDTHxHEIGHT, e.g. 1024x1024, 1536x1024, 1024x1536. Do not combine with width/height unless intentionally overriding.",
  "- width and height (numbers, optional): Alternative dimension controls. If both are provided and size is omitted, Nectar sends size as WIDTHxHEIGHT.",
  "- quality (string, optional): standard, hd, low, medium, or high. Best supported by gptimage, gptimage-large, and gpt-image-2; other models may ignore it.",
  "- response_format (string, optional, default b64_json): b64_json is preferred for local saving because Nectar can decode it directly. Use url only when the caller explicitly wants a Pollinations URL instead of embedded image data.",
  "- save_output (boolean, optional, default true): Save returned image data or URL media to a local file and include the path in the result.",
  "- output_dir (string, optional): Directory for saved files. Defaults to NECTAR_OUTPUT_DIR or ./nectar-output relative to the server process.",
  "- filename_prefix (string, optional): Prefix for saved media filenames. Nectar sanitizes this value.",
  "- image (string or string[], optional): Reference image URL(s) for image-to-image generation on supported models such as kontext, gptimage, seedream, klein, and nanobanana.",
  "- seed (number, optional): Reproducibility seed. Use -1 for random. Supported by models such as flux, zimage, seedream, and klein; other models may ignore it.",
  "- enhance (boolean, optional): Ask Pollinations to enhance/expand the prompt when supported.",
  "- negative_prompt (string, optional): Things to avoid in the generated image when supported.",
  "- transparent (boolean, optional): Request a transparent background. Only supported by gptimage, gptimage-large, and gpt-image-2.",
  "- safe (string, optional): Comma-separated safety filters: privacy, secrets, sexual, violence, shield, true, nsfw. true means privacy,secrets. nsfw means sexual,violence.",
  "- user (string, optional): End-user identifier for abuse tracking.",
  "- output_format (string, optional, default markdown): markdown summary or raw json response.",
  "Returns: Markdown or JSON with the generated URL, base64 length, and revised_prompt when Pollinations returns one.",
  "Examples: Use model=flux, prompt only for a general image. Use model=gpt-image-2 with transparent=true for a transparent asset. Use image=[url] with kontext or nanobanana for image-to-image reference generation.",
  "Error handling: 401 means missing/invalid POLLINATIONS_API_KEY in the MCP env block. 402 means insufficient pollen balance. 403 means the key lacks permission for the selected model. 429 means wait and retry. 400 usually means conflicting or unsupported parameters; call pollinations_list_models and retry with model-supported options."
].join(" ");

const generateImageSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(32_000)
    .describe("Required text description of the image. Include subject, composition, style, lighting, colors, mood, and any exact text that should appear."),
  model: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional Pollinations image model slug. Examples: flux, kontext, gptimage, gptimage-large, gpt-image-2, seedream5, seedream5-pro, seedream, seedream-pro, nanobanana, nanobanana-2, nanobanana-pro, grok-imagine, wan-image, qwen-image, klein, p-image, p-image-edit, nova-canvas. Call pollinations_list_models first for current models."),
  n: z
    .number()
    .int()
    .min(1)
    .max(1)
    .default(1)
    .describe("Number of images to generate. Pollinations currently supports 1."),
  size: z
    .string()
    .regex(/^\d+x\d+$/)
    .optional()
    .describe("Optional image size as WIDTHxHEIGHT, for example 1024x1024, 1536x1024, or 1024x1536. If omitted, Pollinations chooses the default. If width and height are both set and size is omitted, Nectar sends WIDTHxHEIGHT as size."),
  width: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Optional image width in pixels. Use with height as an alternative to size."),
  height: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Optional image height in pixels. Use with width as an alternative to size."),
  quality: z
    .enum(["standard", "hd", "low", "medium", "high"])
    .default("medium")
    .describe("Image quality: standard, hd, low, medium, high. Best supported by gptimage, gptimage-large, and gpt-image-2; other models may ignore it."),
  response_format: z
    .enum(["url", "b64_json"])
    .default("b64_json")
    .describe("Pollinations image response format. Defaults to b64_json so Nectar can save the image locally without a second download. Use url only when the caller explicitly wants a Pollinations URL."),
  safe: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional comma-separated safety filters: privacy, secrets, sexual, violence, shield, true, nsfw. true enables privacy,secrets. nsfw enables sexual,violence. false or 0 disables safety filters."),
  user: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Optional end-user identifier for abuse tracking."),
  image: z
    .union([z.string().url(), z.array(z.string().url()).min(1).max(8)])
    .optional()
    .describe("Optional reference image URL or URLs for image-to-image generation on supported models such as kontext, gptimage, seedream, klein, and nanobanana."),
  seed: z
    .number()
    .int()
    .min(-1)
    .max(2_147_483_647)
    .optional()
    .describe("Optional seed for reproducible results. Use -1 for random. Supported by flux, zimage, seedream, and klein; unsupported models may ignore it."),
  enhance: z
    .boolean()
    .optional()
    .describe("Optional prompt enhancement flag. When supported, Pollinations may expand/improve the prompt before generation."),
  negative_prompt: z
    .string()
    .trim()
    .min(1)
    .max(4_000)
    .optional()
    .describe("Optional negative prompt describing what to avoid, when the selected model supports negative prompts."),
  transparent: z
    .boolean()
    .optional()
    .describe("Optional transparent background request. Only supported by gptimage, gptimage-large, and gpt-image-2."),
  output_format: z
    .enum(["markdown", "json"])
    .default("markdown")
    .describe("MCP response format: markdown for readable summaries, json for raw Pollinations response plus saved_files metadata when saving is enabled."),
  save_output: z
    .boolean()
    .default(true)
    .describe("Save returned image output to a local file. Works for both url and b64_json Pollinations responses."),
  output_dir: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Directory where generated image files should be saved. Defaults to NECTAR_OUTPUT_DIR or ./nectar-output."),
  filename_prefix: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("Optional prefix for saved image filenames. Example: bee-logo or product-shot.")
});

export function registerGenerateImageTool(server: McpServer): void {
  server.registerTool(
    "pollinations_generate_image",
    {
      title: "Generate Pollinations Image",
      description: GENERATE_IMAGE_DESCRIPTION,
      inputSchema: generateImageSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ output_format, save_output, output_dir, filename_prefix, ...input }) => {
      try {
        const client = new PollinationsClient();
        const result = await client.generateImage(input);
        const saved = save_output
          ? await saveImageGenerationResult(result, { output_dir, filename_prefix })
          : undefined;

        if (output_format === "json") {
          return jsonResponse({
            pollinations: result,
            saved_files: saved?.files ?? [],
            save_errors: saved?.errors ?? []
          });
        }

        return textResponse(formatImageResult(result, saved));
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}

function formatImageResult(result: unknown, saved: SaveMediaResult | undefined): string {
  const data = isRecord(result) && Array.isArray(result.data) ? result.data : [];
  const first = data.find(isRecord);

  if (!first) {
    return [
      "# Image Generation Result",
      "",
      JSON.stringify(result, null, 2),
      "",
      formatSavedMedia(saved)
    ].filter(Boolean).join("\n");
  }

  const lines = ["# Image Generation Result", ""];

  if (typeof first.url === "string") {
    lines.push(`Image URL: ${first.url}`);
  }

  if (typeof first.b64_json === "string") {
    lines.push(`Base64 image data returned (${first.b64_json.length} characters).`);
  }

  if (typeof first.revised_prompt === "string" && first.revised_prompt.length > 0) {
    lines.push("");
    lines.push(`Revised prompt: ${first.revised_prompt}`);
  }

  const savedText = formatSavedMedia(saved);
  if (savedText) {
    lines.push("");
    lines.push(savedText);
  }

  return lines.join("\n");
}

function formatSavedMedia(saved: SaveMediaResult | undefined): string {
  if (!saved) {
    return "";
  }

  const lines = ["## Saved Files"];

  if (saved.files.length === 0) {
    lines.push("- No files were saved.");
  }

  for (const file of saved.files) {
    lines.push(`- ${file.path} (${file.mediaType ?? "unknown"}, ${file.bytes} bytes, from ${file.source})`);
  }

  for (const error of saved.errors) {
    lines.push(`- Save warning: ${error}`);
  }

  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
