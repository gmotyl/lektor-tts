// Engine presets shown on the setup screen and read by settings migration and
// the background. OpenAI voice lists per model follow
// https://platform.openai.com/docs/guides/text-to-speech (checked 2026-11-10).

const TTS1_VOICES = ["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"];
const GPT4O_MINI_TTS_VOICES = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar",
];

export const PRESET_IDS = ["openai", "omnivoice", "other"];

export const PRESETS = {
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
    defaultModel: "gpt-4o-mini-tts",
    voicesByModel: {
      "gpt-4o-mini-tts": GPT4O_MINI_TTS_VOICES,
      "tts-1": TTS1_VOICES,
      "tts-1-hd": TTS1_VOICES,
    },
  },
  omnivoice: {
    id: "omnivoice",
    label: "omnivoice-server",
    baseUrl: "http://localhost:8892/v1",
    // The server accepts the existing default model name.
    models: ["tts-1"],
    defaultModel: "tts-1",
    quickStartUrl: "https://github.com/gmotyl/omnivoice-server#quick-start-read-web-pages-aloud",
  },
  other: {
    id: "other",
    label: "Other server",
    baseUrl: "",
    models: [],
    defaultModel: "",
  },
};

// The preset's fixed voice list for a model, or null when the engine is asked.
export function voicesFor(presetId, model) {
  const list = PRESETS[presetId]?.voicesByModel?.[model];
  return list ? [...list] : null;
}

// Which preset a stored base URL belongs to.
export function presetForBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(String(baseUrl ?? "").trim());
  } catch {
    return "other";
  }
  if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.port === "8892") return "omnivoice";
  if (url.hostname === "api.openai.com") return "openai";
  return "other";
}
