import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, isConfigured, loadSettings, saveSettings } from "../settings.mjs";
import { PRESET_IDS } from "../presets.mjs";

// Fake chrome.storage.sync: get(defaults) fills missing keys, set(obj) merges.
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (defaults) => ({ ...defaults, ...data }),
    set: async (obj) => {
      Object.assign(data, obj);
    },
  };
}

test("loadSettings returns defaults", async () => {
  assert.deepEqual(DEFAULTS, {
    baseUrl: "http://localhost:8892/v1",
    apiKey: "",
    voice: "",
    speed: 1.0,
    model: "tts-1",
    autoscroll: true,
    preset: "",
  });
  assert.deepEqual(await loadSettings(fakeStorage()), DEFAULTS);
  assert.deepEqual(await loadSettings(undefined), DEFAULTS);
});

test("speed is clamped", async () => {
  const storage = fakeStorage();
  assert.equal((await saveSettings(storage, { speed: 3 })).speed, 2);
  assert.equal(storage.data.speed, 2);
  await saveSettings(storage, { speed: 0.1 });
  assert.equal(storage.data.speed, 0.5);
  await saveSettings(storage, { speed: "1.3" });
  assert.equal(storage.data.speed, 1.3);
  await saveSettings(storage, { speed: "fast" });
  assert.equal(storage.data.speed, DEFAULTS.speed);
  // A patch only writes the keys it names, and unknown keys are dropped.
  await saveSettings(storage, { voice: "anna", junk: 1 });
  assert.deepEqual(storage.data, { speed: DEFAULTS.speed, voice: "anna" });
});

test("empty model and base URL fall back to the defaults", async () => {
  const storage = fakeStorage();
  const written = await saveSettings(storage, { model: "  ", baseUrl: "", apiKey: "", voice: "" });
  assert.equal(written.model, DEFAULTS.model);
  assert.equal(written.baseUrl, DEFAULTS.baseUrl);
  // apiKey and voice stay empty: empty is meaningful for them.
  assert.equal(written.apiKey, "");
  assert.equal(written.voice, "");
  // A blank value stored by an older version also loads as the default.
  const loaded = await loadSettings(fakeStorage({ model: "", baseUrl: " " }));
  assert.equal(loaded.model, DEFAULTS.model);
  assert.equal(loaded.baseUrl, DEFAULTS.baseUrl);
  assert.equal((await saveSettings(storage, { model: " tts-1-hd " })).model, "tts-1-hd");
});

test("autoscroll defaults to on and is stored as a boolean", async () => {
  const storage = fakeStorage();
  assert.equal((await loadSettings(storage)).autoscroll, true);
  assert.deepEqual(await saveSettings(storage, { autoscroll: false }), { autoscroll: false });
  assert.equal(storage.data.autoscroll, false);
  assert.equal((await loadSettings(storage)).autoscroll, false);
  // Form-ish values are coerced; anything but an explicit off value means on.
  assert.equal((await saveSettings(storage, { autoscroll: "false" })).autoscroll, false);
  assert.equal((await saveSettings(storage, { autoscroll: "true" })).autoscroll, true);
  assert.equal((await loadSettings(fakeStorage({ autoscroll: "junk" }))).autoscroll, true);
});

test("defaults include an empty preset", async () => {
  assert.equal(DEFAULTS.preset, "");
  assert.equal((await loadSettings(fakeStorage())).preset, "");
});

test("migrates a saved localhost 8892 setup to omnivoice and persists it", async () => {
  const storage = fakeStorage({ baseUrl: "http://localhost:8892/v1", voice: "anna" });
  const loaded = await loadSettings(storage);
  assert.equal(loaded.preset, "omnivoice");
  assert.equal(loaded.voice, "anna");
  assert.equal(storage.data.preset, "omnivoice");
});

test("migrates a saved non-local server to other", async () => {
  const storage = fakeStorage({ baseUrl: "https://spock-wsl.example.ts.net:8444/v1" });
  assert.equal((await loadSettings(storage)).preset, "other");
  assert.equal(storage.data.preset, "other");
});

test("untouched defaults stay unconfigured", async () => {
  const storage = fakeStorage({ baseUrl: DEFAULTS.baseUrl, apiKey: "", voice: "", model: DEFAULTS.model, speed: 1.5 });
  const loaded = await loadSettings(storage);
  assert.equal(loaded.preset, "");
  assert.equal(isConfigured(loaded), false);
  assert.equal("preset" in storage.data, false);
});

test("isConfigured is true for every preset id", () => {
  for (const preset of PRESET_IDS) assert.equal(isConfigured({ preset }), true, preset);
  assert.equal(isConfigured({ preset: "bogus" }), false);
  assert.equal(isConfigured(undefined), false);
});
