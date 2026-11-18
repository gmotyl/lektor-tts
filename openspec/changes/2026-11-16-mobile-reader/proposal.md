---
title: Lektor TTS on mobile browsers
summary: Make Lektor usable on Android browsers: keep reading with the screen locked, add touch replacements for the context menu and Alt+click, and fit the player bar into one row on a phone. Ship it as 1.1.0 to both stores and request Edge Android availability.
---

# Change: mobile-reader

## Why

Lektor TTS 1.0.0 is on Edge Add-ons (desktop) and submitted to the Chrome Web Store. Greg wants it
on his phone, preferably in Edge. A device check of 1.0.0 in Vivaldi Android (S23 Ultra, 2026-11-16)
showed that installing, setup, the player bar, audio, the highlight and tab switching already work.
Three gaps make it a poor phone reader:

- **Audio stops when the screen locks or another app comes to the front.** On a phone, a reader is
  mostly listened to with the screen off. The offscreen document is not a tab, so Android freezes it.
- **There is no way to start "from here" by touch.** Mobile browsers show no extension context menu,
  there is no keyboard for `Alt+Shift+R`, and Alt+click cannot be done on a touchscreen.
- **The player bar wraps to two rows** on a 390px-wide screen.

Distribution: Chrome Web Store extensions install directly in Vivaldi Android (8.2+), and Brave is
working on the same. Edge Android shows only an allowlist of extensions, which needs a request with a
mobile value statement and test cases (MicrosoftEdge-Extensions#529).

## What changes

- Audio moves from the offscreen document to a **player frame**: an extension-origin iframe injected
  into the reading tab, on every platform. It shows **Media Session controls** (lock screen,
  notification, headset, media keys). The `offscreen` permission and the idle-document replay logic
  go away.
- The player bar shows **selection actions** ("▶ From here", "▶ Selection") while text is selected
  during a session.
- The player bar is compact (mockup option A): one transport row, a speed chip that cycles presets,
  and a ⋯ fold-out for voice, speed slider and autoscroll.
- Release 1.1.0 to Edge Add-ons and the Chrome Web Store. `store/listing.md` gains an Edge Android
  section (mobile value statement and test cases) for the allowlist request, which Greg submits.

## Out of scope

- Firefox for Android and iOS (Safari).
- Changing the engine protocol, the setup screen or the presets.
- Reading in a background tab without a session, or a queue across pages.

## Impact

- Capabilities: `reader-extension` (audio pipeline, start triggers, player bar, session lifecycle),
  `extension-release` (listing kit, screenshots).
- Code: `src/background.mjs`, `src/offscreen*` → `src/player*`, `src/content/main.mjs`,
  `src/content/bar.mjs`, `manifest.json`, `scripts/` (screenshots), `store/listing.md`, README.
