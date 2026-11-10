# Lektor TTS

## What it is

A Chrome / Edge (Manifest V3) extension that reads the open page aloud through a text-to-speech
engine: OpenAI, your own [omnivoice-server](https://github.com/gmotyl/omnivoice-server), or any
other server that speaks the OpenAI `POST /audio/speech` API. It reads in place: the page is
never rewritten, the sentence being spoken is highlighted and scrolled into view, and a small
player bar sits on top of the page.

- **Article**: finds the main article (Readability, falling back to `<body>`) and reads it from
  the top.
- **Selection**: reads exactly the selected text; the player stops at the end, the bar stays
  until **Close**, and Alt+click starts reading again.
- **Read from here**: starts at the paragraph you right-clicked. On app pages without an article
  (Slack, Gmail) it reads only the pane you clicked in: the thread, the open conversation.
- **Alt+click**: jumps to any paragraph while reading (or starts again there after reading
  finished, until the bar is closed).
- **Navigation** by sentence, and by paragraph with Shift.
- **Highlight** of the current sentence (CSS Custom Highlight API, no DOM changes).
- **Voice** and **speed** (0.5–2.0) from the bar or the options page.

Polish and English text are segmented into sentences (abbreviations, decimal commas, quotes);
long sentences are cut into pieces of at most 400 characters, and the next sentences are
prefetched while the current one plays.

Lektor collects no data; see [PRIVACY.md](PRIVACY.md).

## Install

### From Edge Add-ons

Lektor TTS is submitted to Microsoft Edge Add-ons (link coming after review). Install it from
the store and the setup screen opens in a new tab.

### From source

Needs Chrome or Edge 116+ and Node 22+ with pnpm (`corepack pnpm` picks the pinned version).

```bash
git clone https://github.com/gmotyl/lektor-tts.git
cd lektor-tts
pnpm install
pnpm build           # bundles the content script into dist/content.js
```

Then in the browser:

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
2. Turn on **Developer mode**.
3. **Load unpacked** and pick the repository folder (not `dist/`).

After every rebuild, press the reload button on the extension's card; tabs that were already
reading need a page reload too.

Chrome / Edge 116 is the `minimum_chrome_version`: the offscreen document API needs 109+,
`chrome.runtime.getContexts` 116+, the CSS Custom Highlight API 105+.

## Setup

The setup screen opens on install; later, right-click the toolbar icon → **Options**. Pick one of
three speech engines, fill in its fields and press **Save and test**. Lektor asks the browser
for permission to reach the engine's origin when it is not localhost (if you deny it, nothing is
saved), saves, then tests the connection: "✓ Connected to … · N voices" means you can start
reading. Until an engine is saved, starting Lektor shows "Lektor needs a speech engine before it
can read." with a **Set up a speech engine** button instead of reading.

### OpenAI

