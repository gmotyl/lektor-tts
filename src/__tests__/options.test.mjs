import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { initOptions } from "../options.mjs";
import { DEFAULTS } from "../settings.mjs";
import { PRESETS, voicesFor } from "../presets.mjs";

const HTML_URL = new URL("../options.html", import.meta.url);
const HTML = readFileSync(HTML_URL, "utf8");

// Fake chrome surface the options page uses: storage.sync and permissions.request.
function fakeChrome({ stored = {}, grant = true } = {}) {
  const data = { ...stored };
  const requests = [];
  const writes = [];
  return {
    data,
    requests,
    writes,
    storage: {
      sync: {
        get: async (defaults) => ({ ...defaults, ...data }),
        set: async (obj) => {
          writes.push(obj);
          Object.assign(data, obj);
        },
      },
    },
    permissions: {
      request: async (opts) => {
        requests.push(opts);
        return grant;
      },
    },
  };
}

// Fake fetch for the OpenAI check: answers every request with `status` and `body`.
function fakeFetch({ status = 200, body = { data: [] } } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, ...init });
    const text = JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };
  return { calls, impl };
}

async function setup({ stored, grant, voices, fetch } = {}) {
  const { document } = parseHTML(HTML);
  const chrome = fakeChrome({ stored, grant });
  const calls = [];
  const listVoices = async (settings) => {
    calls.push(settings);
    return typeof voices === "function" ? voices(settings) : voices;
  };
  const page = initOptions({ doc: document, chrome, listVoices, fetch: fetch?.impl });
  await page.ready;
  return { document, chrome, calls, page };
}

function dispatchSubmit(document) {
  const form = document.getElementById("options");
  form.dispatchEvent(new document.defaultView.Event("submit", { bubbles: true, cancelable: true }));
}

async function submit(document, page) {
  dispatchSubmit(document);
  await page.saving;
}

// Selects a preset card the way a click does: check the radio and fire `change`.
function choose(document, id) {
  const radio = document.querySelector(`input[name="preset"][value="${id}"]`);
  radio.checked = true;
  radio.dispatchEvent(new document.defaultView.Event("change", { bubbles: true }));
}

const status = (document) => document.getElementById("status").textContent;
const shown = (el) => {
  for (let node = el; node && node.nodeType === 1; node = node.parentNode) {
    if (node.hasAttribute("hidden")) return false;
  }
  return true;
};
const options = (select) => [...select.querySelectorAll("option")].map((o) => o.value);
// linkedom has no select.value setter: mark the option selected instead.
function pick(select, value) {
  for (const o of select.querySelectorAll("option")) {
    if (o.value === value) o.setAttribute("selected", "");
    else o.removeAttribute("selected");
  }
}

test("options lists engine voices", async () => {
  const { document, calls } = await setup({
    stored: { preset: "omnivoice" },
    voices: { ok: true, voices: ["anna", "ben", "carl"] },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].baseUrl, DEFAULTS.baseUrl);
  const voice = document.getElementById("voice");
  assert.equal(voice.tagName, "SELECT");
  assert.deepEqual(options(voice), ["anna", "ben", "carl"]);
  // Empty stored voice → the first one is selected.
  assert.equal(voice.value, "anna");
  assert.ok(document.querySelector('label[for="voice"]'));
  assert.match(status(document), /Connected/);

  // A stored voice in the list is selected.
  const again = await setup({ stored: { voice: "ben" }, voices: { ok: true, voices: ["anna", "ben"] } });
  assert.equal(again.document.getElementById("voice").value, "ben");
});

test("options falls back to free-text voice", async () => {
  const { document } = await setup({ stored: { voice: "my-voice" }, voices: { ok: true, voices: null } });
  const voice = document.getElementById("voice");
  assert.equal(voice.tagName, "INPUT");
  assert.equal(voice.getAttribute("type"), "text");
  assert.equal(voice.value, "my-voice");
  assert.match(status(document), /Connected/);
});

