// Options page = setup screen: pick an engine preset, fill in what that preset needs, then
// "Save and test" asks for the host permission, saves and tests the connection. An extension
// page has the manifest's host permissions, so it calls the engine directly instead of going
// through the service worker.
import { checkModels as engineCheckModels, listVoices as engineListVoices } from "./engine.mjs";
import { DEFAULTS, isConfigured, loadSettings, saveSettings } from "./settings.mjs";
import { PRESETS, voicesFor } from "./presets.mjs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const START_HINT = "Try it: select text on any page and press Alt+Shift+R.";
const VOICE_PLACEHOLDER = "listed after Save and test, or type one";

// Origin that needs a runtime host permission, or null when the manifest already covers it.
// Throws on an invalid URL.
function permissionOrigin(baseUrl) {
  if (!String(baseUrl ?? "").trim()) throw new Error("enter the server's base URL");
  const u = new URL(baseUrl);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Base URL must start with http:// or https://");
  if (u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname)) return null;
  return u.origin;
}

// Field values each preset starts with before the user edits them.
function presetDrafts() {
  return {
    openai: { baseUrl: PRESETS.openai.baseUrl, apiKey: "", model: PRESETS.openai.defaultModel, voice: "" },
    omnivoice: { baseUrl: PRESETS.omnivoice.baseUrl, apiKey: "", model: PRESETS.omnivoice.defaultModel, voice: "" },
    other: { baseUrl: "", apiKey: "", model: DEFAULTS.model, voice: "" },
  };
}

