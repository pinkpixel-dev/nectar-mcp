import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { jsonResponse, textResponse } from "../lib/format.js";
import { saveMediaUrl } from "../lib/media.js";
import { PollinationsClient } from "../lib/pollinations-client.js";
import { toToolError } from "../lib/errors.js";

const GENERATE_VIDEO_DESCRIPTION = [
  "Generate a video from a text prompt using Pollinations video models. This calls GET /video/{prompt} and returns the final media URL plus response metadata. Use this when the user wants text-to-video or image-to-video output. For static images, use pollinations_generate_image instead.",
  "Args:",
  "- prompt (string, required): Text description of the video. Include subject, scene, motion, camera movement, mood, lighting, style, and any timing notes.",
  "- model (string, required): Pollinations video model slug. Known video models include veo, seedance-pro, seedance-2.0, wan, wan-fast, wan-pro, wan-pro-1080p, grok-video-pro, ltx-2, p-video-720p, p-video-1080p, nova-reel. Call pollinations_list_models with modality=video first for current capabilities/pricing.",
  "- duration (number, optional, 1-120): Duration in seconds. Model rules vary: veo supports 4, 6, or 8s; seedance supports 2-10s; seedance-2.0 supports 4-15s; wan supports 2-15s; nova-reel supports 6-120s in multiples of 6.",
  "- aspectRatio (string, optional): 16:9 or 9:16. Use 16:9 for landscape, 9:16 for vertical/social video. If omitted, Pollinations may derive it from width/height.",
  "- width and height (numbers, optional): Requested dimensions. Video models map these to nearest supported resolution tiers such as 480p, 720p, or 1080p.",
  "- image (string or string[], optional): Reference frame URL(s). For video, image[0] is the start frame. image[1] is the end frame for models with end_frame support. End frame is documented for veo, seedance, seedance-2.0, and wan-fast; other models may ignore image[1].",
  "- audio (boolean, optional): Request generated audio where supported. For veo, set true to enable audio. wan may generate audio regardless of this flag.",
  "- seed (number, optional): Reproducibility seed. Use -1 for random. Supported by seedance and nova-reel; unsupported models may ignore it.",
  "- quality (string, optional): low, medium, high, or hd. Unsupported models may ignore it.",
  "- safe (string, optional): Comma-separated safety filters: privacy, secrets, sexual, violence, shield, true, nsfw.",
  "- save_output (boolean, optional, default true): Download and save the returned video URL to a local file and include the path in the result.",
  "- output_dir (string, optional): Directory for saved files. Defaults to NECTAR_OUTPUT_DIR or ./nectar-output relative to the server process.",
  "- filename_prefix (string, optional): Prefix for saved video filenames. Nectar sanitizes this value.",
  "- response_format (string, optional, default markdown): markdown summary or json metadata.",
  "Returns: Markdown or JSON containing the video URL, content type, and content length when available.",
  "Examples: Use model=veo duration=8 aspectRatio=16:9 for a polished landscape clip. Use image=[startUrl,endUrl] with seedance-2.0 or wan-fast for first/last-frame interpolation. Use aspectRatio=9:16 for TikTok/Reels style output.",
  "Error handling: 401 means missing/invalid POLLINATIONS_API_KEY. 402 means insufficient pollen. 403 means key/model permission issue. 429 means wait and retry. 400 often means invalid duration/aspect/model combination; call pollinations_list_models and retry with supported values."
].join(" ");

const generateVideoSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(32_000)
    .describe("Required text description of the video. Include scene, subject, motion, camera movement, style, lighting, and timing notes."),
  model: z
    .string()
    .trim()
    .min(1)
    .describe("Required Pollinations video model slug. Examples: veo, seedance-pro, seedance-2.0, wan, wan-fast, wan-pro, wan-pro-1080p, grok-video-pro, ltx-2, p-video-720p, p-video-1080p, nova-reel. Call pollinations_list_models with modality=video if unsure."),
  width: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Optional requested width in pixels. Video models map this to the nearest supported tier such as 480p, 720p, or 1080p."),
  height: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Optional requested height in pixels. Video models map this to the nearest supported tier such as 480p, 720p, or 1080p."),
  seed: z
    .number()
    .int()
    .min(-1)
    .max(2_147_483_647)
    .optional()
    .describe("Optional seed. Use -1 for random. Supported by seedance and nova-reel according to current docs; unsupported models may ignore it."),
  safe: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional comma-separated safety filters: privacy, secrets, sexual, violence, shield, true, nsfw. true enables privacy,secrets. nsfw enables sexual,violence."),
  quality: z
    .enum(["low", "medium", "high", "hd"])
    .optional()
    .describe("Optional quality level. Unsupported models may ignore it."),
  image: z
    .union([z.string().url(), z.array(z.string().url()).min(1).max(2)])
    .optional()
    .describe("Optional reference image URL or up to two URLs. image[0] is the start frame. image[1] is the end frame for models that support end_frame, documented for veo, seedance, seedance-2.0, and wan-fast."),
  duration: z
    .number()
    .int()
    .min(1)
    .max(120)
    .optional()
    .describe("Video duration in seconds. Model support varies: veo 4/6/8; seedance 2-10; seedance-2.0 4-15; wan 2-15; nova-reel 6-120 in multiples of 6."),
  aspectRatio: z
    .enum(["16:9", "9:16"])
    .optional()
    .describe("Optional video aspect ratio. Use 16:9 for landscape and 9:16 for vertical/social video. If omitted, Pollinations may derive it from width and height."),
  audio: z
    .boolean()
    .optional()
    .describe("Whether to request generated audio when the model supports it. For veo, true enables audio. wan may generate audio regardless."),
  response_format: z
    .enum(["markdown", "json"])
    .default("markdown")
    .describe("MCP response format: markdown for readable summaries, json for returned URL/content metadata plus saved_files metadata when saving is enabled."),
  save_output: z
    .boolean()
    .default(true)
    .describe("Download and save the generated video URL to a local file."),
  output_dir: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Directory where generated video files should be saved. Defaults to NECTAR_OUTPUT_DIR or ./nectar-output."),
  filename_prefix: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("Optional prefix for saved video filenames. Example: product-teaser or intro-clip.")
});

export function registerGenerateVideoTool(server: McpServer): void {
  server.registerTool(
    "pollinations_generate_video",
    {
      title: "Generate Pollinations Video",
      description: GENERATE_VIDEO_DESCRIPTION,
      inputSchema: generateVideoSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ response_format, save_output, output_dir, filename_prefix, ...input }) => {
      try {
        const client = new PollinationsClient();
        const result = await client.generateVideo(input);
        const saved = save_output
          ? await saveMediaUrl(result.url, { output_dir, filename_prefix })
          : undefined;

        if (response_format === "json") {
          return jsonResponse({
            pollinations: result,
            saved_files: saved?.files ?? [],
            save_errors: saved?.errors ?? []
          });
        }

        const lines = [
          "# Video Generation Result",
          "",
          `Video URL: ${result.url}`,
          `Content type: ${result.contentType ?? "unknown"}`,
          `Content length: ${result.contentLength ?? "unknown"}`
        ];

        if (saved) {
          lines.push("", "## Saved Files");

          if (saved.files.length === 0) {
            lines.push("- No files were saved.");
          }

          for (const file of saved.files) {
            lines.push(`- ${file.path} (${file.mediaType ?? "unknown"}, ${file.bytes} bytes, from ${file.source})`);
          }

          for (const error of saved.errors) {
            lines.push(`- Save warning: ${error}`);
          }
        }

        return textResponse(lines.join("\n"));
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
