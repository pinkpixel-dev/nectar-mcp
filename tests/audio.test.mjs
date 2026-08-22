import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { saveMediaUrl } from "../dist/lib/media.js";
import { PollinationsClient } from "../dist/lib/pollinations-client.js";
import { createServer } from "../dist/server.js";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("the MCP server registers audio generation with the existing tool set", () => {
  const server = createServer();
  const toolNames = Object.keys(server._registeredTools);

  assert.equal(toolNames.includes("pollinations_generate_audio"), true);
  assert.equal(toolNames.includes("pollinations_list_models"), true);
  assert.equal(toolNames.length, 7);
});

test("generateAudio sends the encoded prompt, model, voice, safety filter, and API key", async () => {
  let requestUrl;
  let requestInit;

  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestInit = init;
    const response = new Response(new Uint8Array([0x49, 0x44, 0x33]), {
      headers: {
        "content-type": "audio/mpeg",
        "content-length": "3"
      }
    });
    Object.defineProperty(response, "url", {
      value: "https://media.pollinations.ai/audio-result"
    });
    return response;
  };

  const client = new PollinationsClient("sk_test_key");
  const result = await client.generateAudio({
    prompt: "Rain & thunder / close",
    model: "eleven-sfx",
    voice: "nova",
    safe: "privacy,secrets"
  });

  const parsedUrl = new URL(requestUrl);
  assert.equal(parsedUrl.pathname, "/audio/Rain%20%26%20thunder%20%2F%20close");
  assert.equal(parsedUrl.searchParams.get("model"), "eleven-sfx");
  assert.equal(parsedUrl.searchParams.get("voice"), "nova");
  assert.equal(parsedUrl.searchParams.get("safe"), "privacy,secrets");
  assert.equal(new Headers(requestInit.headers).get("authorization"), "Bearer sk_test_key");
  assert.deepEqual(result, {
    url: "https://media.pollinations.ai/audio-result",
    contentType: "audio/mpeg",
    contentLength: "3"
  });
});

test("audio discovery uses the audio catalog and combined discovery uses both catalogs", async () => {
  const requestedPaths = [];

  globalThis.fetch = async (url) => {
    const parsedUrl = new URL(String(url));
    requestedPaths.push(parsedUrl.pathname);

    const models = parsedUrl.pathname === "/audio/models"
      ? [{ name: "elevenmusic", category: "audio", voices: ["nova"] }]
      : [{ name: "flux", category: "image" }];

    return Response.json(models);
  };

  const client = new PollinationsClient();
  const audioModels = await client.listModels({ modality: "audio", refresh: true });
  assert.deepEqual(audioModels.map((model) => model.name), ["elevenmusic"]);
  assert.deepEqual(requestedPaths, ["/audio/models"]);

  requestedPaths.length = 0;
  const allModels = await client.listModels({ modality: "all", refresh: true });
  assert.deepEqual(allModels.map((model) => model.name), ["flux", "elevenmusic"]);
  assert.deepEqual(requestedPaths.sort(), ["/audio/models", "/image/models"]);

  requestedPaths.length = 0;
  const details = await client.getModel("elevenmusic");
  assert.equal(details?.category, "audio");
  assert.deepEqual(requestedPaths, []);
});

for (const mediaCase of [
  {
    name: "MP3",
    bytes: Buffer.from([0x49, 0x44, 0x33, 0x04]),
    extension: "mp3",
    mediaType: "audio/mpeg"
  },
  {
    name: "WAV",
    bytes: Buffer.from("RIFF0000WAVEdata", "ascii"),
    extension: "wav",
    mediaType: "audio/wav"
  },
  {
    name: "FLAC",
    bytes: Buffer.from("fLaC0000", "ascii"),
    extension: "flac",
    mediaType: "audio/flac"
  },
  {
    name: "Ogg Opus",
    bytes: Buffer.from("OggS000000000000000000000000OpusHead", "ascii"),
    extension: "opus",
    mediaType: "audio/opus"
  }
]) {
  test(`saveMediaUrl detects and saves ${mediaCase.name} data`, async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "nectar-audio-test-"));

    try {
      globalThis.fetch = async () => new Response(mediaCase.bytes, {
        headers: { "content-type": "application/octet-stream" }
      });

      const result = await saveMediaUrl("https://media.pollinations.ai/test-audio", {
        output_dir: outputDir,
        filename_prefix: "audio-check"
      });

      assert.deepEqual(result.errors, []);
      assert.equal(result.files.length, 1);
      assert.equal(path.extname(result.files[0].path), `.${mediaCase.extension}`);
      assert.equal(result.files[0].mediaType, mediaCase.mediaType);
      assert.deepEqual(await readFile(result.files[0].path), mediaCase.bytes);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
}