test("options shows connection error and still saves", async () => {
  const { document, chrome, page } = await setup({
    stored: { preset: "omnivoice" },
    voices: { ok: false, error: "fetch failed" },
  });
  assert.match(status(document), /fetch failed/);
  const voice = document.getElementById("voice");
  assert.equal(voice.tagName, "INPUT");
  voice.value = "typed";
  document.getElementById("speed").value = "1.5";
  await submit(document, page);
  assert.equal(chrome.data.voice, "typed");
  assert.equal(chrome.data.speed, 1.5);
  assert.equal(chrome.data.baseUrl, DEFAULTS.baseUrl);
  assert.equal(chrome.data.preset, "omnivoice");
  assert.equal(chrome.requests.length, 0);
  assert.match(status(document), /Saved/);
  assert.match(status(document), /fetch failed/);
});

test("non-local base url requests host permission", async () => {
  const { document, chrome, page } = await setup({ voices: { ok: true, voices: ["anna"] } });
  choose(document, "other");
  document.getElementById("baseUrl").value = "https://spock.example.ts.net:8444/v1";
  await submit(document, page);
  assert.deepEqual(chrome.requests, [{ origins: ["https://spock.example.ts.net:8444/*"] }]);
  assert.equal(chrome.data.baseUrl, "https://spock.example.ts.net:8444/v1");

  // 127.0.0.1 is covered by the manifest's host permissions: no prompt.
  document.getElementById("baseUrl").value = "http://127.0.0.1:9000/v1";
  await submit(document, page);
  assert.equal(chrome.requests.length, 1);
  assert.equal(chrome.data.baseUrl, "http://127.0.0.1:9000/v1");
});

test("denied permission does not save", async () => {
  const { document, chrome, page } = await setup({ grant: false, voices: { ok: true, voices: ["anna"] } });
  choose(document, "other");
  document.getElementById("baseUrl").value = "https://tts.example.com/v1";
  document.getElementById("speed").value = "1.7";
  await submit(document, page);
  assert.deepEqual(chrome.requests, [{ origins: ["https://tts.example.com/*"] }]);
  assert.equal(chrome.writes.length, 0);
  assert.deepEqual(chrome.data, {});
  assert.match(document.getElementById("message").textContent, /permission/i);
  assert.match(document.getElementById("message").textContent, /tts\.example\.com/);
});

test("an empty voice list reports that the server lists no voices", async () => {
  const { document } = await setup({ stored: { voice: "typed" }, voices: { ok: true, voices: [] } });
  assert.match(status(document), /lists no voices/);
  const voice = document.getElementById("voice");
  assert.equal(voice.tagName, "INPUT");
  assert.equal(voice.value, "typed");
});

test("options saves the autoscroll checkbox", async () => {
  const { document, chrome, page } = await setup({
    stored: { autoscroll: false, preset: "omnivoice" },
    voices: { ok: true, voices: null },
  });
  const box = document.getElementById("autoscroll");
  assert.equal(box.getAttribute("type"), "checkbox");
  assert.ok(document.querySelector('label[for="autoscroll"]'));
  assert.equal(box.checked, false);
  box.checked = true;
  await submit(document, page);
  assert.equal(chrome.data.autoscroll, true);
});

// --- Setup screen (Task 10) ---

test("header shows icon, name and lede", async () => {
  const { document } = await setup();
  const header = document.querySelector("header");
  assert.ok(header);
  const img = header.querySelector("img");
  assert.ok(img, "header icon");
  // The icon path is relative to the page and must exist in the packaged extension.
  const iconPath = fileURLToPath(new URL(img.getAttribute("src"), HTML_URL));
  assert.match(iconPath, /icons[\\/]icon\d+\.png$/);
  assert.ok(existsSync(iconPath), `${iconPath} exists`);
  assert.equal(header.querySelector("h1").textContent.trim(), "Lektor TTS");
  assert.equal(
    document.querySelector(".lede").textContent.trim(),
    "Lektor reads web pages aloud through a text-to-speech server. Choose one to get started.",
  );
});

