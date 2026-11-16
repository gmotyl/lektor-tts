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
- Keeps playing when the screen is locked, with play / pause and previous / next sentence from
  the lock screen, the media notification, a headset or media keys.
- On touch screens: a one-row player bar, and "From here" / "Selection" buttons that appear on
  the bar when you select text while reading.
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
- `web_accessible_resources` (player frame): `src/player.html` and the modules it loads
  (`src/player.mjs`, `src/player/player.mjs`, `src/player/queue.mjs`, `src/engine.mjs`,
  `src/settings.mjs`, `src/presets.mjs`) are exposed so the player bar can embed the extension's
  own player page as an iframe in the tab being read. That page holds the `<audio>` element and
  the media session, so speech keeps playing when the phone screen is locked and can be
  controlled from the lock screen or a headset. Only the player page and its modules (code) are
  exposed; they contain no data, and settings and keys stay in extension storage, which a web
  page cannot read.
- `contextMenus`: adds "Read selection" and "Read from here" to the page's right-click menu.
- `storage`: keeps the user's settings (engine preset, server address, API key, model, voice,
  speed, autoscroll) in `chrome.storage.sync`, and the id of the tab currently reading in
  `chrome.storage.session` (in memory only, cleared when the browser closes), so that "one tab
  reads at a time" survives a background worker restart.
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
   nothing selected to read the whole article. Use pause, previous / next and the speed chip on
   the bar; ⋯ folds out voice, the speed slider and autoscroll; × closes it.
6. Optional, unconfigured state: in a fresh profile, before saving any engine, clicking the
   toolbar icon shows "Lektor needs a speech engine before it can read." with a "Set up a speech
   engine" button that opens the setup screen.

The omnivoice-server and "Other server" engines need a server the reviewer does not have; the
OpenAI engine covers the whole reading flow.

## Edge Android

One-time allowlist request for Microsoft Edge on Android, following the Edge team's answer in
[MicrosoftEdge-Extensions#529](https://github.com/microsoft/MicrosoftEdge-Extensions/issues/529)
(2026-03-16). Requirements: the extension is on Edge Add-ons, has a clear value statement for
mobile users, its core functions are verified on Edge Android / iOS, and core-function test cases
are provided for the Edge Android QA team. Then submit the request form:
https://forms.office.com/pages/responsepage.aspx?id=v4j5cvGGr0GRqy180BHbR8G-LK4A-v5AgScqcFFv6_RUM0RMRDgzUENURDE0UzA2RlhIRUk0S0xIMy4u&route=shorturl

Device status: verified so far on Vivaldi for Android (Samsung Galaxy S23 Ultra); see
`openspec/changes/2026-11-16-mobile-reader/verification/device.md` once Task 11 is recorded.
Edge Android itself has not been tested yet; do not claim it in the form until the cases below
have been run there.

### Value statement for mobile users

Lektor TTS turns any article into something you can listen to on the go. Start it on a page,
lock the phone, put it in your pocket and keep listening: speech continues with the screen off,
and play / pause and previous / next sentence work from the lock screen, the media notification
and headset buttons. On the page, a compact one-row player bar fits a phone screen, the sentence
being read is highlighted, and selecting text while reading offers "From here" and "Selection"
buttons, so there is no need for a right-click menu or a keyboard shortcut. It works with OpenAI
text-to-speech or any OpenAI-compatible speech server, and collects no data.

### Test cases

Engine for the QA team: OpenAI, with a reviewer API key supplied in the request (never stored in
the repository), or any public OpenAI-compatible speech endpoint through "Other server".

1. **Install**
   - Steps: install Lektor TTS from Edge Add-ons on Edge for Android.
   - Expected: the setup screen ("Lektor TTS", "Speech engine") opens in a new tab.
2. **Set up an engine**
   - Steps: on the setup screen pick "OpenAI", paste the reviewer key, keep the default voice and
     tap "Save and test"; allow access to `api.openai.com` if the browser asks. (Alternative:
     "Other server" with the base URL of an OpenAI-compatible endpoint and its key.)
   - Expected: the page shows "✓ Connected to OpenAI · 13 voices" (or "✓ Connected to … · N
     voices" for another server).
3. **Read an article**
   - Steps: open an article (for example a Wikipedia article) and start Lektor from the
     extensions menu (Lektor TTS).
   - Expected: the one-row player bar appears at the bottom of the page, the article is read
     aloud from the top and the sentence being read is highlighted and kept in view. Pause /
     play, previous / next and the speed chip respond; ⋯ folds out voice, speed slider and
     autoscroll; × stops reading and removes the bar.
4. **Selection actions**
   - Steps: while reading, long-press a word in a later paragraph and extend the selection over a
     sentence or two. Tap "Selection". Then select text in another paragraph and tap "From here".
   - Expected: on selecting, "From here" and "Selection" buttons appear above the bar's row.
     "Selection" reads only the selected text and stops at its end; "From here" continues reading
     the article from the selected paragraph onward.
5. **Screen-locked playback**
   - Steps: start reading an article (case 3), then press the power button to lock the screen and
     wait at least one minute.
   - Expected: speech continues across sentences with the screen off; after unlocking, the
     highlight is on the sentence being read.
6. **Lock-screen media controls**
   - Steps: while reading with the screen locked, use the media notification on the lock screen
     (or a headset button): pause, play, next, previous.
   - Expected: the notification shows the page title; pause and play pause and resume speech,
     next / previous jump one sentence forward / back, and the page's bar reflects the same state
     after unlocking.

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
- Data usage: tick "Website content" (the text being read goes to the speech engine the user
  configured) and "Authentication information" (the user's API key, kept in
  `chrome.storage.sync` and sent only to that engine as the `Authorization` bearer token). Tick
  nothing else. Tick all three certifications: not sold to third parties, not used for purposes
  unrelated to the single purpose, not used for creditworthiness or lending.
- Privacy policy URL: the [Privacy policy URL](#privacy-policy-url).

### Test instructions

The dashboard's "Test instructions" field takes at most 500 characters, so paste this short
version (the full steps are in [Notes for certification](#notes-for-certification)). Put the
reviewers' OpenAI key in the credentials field if the form shows one, otherwise append it to the
text (about 300 characters, so a 164-character `sk-proj-` key still fits under 500):

```text
1. Setup screen opens on install: pick OpenAI, paste the key, Save and test, allow api.openai.com.
2. On a Wikipedia article select a paragraph, press Alt+Shift+R: the bar appears, text is read with the sentence highlighted.
3. Toolbar icon with nothing selected reads the article. × closes.
```

### Distribution tab

- Visibility: Public. Regions: all. Free.
