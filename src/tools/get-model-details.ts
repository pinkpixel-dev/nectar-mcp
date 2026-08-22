import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { jsonResponse, textResponse } from "../lib/format.js";
import { PollinationsClient, type PollinationsModel } from "../lib/pollinations-client.js";
import { toToolError } from "../lib/errors.js";

const GET_MODEL_DETAILS_DESCRIPTION = [
  "Get full metadata for one Pollinations image, video, or audio model by name or alias. Use this after pollinations_list_models when an agent needs exact pricing, capabilities, voices, reference-image limits, input/output modalities, aliases, or raw fields for a specific model. Results use the same 15-minute in-memory catalog caches unless refresh=true.",
  "Args:",
  "- model (string, required): Model name or alias, e.g. nanobanana, p-image-edit, ltx-2, wan-fast, veo.",
  "- refresh (boolean, optional, default false): Bypass the 15-minute image/video and audio catalog caches.",
  "- response_format (string, optional, default markdown): markdown for readable details, json for raw model metadata.",
  "Returns: Full metadata for the matching model. If no model matches, call pollinations_list_models with a broader search."
].join(" ");

const getModelDetailsSchema = z.object({
  model: z
    .string()
    .trim()
    .min(1)
    .describe("Model name or alias to inspect, for example nanobanana, p-image-edit, ltx-2, veo, elevenlabs, or elevenmusic."),
  refresh: z
    .boolean()
    .default(false)
    .describe("Bypass the 15-minute in-memory cache and refetch the Pollinations model catalog."),
  response_format: z
    .enum(["markdown", "json"])
    .default("markdown")
    .describe("MCP response format: markdown for readable model details, json for raw metadata.")
});

export function registerGetModelDetailsTool(server: McpServer): void {
  server.registerTool(
    "pollinations_get_model_details",
    {
      title: "Get Pollinations Model Details",
      description: GET_MODEL_DETAILS_DESCRIPTION,
      inputSchema: getModelDetailsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ model, refresh, response_format }) => {
      try {
        const client = new PollinationsClient();
        const details = await client.getModel(model, refresh);

        if (!details) {
          return {
            content: [
              {
                type: "text",
                text: `No Pollinations model matched "${model}". Try pollinations_list_models with a broader search.`
              }
            ],
            isError: true
          };
        }

        if (response_format === "json") {
          return jsonResponse(details);
        }

        return textResponse(formatModelDetails(details));
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}

function formatModelDetails(model: PollinationsModel): string {
  const lines = [
    `# ${String(model.name ?? model.id ?? "Pollinations Model")}`,
    "",
    `- Category: ${String(model.category ?? model.type ?? model.modality ?? "unknown")}`
  ];

  addLine(lines, "Title", model.title);
  addLine(lines, "Brand", model.brand);
  addLine(lines, "Description", model.description);
  addLine(lines, "Aliases", model.aliases?.join(", "));
  addLine(lines, "Input modalities", model.input_modalities?.join(", "));
  addLine(lines, "Output modalities", model.output_modalities?.join(", "));
  addLine(lines, "Voices", Array.isArray(model.voices) ? model.voices.join(", ") : undefined);
  addLine(lines, "Max reference images", model.max_reference_images);
  addLine(lines, "Paid only", typeof model.paid_only === "boolean" ? (model.paid_only ? "yes" : "no") : undefined);
  addJsonLine(lines, "Pricing", model.pricing ?? model.price);
  addJsonLine(lines, "Capabilities", model.capabilities);
  addJsonLine(lines, "Video capabilities", model.video_capabilities);
  addJsonLine(lines, "Image capabilities", model.image_capabilities);
  addJsonLine(lines, "Audio capabilities", model.audio_capabilities);

  lines.push("", "## Raw Metadata", "", "```json", JSON.stringify(model, null, 2), "```");

  return lines.join("\n");
}

function addLine(lines: string[], label: string, value: unknown): void {
  if (value !== undefined && value !== "") {
    lines.push(`- ${label}: ${String(value)}`);
  }
}

function addJsonLine(lines: string[], label: string, value: unknown): void {
  if (value !== undefined) {
    lines.push(`- ${label}: \`${JSON.stringify(value)}\``);
  }
}
