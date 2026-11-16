# Visual verification — mobile player bar (Task 9)

Reference: [mockup option A](/project/omnivoice-server/mockups?file=omnivoice-server%2Fmockups%2F2026-11-16-lektor-mobile-bar-options.html), three states (playing, text selected, ⋯ open). Rendered with Playwright Chromium at 1300px wide and cropped to option A: `mockup-option-a.png`.

Captures: `pnpm screenshots` (fake engine, test article), states playing / selection / settings at 390×844 and 1280×800. Captured after commit `d8268ef` (fix: player bar matches the mockup).

Agreed deviations: none.

## First pass (before fixes)

| Check item | 390px | 1280px |
|---|---|---|
| One row prev · play/pause · next · speed chip · spacer · ⋯ · close, no wrap | match | match |
| Controls ≥ 44×44px, play/pause accent fill | match | match |
| Speed chip shows the current value; a tap cycles 0.8 → 1.0 → 1.2 → 1.5 → 2.0 → 0.8 (test "speed chip moves from an off-preset value to the next preset") | match | match |
| Selection strip: two equal-width "▶ From here" / "▶ Selection" above the row, row not moved | mismatch (no divider line between strip and row) | mismatch (same) |
| ⋯ fold-out: Voice, Speed slider + value, Autoscroll; ⋯ turns into collapse | mismatch (collapse control transparent, mockup filled; Autoscroll toggle without the "On" label) | mismatch (same) |
| Floats above the bottom, rounded, `#1f2328`, 10px side margins ("above the browser's bottom toolbar" is not visible in a headless capture; confirmed on the device in Task 11) | match | match (centred, capped) |
| 1280px: same layout, not full width | — | match (560px max) |

## Fixes

- `.more[aria-expanded="true"]` gets the filled button background and border (`#2d333b` / `#444c56`).
- The Autoscroll toggle shows "On" / "Off" next to its icon and follows `setAutoscroll`.
- `.selection-actions` gets `padding-bottom: 8px; border-bottom: 1px solid #30363d`, as the mockup's strip.

Tests: "open fold-out turns more into a filled collapse button", "autoscroll toggle shows On or Off next to its icon", "selection strip is divided from the row by a line".

## Final pass (after fixes)

| Check item | 390px | 1280px |
|---|---|---|
| One row prev · play/pause · next · speed chip · spacer · ⋯ · close, no wrap | match | match |
| Controls ≥ 44×44px, play/pause accent fill | match | match |
| Speed chip shows the current value; a tap cycles 0.8 → 1.0 → 1.2 → 1.5 → 2.0 → 0.8 (test "speed chip moves from an off-preset value to the next preset") | match | match |
| Selection strip: two equal-width "▶ From here" / "▶ Selection" above the row, row not moved | match | match |
| ⋯ fold-out: Voice, Speed slider + value, Autoscroll; ⋯ turns into collapse | match | match |
| Floats above the bottom, rounded, `#1f2328`, 10px side margins ("above the browser's bottom toolbar" is not visible in a headless capture; confirmed on the device in Task 11) | match | match |
| 1280px: same layout, not full width | — | match |

The strip disappearing when the selection collapses is not a static state; it is covered by the tests "strip hides when the selection collapses" and "selection strip has two equal-width play buttons above the row".

Not counted as mismatches: the article, voice name and highlight colours (test page vs. the mockup's sketch), the browser toolbar drawn under the mockup's phone, the Voice select at 44px high instead of the mockup's 40px (the 44px touch-target rule wins), the Voice select's native arrow instead of the mockup's drawn ▾, and the slightly larger fold-out spacing at 1280px.

## Files

| File | Viewport | Size |
|---|---|---|
| `bar-playing-390.png` | 390×844 | 77,664 B |
| `bar-selection-390.png` | 390×844 | 79,849 B |
| `bar-settings-390.png` | 390×844 | 71,728 B |
| `bar-playing-1280.png` | 1280×800 | 108,265 B |
| `bar-selection-1280.png` | 1280×800 | 107,032 B |
| `bar-settings-1280.png` | 1280×800 | 92,743 B |
| `mockup-option-a.png` | mockup at 1300px, 2× scale, cropped (1920×1160) | 215,860 B |