test("three preset cards in order with their copy", async () => {
  const { document } = await setup();
  const group = document.querySelector('[role="radiogroup"]');
  assert.ok(group);
  assert.equal(document.getElementById(group.getAttribute("aria-labelledby")).textContent.trim(), "Speech engine");
  const cards = [...group.querySelectorAll("label.card")];
  assert.deepEqual(
    cards.map((c) => [c.querySelector("input").value, c.querySelector("b").textContent, c.querySelector("span").textContent]),
    [
      ["openai", "OpenAI", "Paste an API key. Paid per use."],
      ["omnivoice", "omnivoice-server", "Free, runs on your own computer."],
      ["other", "Other server", "Any OpenAI-compatible endpoint."],
    ],
  );
  for (const c of cards) assert.equal(c.querySelector("input").getAttribute("type"), "radio");
  // Cards wrap at 390 px: an auto-fit grid of columns at least 150 px wide.
  assert.match(HTML, /\.cards\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(150px,\s*1fr\)\)/);
});

test("checked card is marked", async () => {
  // A fresh install has no preset: no card is checked.
  const fresh = await setup();
  assert.equal(fresh.document.querySelectorAll("label.card.checked").length, 0);
  assert.equal(fresh.document.querySelectorAll('input[name="preset"]:checked').length, 0);

  const { document } = await setup({ stored: { preset: "other", baseUrl: "https://tts.example.com/v1" }, voices: { ok: true, voices: null } });
  const marked = () => [...document.querySelectorAll("label.card.checked")].map((c) => c.querySelector("input").value);
  assert.deepEqual(marked(), ["other"]);
  assert.equal(document.querySelector('input[name="preset"][value="other"]').checked, true);
  choose(document, "openai");
  assert.deepEqual(marked(), ["openai"]);
  // Navy border and a yellow dot on the checked card.
  assert.match(HTML, /\.card\.checked\s*\{[^}]*border-color:\s*var\(--ink\)/);
  assert.match(HTML, /\.card\.checked::after\s*\{[^}]*background:\s*var\(--hi\)/);
  assert.match(HTML, /--ink:\s*#1e2a4a/);
  assert.match(HTML, /--hi:\s*#ffd54a/);
});

test("openai card shows key and fixed voices, no url", async () => {
  const { document, calls } = await setup();
  choose(document, "openai");
  assert.equal(shown(document.getElementById("baseUrl")), false);
  const key = document.getElementById("apiKey");
  assert.equal(shown(key), true);
  assert.equal(key.getAttribute("type"), "password");
  const hint = document.getElementById("apiKey-hint");
  assert.equal(shown(hint), true);
  assert.match(hint.textContent, /platform\.openai\.com/);
  assert.match(hint.textContent, /sent only to OpenAI/);
  const voice = document.getElementById("voice");
  assert.equal(voice.tagName, "SELECT");
  assert.deepEqual(options(voice), voicesFor("openai", PRESETS.openai.defaultModel));
  // The voices are fixed: no engine call.
  assert.equal(calls.length, 0);
});

test("omnivoice card shows localhost address and GitHub quick start link", async () => {
  const { document, page } = await setup({ voices: { ok: true, voices: ["anna", "ben"] } });
  choose(document, "omnivoice");
  const url = document.getElementById("baseUrl");
  assert.equal(shown(url), true);
  assert.equal(url.value, "http://localhost:8892/v1");
  const link = [...document.querySelectorAll("a")].find((a) => a.textContent.trim() === "Quick start");
  assert.ok(link, "Quick start link");
  assert.equal(shown(link), true);
  assert.equal(link.getAttribute("href"), PRESETS.omnivoice.quickStartUrl);
  assert.equal(link.getAttribute("target"), "_blank");
  assert.match(link.parentNode.textContent, /\.\/omnivoicectl start/);
  // The voice list fills after a successful test.
  assert.notDeepEqual(options(document.getElementById("voice")), ["anna", "ben"]);
  await submit(document, page);
  const voice = document.getElementById("voice");
  assert.equal(voice.tagName, "SELECT");
  assert.deepEqual(options(voice), ["anna", "ben"]);
});

test("other card shows url, optional key and voice", async () => {
  const { document, page } = await setup({ voices: { ok: true, voices: null } });
  choose(document, "other");
  assert.equal(shown(document.getElementById("baseUrl")), true);
  assert.equal(document.querySelector('label[for="baseUrl"]').textContent.trim(), "Base URL");
  assert.equal(shown(document.getElementById("apiKey")), true);
  assert.match(document.querySelector('label[for="apiKey"]').textContent, /optional/);
  assert.equal(shown(document.getElementById("voice")), true);
  // Free text when the server lists no voices …
  document.getElementById("baseUrl").value = "http://localhost:9000/v1";
  await submit(document, page);
  assert.equal(document.getElementById("voice").tagName, "INPUT");

  // … a select when it does.
  const listed = await setup({ voices: { ok: true, voices: ["x1", "x2"] } });
  choose(listed.document, "other");
  listed.document.getElementById("baseUrl").value = "http://localhost:9000/v1";
  await submit(listed.document, listed.page);
  assert.equal(listed.document.getElementById("voice").tagName, "SELECT");
  assert.deepEqual(options(listed.document.getElementById("voice")), ["x1", "x2"]);
});

test("single Save and test button", async () => {
  const { document } = await setup();
  const buttons = [...document.querySelectorAll("button")];
  assert.deepEqual(buttons.map((b) => b.textContent.trim()), ["Save and test"]);
  assert.equal(buttons[0].getAttribute("type"), "submit");
  assert.ok(buttons[0].classList.contains("primary"));
  assert.equal(document.getElementById("test"), null);
  assert.ok(!/Test connection/.test(HTML));
});

test("save and test with openai requests permission, saves, tests and reports voices", async () => {
  const fetch = fakeFetch();
  const { document, chrome, calls, page } = await setup({ fetch });
  choose(document, "openai");
  document.getElementById("apiKey").value = "sk-test";
  pick(document.getElementById("voice"), "coral");
  dispatchSubmit(document);
  // Asked synchronously, inside the submit's user gesture.
  assert.deepEqual(chrome.requests, [{ origins: ["https://api.openai.com/*"] }]);
  await page.saving;
  assert.equal(chrome.data.preset, "openai");
  assert.equal(chrome.data.baseUrl, "https://api.openai.com/v1");
  assert.equal(chrome.data.apiKey, "sk-test");
  assert.equal(chrome.data.model, "gpt-4o-mini-tts");
  assert.equal(chrome.data.voice, "coral");
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, "https://api.openai.com/v1/models");
  assert.equal(fetch.calls[0].method, "GET");
  assert.equal(fetch.calls[0].headers.Authorization, "Bearer sk-test");
  assert.equal(calls.length, 0);
  const n = voicesFor("openai", "gpt-4o-mini-tts").length;
  assert.match(status(document), new RegExp(`^✓ Connected to OpenAI · ${n} voices`));
  assert.match(status(document), /Alt\+Shift\+R/);
});

test("401 shows the engine message and keeps settings", async () => {
  const fetch = fakeFetch({ status: 401, body: { error: { message: "Incorrect API key provided: sk-bad." } } });
  const { document, chrome, page } = await setup({ fetch });
  choose(document, "openai");
  document.getElementById("apiKey").value = "sk-bad";
  await submit(document, page);
  assert.match(status(document), /Incorrect API key provided: sk-bad\./);
  assert.ok(document.getElementById("status").className.includes("error"));
  assert.equal(chrome.data.preset, "openai");
  assert.equal(chrome.data.apiKey, "sk-bad");
});

test("denied permission saves nothing", async () => {
  const fetch = fakeFetch();
  const { document, chrome, page } = await setup({ grant: false, fetch });
  choose(document, "openai");
  document.getElementById("apiKey").value = "sk-test";
  await submit(document, page);
  assert.equal(chrome.writes.length, 0);
  assert.equal(fetch.calls.length, 0);
  assert.equal(document.getElementById("message").textContent, "Lektor needs permission to reach https://api.openai.com");
});

test("more settings is collapsed and model change updates voices", async () => {
  const { document } = await setup({ stored: { preset: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini-tts", voice: "verse" } });
  const more = document.querySelector("details#more");
  assert.ok(more);
  assert.equal(more.hasAttribute("open"), false);
  assert.equal(more.querySelector("summary").textContent.trim(), "More settings");
  for (const id of ["speed", "autoscroll", "model"]) assert.ok(more.querySelector(`#${id}`), `${id} inside More settings`);
  assert.equal(document.getElementById("voice").value, "verse");

  const model = document.getElementById("model");
  assert.equal(model.tagName, "SELECT");
  assert.deepEqual(options(model), PRESETS.openai.models);
  pick(model, "tts-1");
  model.dispatchEvent(new document.defaultView.Event("change", { bubbles: true }));
  const voice = document.getElementById("voice");
  assert.deepEqual(options(voice), voicesFor("openai", "tts-1"));
  // "verse" is not a tts-1 voice: the first one is selected.
  assert.equal(voice.value, voicesFor("openai", "tts-1")[0]);
});

test("footer has the buy me a coffee link", async () => {
  const { document } = await setup();
  const link = document.querySelector("footer a");
  assert.ok(link);
  assert.equal(link.textContent.trim(), "Buy me a coffee");
  assert.equal(link.getAttribute("href"), "https://buymeacoffee.com/motyl.dev");
  // Below "More settings" in document order.
  const inOrder = [...document.querySelectorAll("details#more, footer a")];
  assert.deepEqual(inOrder.map((el) => el.tagName), ["DETAILS", "A"]);
});

test("an api key typed for one preset is never sent to another", async () => {
  const { document, calls, page } = await setup({
    stored: { preset: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "sk-secret", model: "gpt-4o-mini-tts", voice: "coral" },
    voices: { ok: true, voices: ["x1"] },
  });
  assert.equal(document.getElementById("apiKey").value, "sk-secret");
  choose(document, "other");
  document.getElementById("baseUrl").value = "http://localhost:9000/v1";
  await submit(document, page);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].baseUrl, "http://localhost:9000/v1");
  assert.equal(calls[0].apiKey, "");
  assert.equal(calls[0].headers?.Authorization, undefined);
});

test("a denied or invalid save clears a stale connected status", async () => {
  const { document, page } = await setup({
    stored: { preset: "other", baseUrl: "http://localhost:9000/v1" },
    voices: { ok: true, voices: ["x1"] },
  });
  assert.match(status(document), /Connected/);
  // Invalid URL.
  document.getElementById("baseUrl").value = "not a url";
  await submit(document, page);
  assert.match(document.getElementById("message").textContent, /Not saved/);
  assert.equal(status(document), "");

  // Denied permission.
  const denied = await setup({
    stored: { preset: "other", baseUrl: "http://localhost:9000/v1" },
    grant: false,
    voices: { ok: true, voices: ["x1"] },
  });
  assert.match(status(denied.document), /Connected/);
  denied.document.getElementById("baseUrl").value = "https://tts.example.com/v1";
  await submit(denied.document, denied.page);
  assert.match(denied.document.getElementById("message").textContent, /permission/);
  assert.equal(status(denied.document), "");
  assert.equal(denied.chrome.writes.length, 0);
});
