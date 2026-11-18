# Device verification — Lektor TTS 1.1.0

Tester: Greg. Devices: Galaxy S23 Ultra, Vivaldi for Android (sideloaded zip); Windows desktop, Microsoft Edge (unpacked).

## Spikes (Task 1, 2026-11-16)

| Spike | Result |
|---|---|
| 0.0.1: visible extension iframe in the tab, screen locked | ✅ kept playing (6 sentences heard locked) |
| 0.0.2: autostart from the toolbar click, no tap in the frame | ✅ played at once, continued locked |
| 0.0.3: hidden 1×1 frame + Media Session notification | ✅ played locked; notification pause/next work |

## 1.1.0 (2026-11-17)

| # | Case (store/listing.md § Edge Android) | Vivaldi Android | Notes |
|---|---|---|---|
| 1 | Install, setup screen opens | ✅ | |
| 2 | Set up an engine (omnivoice-server over the tailnet, `:8444/v1`) | ✅ | |
| 3 | Read an article; one-row bar, highlight, controls, ⋯, × | ✅ | "works very well" |
| 4 | Selection actions | ✅ | |
| 5 | Screen-locked playback | ✅ | |
| 6 | Lock-screen media controls; media keys | ✅ | media keys work on the phone |
| — | gry-online.pl article: reader vanished after 2–3 sentences | ❌ → fixed in 7e7cb70 | site calls `history.replaceState` (same URL) on scroll; worker sent `stop` on every `loading`. Reproduced and verified fixed in Playwright (23 sentences, bar stays) |
| — | Autoscroll: read sentence hidden behind the bar | ❌ → fixed in 257c2a7, a214881 | Playwright 390×844: 0/24 sentences under the bar (fold-out open or closed); parent commit 11/24 |

## Desktop (Edge, unpacked 1.1.0)

| Check | Result | Notes |
|---|---|---|
| Reading, bar, highlight | ✅ | |
| Alt+click a paragraph | ✅ | not discoverable → Task 13 (one-time tip + tooltip) |
| `Alt+Shift+R` | ⚠️ not a code defect | edge://extensions/shortcuts shows "Not set" for both 1.0.0 and 1.1.0: the browser did not assign the suggested key (conflict / two copies installed). User assigns it by hand. Decision 2026-11-17: no product change |

Edge for Android itself is not yet tested (allowlist request pending, Task 12).
