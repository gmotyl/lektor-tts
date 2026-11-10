// The fake engine: a local OpenAI-compatible TTS server with silent audio, for screenshots
// and visual checks without a GPU or an API key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { start } from "../fake-engine.mjs";

const ORIGIN = "chrome-extension://abcdefghijklmnop";

test("fake engine serves models, voices and silent speech with CORS", async (t) => {
  const engine = await start({ port: 0 });
  t.after(() => engine.close());
  assert.match(engine.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  const models = await fetch(`${engine.url}/v1/models`, { headers: { Origin: ORIGIN } });
  assert.equal(models.status, 200);
  assert.equal(models.headers.get("access-control-allow-origin"), "*");
  const body = await models.json();
  assert.ok(Array.isArray(body.data) && body.data.length > 0);

  const voices = await fetch(`${engine.url}/v1/audio/voices`, { headers: { Origin: ORIGIN } });
  assert.equal(voices.status, 200);
  assert.equal(voices.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await voices.json(), { voices: ["demo-1", "demo-2"] });

  // Preflight for the JSON POST with an Authorization header.
  const preflight = await fetch(`${engine.url}/v1/audio/speech`, {
    method: "OPTIONS",
    headers: {
      Origin: ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type, authorization",
    },
  });
  assert.ok(preflight.status === 200 || preflight.status === 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.match(preflight.headers.get("access-control-allow-methods"), /POST/);
  assert.match(preflight.headers.get("access-control-allow-headers").toLowerCase(), /content-type/);
  assert.match(preflight.headers.get("access-control-allow-headers").toLowerCase(), /authorization/);

  const speech = await fetch(`${engine.url}/v1/audio/speech`, {
    method: "POST",
    headers: { Origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ model: "tts-1", input: "Hello there.", voice: "demo-1" }),
  });
  assert.equal(speech.status, 200);
  assert.equal(speech.headers.get("content-type"), "audio/mpeg");
  assert.equal(speech.headers.get("access-control-allow-origin"), "*");
  const audio = Buffer.from(await speech.arrayBuffer());
  // MPEG audio frames: each starts with an 11-bit frame sync.
  assert.ok(audio.length > 0 && audio.length < 256 * 1024, `short audio (${audio.length} bytes)`);
  assert.equal(audio[0], 0xff);
  assert.equal(audio[1] & 0xe0, 0xe0);
});
