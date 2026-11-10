// User settings kept in chrome.storage.sync.
import { PRESET_IDS, presetForBaseUrl } from "./presets.mjs";

export const DEFAULTS = Object.freeze({
  baseUrl: "http://localhost:8892/v1",
  apiKey: "",
  voice: "",
  speed: 1.0,
  model: "tts-1",
  autoscroll: true,
  // Engine preset id; "" = unconfigured (no engine set up yet).
  preset: "",
});

// Engine keys whose saved values, when they differ from these old defaults, mark a setup made
// before presets existed.
const ENGINE_KEYS = ["baseUrl", "apiKey", "voice", "model"];

export function isConfigured(settings) {
  return PRESET_IDS.includes(settings?.preset);
}

// Keys that cannot be blank: an empty (or whitespace-only) value means the default.
const NON_EMPTY = new Set(["baseUrl", "model"]);

function orDefault(key, value) {
  return NON_EMPTY.has(key) && String(value ?? "").trim() === "" ? DEFAULTS[key] : value;
}

// Boolean keys: only an explicit off value (false, "false") turns them off.
const BOOLEAN = new Set(["autoscroll"]);

function toBoolean(value) {
  return value !== false && String(value).trim().toLowerCase() !== "false";
}

export const MIN_SPEED = 0.5;
export const MAX_SPEED = 2.0;

// storage: chrome.storage.sync (or any object with `get(defaults)`); missing storage → DEFAULTS.
export async function loadSettings(storage) {
  if (!storage?.get) return { ...DEFAULTS };
  const got = await storage.get({ ...DEFAULTS });
  const merged = { ...DEFAULTS, ...(got || {}) };
  for (const key of NON_EMPTY) merged[key] = orDefault(key, merged[key]);
  for (const key of BOOLEAN) merged[key] = toBoolean(merged[key]);
  // Migration: a pre-preset setup gets its preset inferred from the base URL and written back.
  if (!merged.preset && ENGINE_KEYS.some((key) => merged[key] !== DEFAULTS[key])) {
    merged.preset = presetForBaseUrl(merged.baseUrl);
    try {
      await storage.set?.({ preset: merged.preset });
    } catch {
      // Not persisted: inferred again on the next load.
    }
  }
  return merged;
}

export function clampSpeed(value) {
  const n = Number(value);
  if (value === "" || value == null || !Number.isFinite(n)) return DEFAULTS.speed;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(n * 10) / 10));
}

// Writes only the known keys named in `patch`; speed is clamped to 0.5–2.0, and a blank
// baseUrl or model is stored as its default, and autoscroll as a boolean.
// Returns what was written.
export async function saveSettings(storage, patch = {}) {
  const clean = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in patch)) continue;
    if (key === "speed") clean[key] = clampSpeed(patch.speed);
    else if (BOOLEAN.has(key)) clean[key] = toBoolean(patch[key]);
    else clean[key] = orDefault(key, String(patch[key] ?? "").trim());
  }
  await storage.set(clean);
  return clean;
}
