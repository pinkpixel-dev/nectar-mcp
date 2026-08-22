# Changelog

## 1.1.0 - August 22, 2026

### 🎵 Audio generation

- Added `pollinations_generate_audio` for speech, music, and sound effects through Pollinations audio models.
- Added optional live voice selection for compatible speech models.
- Audio output now saves locally by default and reports its URL, media type, byte size, and saved path.

### 🔎 Model discovery

- Added `audio` to `pollinations_list_models` with data from `/audio/models`.
- Added audio model and voice metadata to model summaries and model details.
- Added separate 15-minute caches for the image/video and audio catalogs.

### 💾 Media files

- Added file detection for MP3, WAV, FLAC, Ogg/Opus, AAC, MP4 audio, WebM audio, and PCM responses.
- Fixed saved media metadata when Pollinations returns a generic `application/octet-stream` content type.

### 🧪 Tests

- Added mocked tests for audio requests, catalog routing, cached model details, and local audio saving.

### 🏷️ Versioning

- Bumped the package version from `1.0.0` to `1.1.0`.
- Changed MCP server metadata and the Pollinations user agent to read the version from `package.json`.

## 2026-07-11

### Changed

- Linked the Pollinations badge in the README to `https://pollinations.ai`.
- Optimized model discovery with a 15-minute in-memory `/image/models` cache.
- Made `pollinations_list_models` compact by default with `detail`, price/name sorting, and capability filters.
- Added `pollinations_get_model_details` for full metadata lookup by model name or alias.
- Fixed a Node fetch hang on `/image/models` by omitting undefined GET bodies and sending explicit JSON/connection headers for model catalog requests.
- Fixed `pollinations_list_models` modality filtering for the current `/image/models` response shape, which uses `category` and `output_modalities`.
- Improved model list markdown output with category, brand, title, description, aliases, input/output modalities, reference-image limits, and paid-only status.
- Image generation and image editing now default to Pollinations `response_format: "b64_json"` for more reliable local saving.
- Fixed local saving for authenticated Pollinations media URLs by sending `Authorization` only to `pollinations.ai` hosts.
- Expanded MCP tool descriptions with detailed usage guidance, available parameters, model examples, return shapes, and error-handling hints.
- Added image generation/editing schema support for `n`, `width`, `height`, `seed`, `enhance`, `negative_prompt`, and `transparent`.
- Image generation, image editing, and video generation now save returned media locally by default with `save_output`, `output_dir`, and `filename_prefix` options.

### Added

- Created the initial Nectar MCP stdio server for Pollinations image/video workflows.
- Added tools for model listing, image generation, image editing, video generation, and pollen balance checks.
- Added a typed Pollinations API client with shared timeout, auth, formatting, and error handling helpers.
- Added local media saving helpers for base64 images and generated media URLs.
- Added project documentation, MCP client config examples, roadmap, memory, and Apache-2.0 licensing.
