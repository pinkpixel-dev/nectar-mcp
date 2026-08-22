import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { toToolError } from "../lib/errors.js";
import { jsonResponse, textResponse } from "../lib/format.js";
import { saveMediaUrl } from "../lib/media.js";
import { PollinationsClient } from "../lib/pollinations-client.js";

const GENERATE_AUDIO_DESCRIPTION = [
  "Generate speech, music, or sound effects from a text prompt using Pollinations audio models. This calls GET /audio/{text}. The selected model determines the type of audio. Use a speech model for text-to-speech, a music model for a music prompt, or a sound-effects model for a sound description. This tool does not transcribe existing audio.",
  "Args:",
  "- prompt (string, required): For speech, provide the exact text to speak. For music or sound effects, describe the desired audio, mood, instruments, pacing, texture, or environment.",
  "- model (string, required): Current Pollinations audio model slug. Speech examples include elevenlabs, elevenflash, grok-tts, qwen-tts, qwen-tts-instruct, csm-1b, and kokoro. Music examples include elevenmusic, lyria-3-clip, stable-audio-3-medium, and stable-audio-3-large. Use eleven-sfx for sound effects. Call pollinations_list_models with modality=audio first for current models, voices, capabilities, and pricing.",
  "- voice (string, optional): Voice name for speech models that support voices. Read the selected model's live voices metadata instead of assuming that every voice works with every model. Omit this for music and sound effects unless the model metadata says otherwise.",
  "- safe (string, optional): Comma-separated safety filters: privacy, secrets, sexual, violence, shield, true, nsfw.",
  "- save_output (boolean, optional, default true): Download and save the returned audio URL to a local file and include the path in the result.",
  "- output_dir (string, optional): Directory for saved files. Defaults to NECTAR_OUTPUT_DIR or ./nectar-output relative to the server process.",
  "- filename_prefix (string, optional): Prefix for saved audio filenames. Nectar sanitizes this value.",
  "- response_format (string, optional, default markdown): markdown summary or json metadata.",
  "Returns: Markdown or JSON containing the audio URL, content type, content length, saved-file metadata, and save warnings when available.",
  "Examples: Use model=elevenlabs with a voice for spoken text. Use model=elevenmusic for a music prompt. Use model=eleven-sfx for a sound-effect description.",
  "Error handling: 401 means missing or invalid POLLINATIONS_API_KEY. 402 means insufficient pollen. 403 means the key or model lacks permission. 429 means wait and retry. 400 often means the model does not support the prompt or voice combination; inspect the audio model metadata and retry."
].join(" ");

const generateAudioSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(32_000)
    .describe("Required spoken text, music prompt, or sound-effect description. The selected model determines how Pollinations interprets it."),
  model: z
    .string()
    .trim()
    .min(1)
    .describe("Required live Pollinations audio model slug. Call pollinations_list_models with modality=audio to choose a current speech, music, or sound-effects model."),
  voice: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional live voice name for compatible speech models. Omit it for music and sound effects unless the selected model metadata supports voices."),
  safe: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional comma-separated safety filters: privacy, secrets, sexual, violence, shield, true, nsfw."),
  response_format: z
    .enum(["markdown", "json"])
    .default("markdown")
    .describe("MCP response format: markdown for a readable summary or json for URL and saved-file metadata."),
  save_output: z
    .boolean()
    .default(true)
    .describe("Download and save the generated audio to a local file."),
  output_dir: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Directory where generated audio files should be saved. Defaults to NECTAR_OUTPUT_DIR or ./nectar-output."),
  filename_prefix: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("Optional prefix for saved audio filenames. Examples: welcome-voice, ambient-loop, or door-slam.")
});

export function registerGenerateAudioTool(server: McpServer): void {
  server.registerTool(
    "pollinations_generate_audio",
    {
      title: "Generate Pollinations Audio",
      description: GENERATE_AUDIO_DESCRIPTION,
      inputSchema: generateAudioSchema,
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
        const result = await client.generateAudio(input);
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
          "# Audio Generation Result",
          "",
          `Audio URL: ${result.url}`,
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