export function initOptions({
  doc = globalThis.document,
  chrome = globalThis.chrome,
  fetch: fetchImpl,
  listVoices = (settings) => engineListVoices(settings, fetchImpl),
  checkModels = (settings) => engineCheckModels(settings, fetchImpl),
} = {}) {
  const $ = (id) => doc.getElementById(id);
  const form = $("options");
  const status = $("status");
  const message = $("message");
  const page = { ready: null, saving: Promise.resolve() };
  // The selected preset ("" = none yet), each preset's unsaved field values (so a key typed
  // for one engine is never sent to another) and the voices each engine listed in its last test.
  let preset = "";
  const drafts = presetDrafts();
  const listed = {};

  function setText(el, text, kind = "") {
    el.textContent = text;
    el.className = kind;
  }

  function setHidden(el, hidden) {
    if (hidden) el.setAttribute("hidden", "");
    else el.removeAttribute("hidden");
  }

  function option(value, selected) {
    const opt = doc.createElement("option");
    opt.value = value;
    opt.textContent = value;
    if (selected) opt.setAttribute("selected", "");
    return opt;
  }

  // Replace the voice control: a select of ids when the list is known, else free text.
  function renderVoice(voices, current) {
    const holder = $("voice-field");
    holder.textContent = "";
    let el;
    if (Array.isArray(voices) && voices.length) {
      el = doc.createElement("select");
      const selected = voices.includes(current) ? current : voices[0];
      for (const id of voices) el.appendChild(option(id, id === selected));
    } else {
      el = doc.createElement("input");
      el.setAttribute("type", "text");
      el.setAttribute("placeholder", VOICE_PLACEHOLDER);
      el.value = current ?? "";
    }
    el.id = "voice";
    el.setAttribute("name", "voice");
    holder.appendChild(el);
  }

  // OpenAI picks its model from a fixed list; other engines take any model name.
  function renderModel(id, current) {
    const holder = $("model-field");
    holder.textContent = "";
    let el;
    if (id === "openai") {
      const models = PRESETS.openai.models;
      const selected = models.includes(current) ? current : PRESETS.openai.defaultModel;
      el = doc.createElement("select");
      for (const m of models) el.appendChild(option(m, m === selected));
    } else {
      el = doc.createElement("input");
      el.setAttribute("type", "text");
      el.value = current ?? "";
    }
    el.id = "model";
    el.setAttribute("name", "model");
    holder.appendChild(el);
  }

  function knownVoices(id, model) {
    return id === "openai" ? voicesFor("openai", model) : listed[id] ?? null;
  }

  function stash() {
    if (!preset) return;
    drafts[preset] = {
      baseUrl: preset === "openai" ? PRESETS.openai.baseUrl : $("baseUrl").value,
      apiKey: $("apiKey").value,
      model: $("model").value,
      voice: $("voice").value,
    };
  }

  // Show the selected preset's card as checked and only the fields it needs.
  function show(id) {
    preset = id;
    for (const card of doc.querySelectorAll("label.card")) {
      const radio = card.querySelector("input");
      const on = radio.value === id;
      radio.checked = on;
      card.classList.toggle("checked", on);
    }
    setHidden($("engine-fields"), !id);
    if (!id) return;
    setHidden($("baseUrl-field"), id === "openai");
    setHidden($("apiKey-field"), id === "omnivoice");
    for (const hint of doc.querySelectorAll(".hint[data-preset]")) setHidden(hint, hint.dataset.preset !== id);
    $("baseUrl-label").textContent = id === "omnivoice" ? "Server address" : "Base URL";
    $("baseUrl").setAttribute("aria-describedby", id === "omnivoice" ? "omnivoice-hint" : "baseUrl-hint");
    if (id === "other") $("baseUrl").setAttribute("placeholder", "https://tts.example.com/v1");
    else $("baseUrl").removeAttribute("placeholder");
    const keyLabel = $("apiKey-label");
    keyLabel.textContent = id === "openai" ? "OpenAI API key" : "API key ";
    if (id === "other") {
      const optional = doc.createElement("span");
      optional.className = "optional";
      optional.textContent = "(optional)";
      keyLabel.appendChild(optional);
    }
    if (id === "openai") $("apiKey").setAttribute("aria-describedby", "apiKey-hint");
    else $("apiKey").removeAttribute("aria-describedby");
    $("quick-start").setAttribute("href", PRESETS.omnivoice.quickStartUrl);

    const d = drafts[id];
    $("baseUrl").value = d.baseUrl;
    $("apiKey").value = d.apiKey;
    renderModel(id, d.model);
    renderVoice(knownVoices(id, $("model").value), d.voice);
  }

  function readForm() {
    return {
      preset,
      baseUrl: preset === "openai" ? PRESETS.openai.baseUrl : $("baseUrl").value,
      apiKey: $("apiKey").value,
      model: $("model").value,
      voice: $("voice").value,
      speed: $("speed").value,
      autoscroll: $("autoscroll").checked,
    };
  }

  // Tests the engine of `settings.preset`; `saved` says whether the settings were just saved.
  async function runTest(settings, { saved }) {
    const id = settings.preset;
    const label = PRESETS[id].label;
    setText(status, "Checking connection…");
    let result;
    let voices;
    if (id === "openai") {
      result = await checkModels(settings);
      voices = voicesFor("openai", settings.model);
    } else {
      result = await listVoices(settings);
      voices = result?.ok ? result.voices : null;
    }
    // The user picked another card meanwhile: this result is no longer on screen.
    if (preset !== id) return;
    if (id !== "openai") {
      listed[id] = voices;
      renderVoice(voices, settings.voice);
    }
    if (result?.ok) {
      const found = voices?.length
        ? `✓ Connected to ${label} · ${voices.length} voices.`
        : `✓ Connected to ${label}. The server lists no voices: type one.`;
      setText(status, `${found} ${START_HINT}`, "ok");
      return;
    }
    const error = result?.error ?? "unknown error";
    setText(status, saved ? `Saved, but the test failed: ${error}` : `Connection failed: ${error}`, "error");
    if (id === "omnivoice") {
      // Most likely the server is not running: point at how to start it.
      status.appendChild(doc.createTextNode(" Is it running? See the "));
      const link = doc.createElement("a");
      link.setAttribute("href", PRESETS.omnivoice.quickStartUrl);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener");
      link.textContent = "Quick start";
      status.appendChild(link);
      status.appendChild(doc.createTextNode("."));
    }
  }

  async function save() {
    setText(message, "");
    if (!preset) {
      setText(message, "Choose a speech engine first.", "error");
      return;
    }
    const values = readForm();
    let origin;
    try {
      origin = permissionOrigin(values.baseUrl);
    } catch (err) {
      setText(message, `Not saved: ${err?.message || "invalid base URL"}`, "error");
      setText(status, "");
      return;
    }
    // Requested before any other await, while the click still counts as a user gesture.
    if (origin) {
      const granted = await Promise.resolve(chrome.permissions.request({ origins: [`${origin}/*`] })).catch(() => false);
      if (!granted) {
        setText(message, `Lektor needs permission to reach ${origin}`, "error");
        setText(status, "");
        return;
      }
    }
    const written = await saveSettings(chrome.storage.sync, values);
    $("speed").value = String(written.speed);
    stash();
    await runTest({ ...values, ...written }, { saved: true });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    page.saving = save();
  });

  form.addEventListener("change", (e) => {
    const target = e.target;
    if (target?.name === "preset") {
      stash();
      setText(status, "");
      setText(message, "");
      show(target.value);
    } else if (target?.id === "model" && preset === "openai") {
      // The OpenAI voice list follows the model.
      renderVoice(voicesFor("openai", target.value), $("voice").value);
    }
  });

  page.ready = (async () => {
    const settings = await loadSettings(chrome?.storage?.sync);
    $("speed").value = String(settings.speed);
    $("autoscroll").checked = settings.autoscroll !== false;
    if (!isConfigured(settings)) {
      renderModel("", settings.model);
      show("");
      return;
    }
    const { baseUrl, apiKey, model, voice } = settings;
    drafts[settings.preset] = { baseUrl, apiKey, model, voice };
    show(settings.preset);
    // OpenAI's voices are fixed; a self-hosted engine is asked for its list.
    if (settings.preset !== "openai") await runTest(settings, { saved: false });
  })();
  return page;
}

// Run only inside the extension's own page, not when imported by tests.
if (globalThis.document && globalThis.chrome?.runtime?.id) initOptions();
