// Fake engine: a local OpenAI-compatible text-to-speech server that answers with silent MP3,
// for screenshots and visual checks without a GPU or an API key.
//
//   GET  /v1/models        → {data: [{id: "tts-1"}]}
//   GET  /v1/audio/voices  → {voices: ["demo-1", "demo-2"]}
//   POST /v1/audio/speech  → silent audio/mpeg (`speechSeconds` long)
//
// Every answer carries permissive CORS headers. `pages` maps extra paths to HTML served as-is
// (the screenshot script serves its sample article from here).
//
// CLI: node scripts/fake-engine.mjs [port]
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

export const VOICES = ["demo-1", "demo-2"];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "600",
};

// One MPEG-1 Layer III frame: 128 kbit/s, 44.1 kHz, mono, no CRC. An all-zero body means zero
// side info and no main data, which decoders play as 1152 samples of silence.
const FRAME_BYTES = 417; // floor(144 * 128000 / 44100)
const FRAME_SECONDS = 1152 / 44100;

export function silentMp3(seconds) {
  const frames = Math.max(1, Math.ceil(seconds / FRAME_SECONDS));
  const buf = Buffer.alloc(frames * FRAME_BYTES);
  for (let i = 0; i < frames; i++) buf.set([0xff, 0xfb, 0x90, 0xc4], i * FRAME_BYTES);
  return buf;
}

function send(res, status, type, body) {
  res.writeHead(status, { ...CORS, "content-type": type, "content-length": Buffer.byteLength(body) });
  res.end(body);
}

const json = (res, status, value) => send(res, status, "application/json", JSON.stringify(value));

// Starts the server on 127.0.0.1 (`port: 0` = a free port). Resolves to {url, close}.
export function start({ port = 0, speechSeconds = 1, pages = {} } = {}) {
  const audio = silentMp3(speechSeconds);
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname.replace(/\/+$/, "") || "/";
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (req.method === "GET" && Object.hasOwn(pages, path)) return send(res, 200, "text/html; charset=utf-8", pages[path]);
    if (req.method === "GET" && path === "/v1/models") return json(res, 200, { object: "list", data: [{ id: "tts-1", object: "model" }] });
    if (req.method === "GET" && path === "/v1/audio/voices") return json(res, 200, { voices: VOICES });
    if (req.method === "POST" && path === "/v1/audio/speech") {
      // Drain the request body before answering.
      req.resume();
      req.on("end", () => send(res, 200, "audio/mpeg", audio));
      return undefined;
    }
    return json(res, 404, { error: { message: `no route for ${req.method} ${path}` } });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const { port: bound } = server.address();
      resolve({
        url: `http://127.0.0.1:${bound}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const engine = await start({ port: Number(process.argv[2] ?? 8899) });
  console.log(`fake engine on ${engine.url}/v1`);
}
