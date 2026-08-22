<p align="center">
  <img src="./logo.png" width="300" alt="Nectar MCP logo" />
</p>

<p align="center">
  <a href="https://pollinations.ai">
    <img src="./pollinations-badge.svg" width="200" alt="Pollinations.ai" />
  </a>
</p>

[![nectar-mcp MCP server](https://glama.ai/mcp/servers/pinkpixel-dev/nectar-mcp/badges/score.svg)](https://glama.ai/mcp/servers/pinkpixel-dev/nectar-mcp)

# Nectar MCP

Nectar is a stdio MCP server for Pollinations image, video, and audio generation. It gives MCP clients a focused set of creative media tools.

You can generate and edit images, create videos, and generate speech, music, or sound effects. Nectar also lists live models and checks pollen balance. It is intentionally not a full Pollinations wrapper. Text generation, transcription, embeddings, and unrelated account tools remain out of scope.

## Tools

| Tool | Purpose |
| --- | --- |
| `pollinations_list_models` | Lists current image, video, and audio models from Pollinations using separate 15-minute catalog caches, compact summaries, sorting, and capability filters. |
| `pollinations_get_model_details` | Returns full metadata for one image, video, or audio model by name or alias. |
| `pollinations_generate_image` | Generates an image from a text prompt with model, size/dimensions, quality, seed, safety, transparency, prompt enhancement, negative prompt, reference image, and response format options. |
| `pollinations_edit_image` | Edits one or more image URLs using a text prompt, with model, size/dimensions, quality, seed, safety, transparency, prompt enhancement, negative prompt, and response format options. |
| `pollinations_generate_video` | Generates a video from a text prompt, with model, duration, aspect ratio, resolution, seed, audio, safety, quality, and reference-frame controls. |
| `pollinations_generate_audio` | Generates speech, music, or sound effects with a selected audio model and optional voice, then saves the returned audio locally by default. |
| `pollinations_check_balance` | Checks the authenticated pollen balance or API key budget. |

## Requirements

- Node.js 20 or newer
- A Pollinations API key from [enter.pollinations.ai](https://enter.pollinations.ai)

Model listing does not require authentication. Generation and balance tools require `POLLINATIONS_API_KEY`.

Generated images, edited images, videos, and audio are saved locally by default. Set `NECTAR_OUTPUT_DIR` in your MCP client environment block to choose the default output folder. You can also pass `output_dir` per tool call.

## Install

## MCP Client Config

Most MCP clients should pass the API key through the server `env` block:

```json
{
  "mcpServers": {
    "pixara": {
      "command": "npx",
      "args": ["-y", "@pinkpixel/nectar-mcp"],
      "env": {
        "POLLINATIONS_API_KEY": "sk_your_key_here",
        "NECTAR_OUTPUT_DIR": "/absolute/path/to/nectar-output"
      }
    }
  }
}
```


For local development:

```bash
git clone https://github.com/pinkpixel-dev/nectar-mcp.git
cd nectar-mcp
npm install
npm run build
```

```json
{
  "mcpServers": {
    "nectar": {
      "command": "node",
      "args": ["/absolute/path/to/nectar-mcp/dist/index.js"],
      "env": {
        "POLLINATIONS_API_KEY": "sk_your_key_here",
        "NECTAR_OUTPUT_DIR": "/absolute/path/to/nectar-output"
      }
    }
  }
}
```

## Example Requests

Ask your MCP client:

```text
List Pollinations video models and help me choose one for a 9:16 product teaser.
```

```text
Generate a 1024x1024 image of a tiny yellow robot painter in a polished dark UI style.
```

```text
Edit this image URL so the background is transparent and the subject looks more premium.
```

```text
Generate a 6 second 16:9 video of a glowing pollen trail drifting across a dark studio surface.
```

```text
Generate a warm spoken welcome with the nova voice using a current Pollinations speech model.
```

```text
Generate a short lo-fi instrumental with soft piano, brushed drums, and a quiet vinyl texture.
```

```text
Generate the sound of a heavy wooden door closing in a large stone hall.
```

## Notes

- Image generation uses Pollinations' OpenAI-compatible image generation endpoint.
- Image editing currently supports image URLs. Local multipart file upload is intentionally left out of v1.
- Image, video, and audio tools default to `save_output: true`, converting base64 responses and downloaded URLs into local files.
- Image generation and image editing default to Pollinations `response_format: "b64_json"` because local decoding is the most reliable save path.
- Saved files go to `output_dir`, `NECTAR_OUTPUT_DIR`, or `./nectar-output`, in that order.
- Saved Pollinations media URLs are downloaded with the configured `POLLINATIONS_API_KEY`. Nectar does not send that key to non-Pollinations URLs.
- Tool descriptions intentionally include model examples, parameter guidance, return shape notes, and error-handling hints so MCP clients have enough context to call the tools correctly.
- Model listing is compact by default. Audio discovery reads `/audio/models`, including live voice metadata when Pollinations supplies it.
- Use `pollinations_get_model_details` when an agent needs full raw metadata for one model.
- Video generation returns the final media URL and response metadata.
- Audio generation uses `GET /audio/{text}`. The selected model determines whether the prompt produces speech, music, or a sound effect.
- Audio saving detects common MP3, WAV, FLAC, Ogg/Opus, AAC, MP4 audio, WebM audio, and PCM media types.
- Model support varies by capability, so call `pollinations_list_models` before using model-specific options.
- The server never stores your API key. Your MCP client passes it through the process environment.

## Development

```bash
npm run typecheck
npm run build
```

The server communicates over stdio and will stay running when started directly. Use an MCP client or inspector to interact with it.

## License

Apache-2.0

Made by [Pink Pixel](https://pinkpixel.dev).
