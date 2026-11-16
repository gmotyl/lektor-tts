# Store listing: Lektor TTS

Text to paste into Edge Partner Center and the Chrome Web Store Developer Dashboard for each
release. Most sections are shared; the Chrome-only fields are in
[Chrome Web Store](#chrome-web-store) at the end. Screenshots and images live next to this file
(`screenshot-reading.png`, `screenshot-setup.png`, `screenshot-unconfigured.png` at 1280x800,
`logo-300.png`, Chrome promo tiles `promo-small-440x280.png` and `promo-large-1400x560.png`). No API key is ever written here; the certification key is pasted in the
submission notes only.

## Name

Lektor TTS

## Short description

Reads the page's article or your selection aloud, highlighting each sentence. Works with OpenAI or your own text-to-speech server.

## Full description

Lektor TTS reads web pages aloud in place. It finds the main article (or reads exactly the text
you selected), highlights the sentence being spoken, scrolls it into view and shows a small
player bar on top of the page. The page itself is never rewritten.

Features:

- Read the article, the selection, or "Read from here" on the paragraph you right-click.
- On app pages such as Slack or Gmail, "Read from here" reads only the pane you clicked in.
- Alt+click any paragraph to jump there while reading.
- Previous / next sentence, and paragraph with Shift.
- Voice and speed (0.5x to 2.0x) on the player bar; optional autoscroll.
- Keyboard shortcut Alt+Shift+R to start, pause and resume.
- Polish and English sentence splitting; the next sentences are fetched ahead for smooth playback.

Choose a speech engine on the setup screen that opens after install:

1. OpenAI: paste an API key and pick a voice. Paid per use, billed by OpenAI
   (see https://openai.com/api/pricing/). Models gpt-4o-mini-tts (13 voices, default),
   tts-1 and tts-1-hd (9 voices).
2. omnivoice-server: free and runs on your own computer (an NVIDIA GPU is needed for real-time
   speech). Install and start it with the Quick start:
   https://github.com/gmotyl/omnivoice-server#quick-start-read-web-pages-aloud
3. Other server: any endpoint that speaks the OpenAI /audio/speech API, with an optional key.

Setting up OpenAI:

1. Create an API key at https://platform.openai.com/api-keys.
2. In Lektor's setup screen pick "OpenAI", paste the key and choose a voice.
3. Press "Save and test" and allow access to api.openai.com when the browser asks.
4. Select text on any page and press Alt+Shift+R.

Privacy: Lektor collects no data. Page text goes only to the speech engine you configured, and
your settings, including the API key, stay in your browser's sync storage. No analytics, no
remote code.

Lektor TTS is free and open source (MIT): https://github.com/gmotyl/lektor-tts

If Lektor saves your eyes, you can buy me a coffee: https://buymeacoffee.com/motyl.dev

## Category

Productivity (Accessibility was considered; Productivity fits the main use, reading articles
aloud, best).

## Support URL

https://github.com/gmotyl/lektor-tts/issues

## Privacy policy URL

https://github.com/gmotyl/lektor-tts/blob/main/PRIVACY.md

## Permission justifications

- `activeTab`: when the user clicks the toolbar icon, presses the shortcut or uses the context
  menu, Lektor gets temporary access to that tab only, to read its text and show the player bar.
- `scripting`: injects the content script (text extraction, sentence highlight, player bar) into
  the tab the user started reading in, on demand; nothing is injected into other pages.
- `offscreen`: an MV3 service worker cannot play audio, so an offscreen document holds the
  `<audio>` element that plays the speech.
- `contextMenus`: adds "Read selection" and "Read from here" to the page's right-click menu.
- `storage`: keeps the user's settings (engine preset, server address, API key, model, voice,
  speed, autoscroll) in `chrome.storage.sync`, and the current reading session (sentences being
  read and engine settings) in `chrome.storage.session`, in memory only and cleared when the
  browser closes, so playback survives a background worker restart.
- Host permissions `http://localhost/*` and `http://127.0.0.1/*`: reach a speech server running
  on the user's own computer (omnivoice-server listens on `http://localhost:8892/v1`) without a
  prompt.
- Optional host permissions `http://*/*` and `https://*/*`: never granted at install. When the
  user saves a speech server on another origin (OpenAI: `https://api.openai.com/*`, or their own
  server), Lektor asks for permission to that one origin only; if it is denied, nothing is saved.

## Notes for certification

Edge: "Notes for certification". Chrome: "Test instructions" (Privacy practices tab).

The OpenAI API key for testing is supplied in these submission notes by the publisher (pasted
in the store dashboard, never stored in the repository).

1. Install the extension. The setup screen ("Lektor TTS", "Speech engine") opens in a new tab.
2. Pick the "OpenAI" card, paste the API key from these notes, leave the voice as is.
3. Press "Save and test" and allow access to `api.openai.com` when the browser asks. The page
   shows "✓ Connected to OpenAI · 13 voices".
4. Open any article page (for example a Wikipedia article), select a paragraph and press
   Alt+Shift+R, or right-click it and choose "Read selection". The player bar appears and the
   text is read aloud with the current sentence highlighted.
5. Right-click another paragraph and choose "Read from here", or click the toolbar icon with
   nothing selected to read the whole article. Use pause, previous / next, voice and speed on the
   bar; × closes it.
6. Optional, unconfigured state: in a fresh profile, before saving any engine, clicking the
   toolbar icon shows "Lektor needs a speech engine before it can read." with a "Set up a speech
   engine" button that opens the setup screen.

The omnivoice-server and "Other server" engines need a server the reviewer does not have; the
OpenAI engine covers the whole reading flow.

## Chrome Web Store

Fields the Chrome Web Store Developer Dashboard asks for on top of the shared ones above.
Publisher: the developer account registered for motyl.dev; contact email greg@motyl.dev.

### Store listing tab

- Description: the [Full description](#full-description). The summary under the name comes from
  `manifest.json` `description` (max 132 characters).
- Category: Productivity → Tools. Language: English.
- Screenshots (1280x800): `screenshot-reading.png`, `screenshot-setup.png`,
  `screenshot-unconfigured.png`.
- Small promo tile (440x280): `promo-small-440x280.png`. Marquee (1400x560, optional):
  `promo-large-1400x560.png`.
- Homepage URL: https://github.com/gmotyl/lektor-tts. Support URL: the [Support URL](#support-url).

### Privacy practices tab

- Single purpose: Lektor TTS reads the text of the current web page (the article or the user's
  selection) aloud through a text-to-speech engine the user configures, highlighting each
  sentence as it is spoken.
- Permission justifications: one field per permission, texts from
  [Permission justifications](#permission-justifications). The "host permission" field gets both
  the `localhost` / `127.0.0.1` text and the optional `http://*/*` / `https://*/*` text.
- Remote code: No. All JavaScript ships in the package; the extension only sends text to and
  receives audio from the speech server.
- Data usage: tick only "Website content" (the text being read goes to the user's own speech
  engine). Tick all three certifications: not sold to third parties, not used for purposes
  unrelated to the single purpose, not used for creditworthiness or lending.
- Privacy policy URL: the [Privacy policy URL](#privacy-policy-url).

### Distribution tab

- Visibility: Public. Regions: all. Free.
