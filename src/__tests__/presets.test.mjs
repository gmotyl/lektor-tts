// Engine presets. OpenAI voice lists checked 2026-11-10 against
// https://platform.openai.com/docs/guides/text-to-speech (Voice options).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESET_IDS, PRESETS, voicesFor, presetForBaseUrl } from "../presets.mjs";

const TTS1_VOICES = ["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"];

test("openai preset lists gpt-4o-mini-tts voices", () => {
  const voices = voicesFor("openai", "gpt-4o-mini-tts");
  assert.equal(voices.length, 13);
  for (const v of [...TTS1_VOICES, "ballad", "verse", "marin", "cedar"]) assert.ok(voices.includes(v), v);
  assert.equal(new Set(voices).size, voices.length);
});

test("openai tts-1 and tts-1-hd list voices without ballad and verse", () => {
  for (const model of ["tts-1", "tts-1-hd"]) {
    const voices = voicesFor("openai", model);
    assert.equal(voices.length, 9, model);
    assert.deepEqual([...voices].sort(), [...TTS1_VOICES].sort(), model);
    for (const v of ["ballad", "verse", "marin", "cedar"]) assert.ok(!voices.includes(v), `${model} ${v}`);
  }
});

test("self-hosted presets defer voices to the engine", () => {
  for (const id of ["omnivoice", "other"]) {
    for (const model of ["", "tts-1", "gpt-4o-mini-tts", "omnivoice"]) {
      assert.equal(voicesFor(id, model), null, `${id} ${model}`);
    }
  }
});

test("openai preset defaults", () => {
  assert.deepEqual(PRESET_IDS, ["openai", "omnivoice", "other"]);
  assert.deepEqual(Object.keys(PRESETS), PRESET_IDS);
  const p = PRESETS.openai;
  assert.equal(p.id, "openai");
  assert.equal(p.baseUrl, "https://api.openai.com/v1");
  assert.equal(p.defaultModel, "gpt-4o-mini-tts");
  assert.deepEqual(p.models, ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"]);
  assert.equal(typeof p.label, "string");
});

test("omnivoice preset points at localhost 8892 and the GitHub quick start", () => {
  const p = PRESETS.omnivoice;
  assert.equal(p.id, "omnivoice");
  assert.equal(p.baseUrl, "http://localhost:8892/v1");
  assert.equal(p.quickStartUrl, "https://github.com/gmotyl/omnivoice-server#quick-start-read-web-pages-aloud");
  assert.equal(p.voicesByModel, undefined);
});

test("presetForBaseUrl maps known hosts", () => {
  assert.equal(presetForBaseUrl("http://localhost:8892/v1"), "omnivoice");
  assert.equal(presetForBaseUrl("http://127.0.0.1:8892/v1"), "omnivoice");
  assert.equal(presetForBaseUrl("https://api.openai.com/v1/"), "openai");
  assert.equal(presetForBaseUrl("https://spock.example.ts.net:8444/v1"), "other");
  assert.equal(presetForBaseUrl("not a url"), "other");
});