Paid per use, billed by OpenAI (see [OpenAI pricing](https://openai.com/api/pricing/)).

1. Create an API key at [platform.openai.com → API keys](https://platform.openai.com/api-keys).
2. Pick the **OpenAI** card, paste the key, choose a voice.
3. **Save and test**, and allow access to `https://api.openai.com` when the browser asks.

The model is `gpt-4o-mini-tts` by default (13 voices, including `ballad`, `verse`, `marin` and
`cedar`); `tts-1` and `tts-1-hd` (9 voices) are under **More settings**. The voice list follows
the model (per [OpenAI's TTS guide](https://platform.openai.com/docs/guides/text-to-speech),
checked 2026-11-10).

### omnivoice-server

Free, runs on your own computer (an NVIDIA GPU is needed for real-time speech).

1. Install and start the server with the omnivoice-server
   [Quick start](https://github.com/gmotyl/omnivoice-server#quick-start-read-web-pages-aloud)
   (`./omnivoicectl start`).
2. Pick the **omnivoice-server** card; the address is `http://localhost:8892/v1`.
3. **Save and test**; the voice list comes from the server.

`http://localhost` and `http://127.0.0.1` are allowed by the manifest, so there is no permission
prompt.

### Other server

Any OpenAI-compatible endpoint.

1. Pick **Other server**, enter its base URL (`/audio/speech`, `/audio/voices` and `/models` are
   appended) and an API key if it needs one.
2. **Save and test**. The voice is a list when the server answers `/audio/voices`, otherwise type
   its id.

### More settings

| Setting    | Default | Notes                                                              |
| ---------- | ------- | ------------------------------------------------------------------ |
| Model      | `gpt-4o-mini-tts` for OpenAI, `tts-1` otherwise | the `model` field of each speech request |
| Speed      | `1.0`   | 0.5 to 2.0, step 0.1                                               |
| Autoscroll | on      | scroll the page to the sentence being read; also toggled on the bar |

Settings, including the API key, are stored in `chrome.storage.sync`. The key is sent as
`Authorization: Bearer …` to the configured engine only.

## Using it

Start reading with any of:

- the **toolbar icon** — reads the selection if there is one, else the article;
- **`Alt+Shift+R`** — the same, or pause / resume when this tab is already reading;
- the **context menu**: **Read selection** (on selected text) or **Read from here** (on the page,
  a link or an image). Chrome reports no click coordinates for context menus, so "Read from here"
  starts at the clicked link or image, otherwise at the element under the pointer. When the
  article found on the page does not hold that point (app pages such as Slack or Gmail, where
  the "article" is the whole app), it reads only the pane around the point: the nearest
  scrolling box or landmark (`main`, `role="main"`, `region`, `dialog`, `complementary`, `feed`,
  `log`) with at least ~200 characters of text, so a Slack thread or the open Gmail conversation
  rather than the channel list.

The player bar:

| Control           | Action                                                        |
| ----------------- | ------------------------------------------------------------- |
| Play / Pause      | pause and resume                                              |
| Previous / Next   | previous / next sentence; with **Shift**: previous / next paragraph |
| Voice             | switch voice; the current sentence starts again in the new voice; remembered as the default |
| Speed slider      | 0.5×–2.0×, applies immediately                                |
| Autoscroll        | on / off: follow the read sentence by scrolling; off keeps the highlight but never scrolls. Saved as the default |
| Close             | stop and remove the bar and highlight                         |

A voice chosen on the bar is saved as the default (the next session and Options use it), and so is
the **Autoscroll** toggle (shared with the Options checkbox). Speed changed on the bar applies to the
current session only; its default lives in Options.
**Alt+click** a paragraph to jump there (also after the last sentence, until you close the bar).
Alt+click outside what is being read (another pane of an app page) starts reading that pane there;
so does Alt+click on a message while the whole app page is read, which narrows reading to that pane.
Only one tab reads at a time: starting in another tab stops the first one. Navigating or closing
the reading tab stops it.

To change the shortcut, open `chrome://extensions/shortcuts` (`edge://extensions/shortcuts`).

## Troubleshooting

- **"Lektor needs a speech engine before it can read."**: no engine is saved yet. Press **Set up
  a speech engine** and finish **Save and test**.
- **"Lektor needs permission to reach …"**: the browser's permission prompt was denied. Press
  **Save and test** again and allow it.
- **Connection error in the bar**: the engine is not reachable or refused the request (for
  OpenAI, often a wrong key: 401). The bar shows the message with **Retry** and **Open options**;
  check the settings with **Save and test**. For omnivoice-server run `./omnivoicectl status`
  (and `./omnivoicectl start`) in its repository, see its
  [Quick start](https://github.com/gmotyl/omnivoice-server#quick-start-read-web-pages-aloud).
- **Empty voice list**: the server has no `/audio/voices`; type the voice id.
- **"Nothing to read on this page"**: no article or text was found. Select the text and use
  **Read selection**, or press **Retry** once the page has finished rendering.
- **Nothing happens on click**: browsers block scripting on `chrome://` / `edge://` pages and the
  Chrome Web Store / Edge Add-ons pages; the extension cannot read there.
- **Resuming after a long pause**: Chrome closes the hidden audio (offscreen) document about 30 s
  after sound stops. The extension recreates it on resume or seek (and on a voice / speed change
  while loading or playing; while paused the change is kept for the next resume), so a pause
  longer than that resumes from the start of the current sentence rather than mid-sentence.
- **The page jumps while I scroll around**: turn **Autoscroll** off on the bar (dimmed = off). The
  current sentence stays highlighted; turning it back on scrolls to it right away.
- **Slack / Gmail reads the sidebar or channel list**: start with **Read from here** (or Alt+click
  while reading) on the message you want; the icon and the shortcut read the whole "article",
  which on app pages is the whole app.
- **Old behaviour after a rebuild**: reload the extension on `chrome://extensions` /
  `edge://extensions`, then reload the page.
- **Shortcut does nothing**: another extension may own `Alt+Shift+R`; check
  `chrome://extensions/shortcuts`.

Bugs and questions: [GitHub Issues](https://github.com/gmotyl/lektor-tts/issues).

## Development

```bash
pnpm install
pnpm build           # must run before pnpm test: the manifest test checks dist/content.js
pnpm test            # node --test over src/**/*.test.mjs and scripts/__tests__
pnpm icons           # re-render icons/*.png and store/logo-300.png from icons/icon.svg
pnpm screenshots     # store screenshots + qa/visual captures (headless Chromium, fake engine)
pnpm package         # lektor-tts-<version>.zip for the store
```

`pnpm test` does not build by itself, so run `pnpm build` first (and again after changing
`src/content/`). `pnpm screenshots` and `pnpm package` build on their own.

`pnpm screenshots` needs Playwright's Chromium. On Ubuntu 20.04 Playwright's browser install
does not support the host, so install it with:

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu22.04-x64 corepack pnpm exec playwright install chromium
```

Plain ES modules, no framework. `chrome.*`, `fetch`, `Audio` and `CSS.highlights` are injected or
read from `globalThis`, so tests fake them; DOM tests use `linkedom`. Tests live in `__tests__/`
next to the code. `build.mjs` (esbuild) bundles only the content script; everything else is
loaded as-is.

File map:

| Path                         | Role                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `manifest.json`              | MV3 manifest: permissions, command, options page                     |
| `src/background.mjs`         | service worker: triggers, on-demand injection of `dist/content.js`, single-tab ownership, message routing, setup screen on install |
| `src/offscreen.html`, `src/offscreen.mjs` | offscreen document: owns the queue and the `<audio>` element |
| `src/offscreen/queue.mjs`    | prefetching sentence queue (3 ahead), abortable                      |
| `src/offscreen/player.mjs`   | plays each sentence's pieces in order, emits progress                |
| `src/engine.mjs`             | OpenAI-compatible client: `speak`, `listVoices`                      |
| `src/presets.mjs`            | engine presets (OpenAI, omnivoice-server, other) and OpenAI voices per model |
| `src/settings.mjs`           | defaults, load / save, preset migration, speed clamp                 |
| `src/options.html`, `src/options.mjs` | options page / setup screen, Save and test                  |
| `src/content/main.mjs`       | content script entry: picks the source, drives the session, Alt+click |
| `src/content/source.mjs`     | article (Readability), body fallback, pane around a point, selection |
| `src/content/segment.mjs`    | paragraphs → sentences → ≤400-char pieces                            |
| `src/content/nav.mjs`        | sentence / paragraph navigation                                      |
| `src/content/highlight.mjs`  | CSS Custom Highlight of the current sentence, scroll into view       |
| `src/content/bar.mjs`        | player bar (shadow DOM), including the setup prompt                  |
| `icons/icon.svg`             | icon source; `scripts/render-icons.mjs` renders the PNGs             |
| `scripts/package.mjs`        | store zip (runtime files only, version check)                        |
| `scripts/screenshots.mjs`, `scripts/fake-engine.mjs` | screenshots against a silent fake `/audio/speech` engine |
| `store/`                     | listing text (`listing.md`), screenshots, store logo                 |

Messages (`chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`). Content scripts talk to the
service worker; the worker re-sends engine commands to the offscreen document stamped
`target: "offscreen"` (offscreen acts only on stamped copies, the worker ignores them):

| type                         | direction                 | payload                                                       |
| ---------------------------- | ------------------------- | ------------------------------------------------------------- |
| `play`                       | content → sw → offscreen  | `{sentences: string[][], start, voice, speed}`; the worker adds `tabId` and `settings: {baseUrl, apiKey, model}` |
| `seek`                       | content → sw → offscreen  | `{index}`                                                     |
| `pause` / `resume` / `stop`  | content or sw → offscreen | —                                                             |
| `set-speed`                  | content → sw → offscreen  | `{speed}`                                                     |
| `set-voice`                  | content → sw → offscreen  | `{voice}`                                                     |
| `sentence-start`             | offscreen → sw → content  | `{index}`                                                     |
| `state`                      | offscreen → sw → content  | `{state: "loading"\|"playing"\|"paused"\|"idle"\|"error", error?}` |
| `stop`                       | sw → content              | — (to the previous owner tab when another tab starts; content tears down without echoing) |
| `toggle`                     | sw → content              | — (shortcut on the reading tab)                               |
| `start`                      | sw → content              | `{source: "auto"\|"selection"\|"from-here", linkUrl?, srcUrl?}` |
| `setup-prompt`               | sw → content              | — (no engine set up: show the setup prompt instead of reading) |
| `list-voices`                | content → sw              | — ; answered via `sendResponse` with `{ok, voices: string[] \| null}` (`null`: reachable, no list) or `{ok: false, error}` |
| `open-options`               | content → sw              | — (content scripts cannot open the options page)              |

Specs live in `openspec/specs/`; open changes in `openspec/changes/`.

## Releasing

1. Bump `version` in both `manifest.json` and `package.json` (they must match, or
   `pnpm package` refuses).
2. `pnpm build && pnpm test` (the tests need `dist/content.js`).
3. `pnpm package` → `lektor-tts-<version>.zip`.
4. `pnpm screenshots` if the UI changed, and commit the new `store/*.png`.
5. In Partner Center, upload the zip and paste the texts from
   [`store/listing.md`](store/listing.md) (descriptions, permission justifications, notes for
   certification; the OpenAI test key goes only into the submission notes, never into the repo).
6. Tag the release: `git tag v<version> && git push origin v<version>`.

Created by Greg Motyl — [github.com/gmotyl](https://github.com/gmotyl)

[![BuyMeACoffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/motyl.dev)
