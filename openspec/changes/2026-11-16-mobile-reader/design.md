# Design: mobile reader

## Glossary

- **Player frame** — an extension-origin iframe the content script injects into the reading tab; it owns the sentence queue and the `<audio>` element and plays on every platform. _Avoid_: offscreen document, offscreen player.
- **Media Session controls** — play/pause/next/previous exposed through the Media Session API, reachable from the lock screen, notification shade, headset and hardware media keys. _Avoid_: media notification, lock-screen buttons.
- **Selection actions** — the "▶ From here" and "▶ Selection" buttons the player bar shows while text is selected during a session, replacing the context menu and Alt+click on touch. _Avoid_: selection chip, floating button.

## Decisions

- Target: one mobile-ready Chromium build. Developed and tested on Vivaldi Android (sideload); users install it from the Chrome Web Store in Vivaldi (and Brave once it ships extensions); an Edge Android allowlist request runs in parallel.
- Audio moves from the offscreen document to the player frame on all platforms; the `offscreen` permission is dropped. Evidence: spike `spikes/lektor-lockscreen-audio` 0.0.1/0.0.2 on Vivaldi Android (S23 Ultra), 2026-11-16 — the iframe autostarts from the toolbar click with no tap inside it, and keeps fetching and playing sentences with the screen locked; the offscreen document stops when the screen locks.
- Touch start points: selection actions live in the player bar (bottom, thumb reach) rather than next to the selection, because Android's native selection menu already occupies that spot and extensions cannot add entries to it. Desktop keeps the context menu and Alt+click.

## Mockups

### [projects/omnivoice-server/mockups/2026-11-16-lektor-mobile-bar-options.html](/project/omnivoice-server/mockups?file=omnivoice-server%2Fmockups%2F2026-11-16-lektor-mobile-bar-options.html)
- Surface: player bar (content script shadow DOM), option A; viewport(s): 390px, 1280px
- Check:
  - Playing: one row in order prev · play/pause · next · speed chip · spacer · ⋯ · close; nothing wraps at 390px
  - Every control is at least 44×44px; play/pause uses the accent fill
  - Speed chip cycles 0.8 → 1.0 → 1.2 → 1.5 → 2.0 → 0.8 and always shows the current speed, including a slider value such as 1.3×
  - Text selected during a session: a strip with two equal-width buttons "▶ From here" and "▶ Selection" appears above the row; the transport row does not move horizontally; the strip disappears when the selection collapses
  - ⋯ open: a fold-out under the row with Voice select, Speed slider with value, and Autoscroll toggle; ⋯ becomes a collapse control
  - The bar floats above the browser's bottom toolbar, rounded corners, `#1f2328` background, 10px side margins
  - Desktop (1280px) uses the same layout and does not stretch to full width
- Agreed deviations:
  - none

Visual verification: yes
