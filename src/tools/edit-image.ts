import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { jsonResponse, textResponse } from "../lib/format.js";
import { saveImageGenerationResult, type SaveMediaResult } from "../lib/media.js";
import { PollinationsClient } from "../lib/pollinations-client.js";
import { toToolError } from "../lib/errors.js";

const EDIT_IMAGE_DESCRIPTION = [
  "Edit or transform existing image URL(s) with Pollinations using a text instruction. This calls Pollinations' OpenAI-compatible image editing endpoint with JSON image URLs. Use this when the user provides one or more source images and wants changes such as restyling, object/background changes, cleanup, transparent background, composition changes, or image-to-image transformations. Do NOT use this for a brand-new image with no source image; use pollinations_generate_image instead.",
  "Args:",
  "- prompt (string, required): Editing instruction. Say exactly what to change and what to preserve. Example: 'keep the bee robot unchanged, replace the background with a dark charcoal studio surface, make the wings more translucent'.",
  "- image (string or string[], required): Source image URL or URLs. Local file paths are not supported in v1. If the user has a local image, upload it elsewhere first or use a public/content-addressed URL.",
  "- model (string, optional): Image-editing-capable Pollinations model. Good candidates may include kontext, gptimage, gptimage-large, gpt-image-2, seedream, seedream-pro, nanobanana, nanobanana-2, nanobanana-pro, klein, p-image-edit. Call pollinations_list_models first if unsure.",
  "- n (number, optional, default 1): Number of edited outputs. Pollinations currently supports max 1.",
  "- size (string, optional): Output size as WIDTHxHEIGHT, e.g. 1024x1024. If omitted, Pollinations chooses the default. If width and height are provided and size is omitted, Nectar sends WIDTHxHEIGHT as size.",
  "- width and height (numbers, optional): Alternative output dimension controls.",
  "- quality (string, optional): standard, hd, low, medium, or high. Best supported by gptimage/gpt-image models; unsupported models may ignore it.",
  "- response_format (string, optional, default b64_json): b64_json is preferred for local saving because Nectar can decode it directly. Use url only when the caller explicitly wants a Pollinations URL instead of embedded image data.",
  "- save_output (boolean, optional, default true): Save returned image data or URL media to a local file and include the path in the result.",
  "- output_dir (string, optional): Directory for saved files. Defaults to NECTAR_OUTPUT_DIR or ./nectar-output relative to the server process.",
  "- filename_prefix (string, optional): Prefix for saved media filenames. Nectar sanitizes this value.",
  "- seed (number, optional): Reproducibility seed where supported. Use -1 for random.",
  "- enhance (boolean, optional): Ask Pollinations to enhance the prompt where supported.",
  "- negative_prompt (string, optional): Things to avoid in the edited output, where supported.",
  "- transparent (boolean, optional): Request transparent output. Best supported by gptimage, gptimage-large, and gpt-image-2.",
  "- safe (string, optional): Comma-separated safety filters: privacy, secrets, sexual, violence, shield, true, nsfw.",
  "- user (string, optional): End-user identifier for abuse tracking.",
  "- output_format (string, optional, default markdown): markdown summary or raw json response.",
  "Returns: Markdown or JSON with the edited image URL, base64 length, and revised_prompt when returned.",
  "Examples: Use when the user says 'make this image transparent', 'change the outfit', 'turn this logo into a sticker', or 'use this reference image but make it cyberpunk'.",
  "Error handling: 401 means missing/invalid POLLINATIONS_API_KEY. 402 means insufficient pollen. 403 means selected model/key permission issue. 400 usually means an unsupported edit model, invalid image URL, or conflicting options; call pollinations_list_models and retry with a model that supports editing."
].join(" ");

const editImageSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(32_000)
    .describe("Required edit instruction. Be clear about what to change and what must remain unchanged."),
  image: z
    .union([z.string().url(), z.array(z.string().url()).min(1).max(8)])
    .describe("Required source image URL or URLs to edit. Local file paths and multipart uploads are intentionally not supported in v1."),
  model: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional image-editing model slug. Examples: kontext, gptimage, gptimage-large, gpt-image-2, seedream, seedream-pro, nanobanana, nanobanana-2, nanobanana-pro, klein, p-image-edit. Call pollinations_list_models for current capabilities."),
  n: z
    .number()
    .int()
    .min(1)
    .max(1)
    .default(1)
    .describe("Number of edited images. Pollinations currently supports 1."),
  size: z
    .string()
    .regex(/^\d+x\d+$/)
    .optional()
    .describe("Optional output size as WIDTHxHEIGHT, for example 1024x1024 or 1536x1024. If width and height are set and size is omitted, Nectar sends WIDTHxHEIGHT as size."),
  width: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Optional output width in pixels. Use with height as an alternative to size."),
  height: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Optional output height in pixels. Use with width as an alternative to size."),
  quality: z
    .enum(["standard", "hd", "low", "medium", "high"])
    .default("medium")
    .describe("Output quality: standard, hd, low, medium, high. Unsupported models may ignore this."),
  response_format: z
    .enum(["url", "b64_json"])
    .default("b64_json")
    .describe("Pollinations response format. Defaults to b64_json so Nectar can save edited images locally without a second download. Use url only when the caller explicitly wants a Pollinations URL."),
  safe: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional comma-separated safety filters: privacy, secrets, sexual, violence, shield, true, nsfw. true enables privacy,secrets. nsfw enables sexual,violence."),
  user: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Optional end-user identifier for abuse tracking."),
  seed: z
    .number()
    .int()
    .min(-1)
    .max(2_147_483_647)
    .optional()
    .describe("Optional seed for reproducible edits where supported. Use -1 for random."),
  enhance: z
    .boolean()
    .optional()
    .describe("Optional prompt enhancement flag. Supported models may expand/improve the edit prompt."),
  negative_prompt: z
    .string()
    .trim()
    .min(1)
    .max(4_000)
    .optional()
    .describe("Optional negative prompt describing what to avoid in the edited image, where supported."),
  transparent: z
    .boolean()
    .optional()
    .describe("Optional transparent background/output request. Best supported by gptimage, gptimage-large, and gpt-image-2."),
  output_format: z
    .enum(["markdown", "json"])
    .default("markdown")
    .describe("MCP response format: markdown for readable summaries, json for raw Pollinations response plus saved_files metadata when saving is enabled."),
  save_output: z
    .boolean()
    .default(true)
    .describe("Save returned edited image output to a local file. Works for both url and b64_json Pollinations responses."),
  output_dir: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Directory where edited image files should be saved. Defaults to NECTAR_OUTPUT_DIR or ./nectar-output."),
  filename_prefix: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("Optional prefix for saved edited image filenames. Example: transparent-logo or edited-portrait.")
});

export function registerEditImageTool(server: McpServer): void {
  server.registerTool(
    "pollinations_edit_image",
    {
      title: "Edit Pollinations Image",
      description: EDIT_IMAGE_DESCRIPTION,
      inputSchema: editImageSchema,
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
        const result = await client.editImage(input);
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

        return textResponse(formatEditResult(result, saved));
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}

function formatEditResult(result: unknown, saved: SaveMediaResult | undefined): string {
  const data = isRecord(result) && Array.isArray(result.data) ? result.data : [];
  const first = data.find(isRecord);

  if (!first) {
    return [
      "# Image Edit Result",
      "",
      JSON.stringify(result, null, 2),
      "",
      formatSavedMedia(saved)
    ].filter(Boolean).join("\n");
  }

  const lines = ["# Image Edit Result", ""];

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
