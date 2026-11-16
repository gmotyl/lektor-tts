// Player frame entry: an extension-origin iframe inside the content script's shadow host.
// It owns the sentence queue and the <audio> element, takes commands only over its Port to
// its own tab's content script (never window messages, which the page could forge), answers
// with `sentence-start` / `state` / `error`, and drives the Media Session (lock-screen controls).
import { speak as engineSpeak } from "./engine.mjs";
import { loadSettings } from "./settings.mjs";
import { createQueue } from "./player/queue.mjs";
import { createPlayer } from "./player/player.mjs";

const ENGINE_DEFAULTS = { baseUrl: "http://localhost:8892/v1", apiKey: "", model: "tts-1" };

// deps: {port: chrome.runtime.Port, audio: HTMLAudioElement, storage: chrome.storage (or its
// sync area), mediaSession: navigator.mediaSession, speak, MediaMetadata} — injectable for tests.
export function createPlayerFrame({
  port,
  audio,
  storage,
  mediaSession,
  speak = engineSpeak,
  MediaMetadata = globalThis.MediaMetadata,
}) {
  // Replaced on every `play`, so options changes apply to the next session.
  let settings = { ...ENGINE_DEFAULTS };
  let title = "";
  let voice = "";
  let index = 0;

  const post = (msg) => {
    try {
      port.postMessage(msg);
    } catch {
      // Port closed: the content script is gone, nobody to tell.
    }
  };

  function setMetadata() {
    if (!mediaSession) return;
    const meta = { title, artist: "Lektor TTS", album: voice };
    mediaSession.metadata = typeof MediaMetadata === "function" ? new MediaMetadata(meta) : meta;
  }

  // Translate the player's events to the Port protocol.
  function emit(msg) {
    if (msg.type === "sentence-start") {
      index = msg.index;
      setMetadata();
      return post(msg);
    }
    if (msg.type === "state" && msg.state === "error") return post({ type: "error", message: msg.error });
    if (msg.type === "state" && msg.state === "idle") return post({ type: "state", state: "ended" });
    post(msg);
  }

  const queue = createQueue({
    fetchAudio: (text, v, signal) => speak(settings, { text, voice: v }, signal),
  });
  const player = createPlayer({ queue, audio, emit });

  const handlers = {
    play: () => player.resume(),
    pause: () => player.pause(),
    nexttrack: () => player.seek(index + 1),
    previoustrack: () => player.seek(index - 1),
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try {
      mediaSession?.setActionHandler(action, fn);
    } catch {
      // Action not supported by this browser.
    }
  }

  async function handle(msg) {
    switch (msg.type) {
      case "play": {
        const { baseUrl, apiKey, model } = await loadSettings(storage?.sync ?? storage);
        settings = { ...ENGINE_DEFAULTS, baseUrl, apiKey, model };
        title = msg.title ?? "";
        voice = msg.voice ?? "";
        player.play({ sentences: msg.sentences, start: msg.start, voice, speed: msg.speed ?? 1 });
        break;
      }
      case "seek":
        player.seek(msg.index);
        break;
      case "pause":
        player.pause();
        break;
      case "resume":
        player.resume();
        break;
      case "stop":
        player.stop();
        break;
      case "set-speed":
        player.setSpeed(msg.speed);
        break;
      case "set-voice":
        voice = msg.voice;
        player.setVoice(msg.voice);
        break;
    }
  }

  // `play` awaits storage; chain commands so a `pause` sent right after it still lands after it.
  let chain = Promise.resolve();
  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg.type !== "string") return;
    chain = chain
      .then(() => handle(msg))
      .catch((err) => post({ type: "error", message: err?.message || String(err) }));
  });

  return { player };
}

// Real player frame only, not when imported by tests.
if (globalThis.chrome?.tabs?.getCurrent && typeof Audio !== "undefined") {
  globalThis.chrome.tabs.getCurrent().then((tab) => {
    const port = globalThis.chrome.tabs.connect(tab.id, { name: "player" });
    createPlayerFrame({
      port,
      audio: new Audio(),
      storage: globalThis.chrome.storage,
      mediaSession: navigator.mediaSession,
    });
  });
}
