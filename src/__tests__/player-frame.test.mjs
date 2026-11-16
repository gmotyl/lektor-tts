import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlayerFrame } from "../player.mjs";

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

class FakeAudio extends EventTarget {
  src = "";
  paused = true;
  playResult = () => Promise.resolve();
  play() {
    this.paused = false;
    return this.playResult();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {
    this.src = "";
  }
  load() {}
}

class FakeMediaMetadata {
  constructor(init) {
    Object.assign(this, init);
  }
}

function setup({ stored = {}, speak } = {}) {
  const listeners = [];
  const sent = [];
  const port = {
    onMessage: { addListener: (fn) => listeners.push(fn) },
    postMessage: (msg) => sent.push(msg),
  };
  const storage = { sync: { get: async (defaults) => ({ ...defaults, ...stored }), set: async () => {} } };
  const handlers = {};
  const mediaSession = {
    metadata: null,
    playbackState: "none",
    setActionHandler: (action, fn) => (handlers[action] = fn),
  };
  const spoken = [];
  const audio = new FakeAudio();
  createPlayerFrame({
    port,
    audio,
    storage,
    mediaSession,
    MediaMetadata: FakeMediaMetadata,
    speak:
      speak ??
      (async (settings, { text, voice }) => {
        spoken.push({ settings, text, voice });
        return new ArrayBuffer(1);
      }),
  });
  const deliver = (msg) => listeners.forEach((fn) => fn(msg));
  return { deliver, sent, spoken, audio, mediaSession, handlers };
}

const sentences = [["One."], ["Two."], ["Three."], ["Four."], ["Five."]];
const play = (extra = {}) => ({ type: "play", sentences, start: 0, voice: "v1", speed: 1, ...extra });
const starts = (sent) => sent.filter((m) => m.type === "sentence-start").map((m) => m.index);

test("play reads engine settings from storage and plays the start sentence", async () => {
  const stored = { baseUrl: "http://localhost:9000/v1", apiKey: "k", model: "m1" };
  const { deliver, spoken, audio } = setup({ stored });
  deliver(play({ start: 2 }));
  await settle();
  assert.deepEqual(spoken[0], { settings: stored, text: "Three.", voice: "v1" });
  assert.equal(audio.paused, false);
});

test("emits sentence-start for each sentence", async () => {
  const { deliver, sent, audio } = setup();
  deliver(play({ sentences: [["A."], ["B."]] }));
  await settle();
  audio.dispatchEvent(new Event("ended"));
  await settle();
  assert.deepEqual(starts(sent), [0, 1]);
  audio.dispatchEvent(new Event("ended"));
  await settle();
  assert.deepEqual(sent.at(-1), { type: "state", state: "ended" });
});

test("ignores window messages", async () => {
  // Stand in a window event target, so a `message` listener would be reachable.
  const win = new EventTarget();
  const added = [];
  globalThis.addEventListener = (type, fn, opts) => {
    added.push(type);
    win.addEventListener(type, fn, opts);
  };
  try {
    // Fresh import with the spy in place, so a module-level listener is caught too.
    await import(`../player.mjs?fresh=${Date.now()}-window`);
    const { spoken } = setup();
    // A page can post to the frame's window; only the port is a command channel.
    win.dispatchEvent(Object.assign(new Event("message"), { data: play() }));
    await settle();
    assert.equal(spoken.length, 0);
    assert.ok(!added.includes("message"));
  } finally {
    delete globalThis.addEventListener;
  }
});

test("sets media session metadata from title and voice", async () => {
  const { deliver, mediaSession } = setup();
  deliver(play({ start: 3, title: "Spider's Web", voice: "krystyna1" }));
  await settle();
  assert.ok(mediaSession.metadata instanceof FakeMediaMetadata);
  assert.deepEqual({ ...mediaSession.metadata }, { title: "Spider's Web", artist: "Lektor TTS", album: "krystyna1" });
});

test("next and previous track handlers seek", async () => {
  const { deliver, sent, handlers } = setup();
  deliver(play({ start: 2 }));
  await settle();
  handlers.nexttrack();
  await settle();
  handlers.previoustrack();
  await settle();
  handlers.previoustrack();
  await settle();
  assert.deepEqual(starts(sent), [2, 3, 2, 1]);
});

test("play and pause handlers toggle audio and report state", async () => {
  const { deliver, sent, audio, mediaSession, handlers } = setup();
  deliver(play());
  await settle();
  assert.equal(mediaSession.playbackState, "playing");
  handlers.pause();
  assert.equal(audio.paused, true);
  assert.deepEqual(sent.at(-1), { type: "state", state: "paused" });
  assert.equal(mediaSession.playbackState, "paused");
  handlers.play();
  await settle();
  assert.equal(audio.paused, false);
  assert.deepEqual(sent.at(-1), { type: "state", state: "playing" });
  assert.equal(mediaSession.playbackState, "playing");
  deliver({ type: "stop" });
  await settle();
  assert.equal(mediaSession.playbackState, "none");
});

test("pause right after play is applied after play", async () => {
  const { deliver, sent, audio } = setup();
  deliver(play());
  deliver({ type: "pause" });
  await settle();
  assert.equal(audio.paused, true);
  assert.deepEqual(sent.filter((m) => m.type === "state").at(-1), { type: "state", state: "paused" });
});

test("real frame connects a player port to its own tab", async () => {
  const connects = [];
  const port = { onMessage: { addListener: () => {} }, postMessage: () => {} };
  globalThis.chrome = {
    tabs: {
      getCurrent: async () => ({ id: 7 }),
      connect: (...args) => {
        connects.push(args);
        return port;
      },
    },
    storage: { sync: { get: async (defaults) => ({ ...defaults }), set: async () => {} } },
  };
  globalThis.Audio = FakeAudio;
  try {
    await import(`../player.mjs?fresh=${Date.now()}-real`);
    await settle();
    assert.deepEqual(connects, [[7, { name: "player" }]]);
  } finally {
    delete globalThis.chrome;
    delete globalThis.Audio;
  }
});

test("autoplay rejection reports paused", async () => {
  const { deliver, sent, audio } = setup();
  audio.playResult = () => Promise.reject(Object.assign(new Error("no gesture"), { name: "NotAllowedError" }));
  deliver(play());
  await settle();
  assert.deepEqual(sent.at(-1), { type: "state", state: "paused" });
  assert.ok(!sent.some((m) => m.type === "error"));
  audio.playResult = () => Promise.resolve();
  deliver({ type: "resume" });
  await settle();
  assert.equal(audio.paused, false);
  assert.deepEqual(sent.at(-1), { type: "state", state: "playing" });
});

test("engine error is reported over the port", async () => {
  const { deliver, sent } = setup({
    speak: async () => {
      throw new Error("HTTP 500");
    },
  });
  deliver(play());
  await settle();
  assert.deepEqual(sent.at(-1), { type: "error", message: "HTTP 500" });
});
