# Lektor TTS on mobile browsers Implementation Plan

> **For agentic workers:** implement this plan with [[pavilio-execute-plan]] — task-by-task, top-down; check off each step (`- [ ]` → `- [x]`) as it lands. Do one task fully (test → implement → verify → commit) before starting the next.

**Goal:** Keep Lektor reading with the screen locked, add touch start points, fit the player bar into one row on a phone, and ship 1.1.0 with an Edge Android allowlist request.

**Architecture:** Audio moves from the offscreen document into a player frame: an extension-origin iframe in the content script's shadow host. The frame talks to its own tab's content script over a `chrome.tabs.connect` Port, and exposes Media Session controls. The service worker keeps only session ownership, menus and the command. The bar becomes one transport row with a speed chip, a ⋯ fold-out and a selection strip.

**Tech Stack:** MV3 extension, plain ES modules, esbuild (`build.mjs`), `node --test` (the design says vitest; the repo uses node's test runner), Chromium screenshots via `scripts/screenshots.mjs` + `scripts/fake-engine.mjs`.

**Design:** [design.md](design.md)

All commands run in the worktree root. `pnpm test` runs `node build.mjs` first.

**Contract — Port protocol** (name `"player"`, opened by the frame):
```js
// content script → frame
{ type: "play", sentences: string[][], start: number, voice: string, speed: number, title?: string }  // pieces per sentence
{ type: "seek", index: number } | { type: "pause" } | { type: "resume" } | { type: "stop" }
{ type: "set-speed", speed: number } | { type: "set-voice", voice: string }
// frame → content script
{ type: "sentence-start", index: number }
{ type: "state", state: "loading" | "playing" | "paused" | "ended" }
{ type: "error", message: string }
```

---

### Task 1: Device gate — hidden frame and lock-screen controls

**Files:**
- Modify: `/srv/git/prv/spikes/lektor-lockscreen-audio/background.js` (injected iframe style), `player.js` (Media Session metadata title = `document.title` of the parent, passed in the hash)

**Verification: non-testable** — sideload spike 0.0.3 in Vivaldi Android on the S23 Ultra — Expected: (a) the 1×1, visually hidden frame (`width:1px;height:1px;opacity:0;position:fixed`) autostarts and keeps playing with the screen locked; (b) the lock screen or notification shade shows a media notification with working pause/next. Record the result in the session progress note. If (a) fails → the design fallback applies: Task 4 gives the frame 1px of visible space inside the bar. If (b) fails → Task 3 still ships, and the Edge Android test cases (Task 10) drop the lock-screen-controls case.

- [x] **Step 1:** Build spike 0.0.3, send it with `tailscale file cp`, and have Greg run the 4-point check
- [x] **Step 2:** Record pass/fail per point in the progress note and commit the spike repo

### Task 2: Move queue and player modules

**Files:**
- Move: `src/offscreen/queue.mjs` → `src/player/queue.mjs`, `src/offscreen/player.mjs` → `src/player/player.mjs`, `src/offscreen/__tests__/*` → `src/player/__tests__/`

**Verification: non-testable** — Run: `pnpm test && pnpm lint` — Expected: PASS with the moved tests green and only import paths changed (`git diff -M --stat` shows renames).

- [x] **Step 1:** `git mv` the files and fix imports — Run: `pnpm test` — Expected: PASS
- [x] **Step 2:** Commit — `git commit -m "refactor: move audio queue and player to src/player"`

### Task 3: Player frame module with Media Session

**Files:**
- Create: `src/player.html`, `src/player.mjs` (`createPlayerFrame({ port, audio, storage, mediaSession, speak })`)
- Test: `src/__tests__/player-frame.test.mjs`

**Acceptance criteria:**
- WHEN a `play` arrives on the port THEN engine settings are read from `storage` (`chrome.storage.sync` via `src/settings.mjs`) and sentence `start` is fetched and played
- WHEN the player starts sentence i THEN the port receives `{type:"sentence-start", index:i}`
- WHEN a `window` `message` event shaped like `play` arrives THEN nothing plays (only the port is listened to)
- WHEN sentence 3 starts on a page titled "Spider's Web" with voice "krystyna1" THEN `mediaSession.metadata` is {title "Spider's Web", artist "Lektor TTS", album "krystyna1"}; the page title comes with `play` as `title`
- WHEN the `nexttrack` / `previoustrack` handler fires THEN the player seeks to i+1 / i−1 and `sentence-start` is emitted
- WHEN the `pause` / `play` handler fires THEN audio pauses / resumes and `state` is emitted
- WHEN `audio.play()` rejects with `NotAllowedError` THEN `{type:"state", state:"paused"}` is emitted
- WHEN the engine fails THEN `{type:"error", message}` is emitted
- WHEN `src/player.mjs` runs in the real frame THEN it calls `chrome.tabs.getCurrent()` and `chrome.tabs.connect(tab.id, {name:"player"})`

**Contract:** `play` gains an optional `title: string` (page title for Media Session).

**Tests (names only — red first):**
- "play reads engine settings from storage and plays the start sentence"
- "emits sentence-start for each sentence"
- "ignores window messages"
- "sets media session metadata from title and voice"
- "next and previous track handlers seek"
- "play and pause handlers toggle audio and report state"
- "autoplay rejection reports paused"
- "engine error is reported over the port"

- [x] **Step 1: Write the failing tests** — Run: `pnpm test` — Expected: FAIL
- [x] **Step 2: Minimal implementation** — Run: `pnpm test` — Expected: PASS
- [x] **Step 3: Commit** — `git commit -m "feat: player frame with media session"`

### Task 4: Content script hosts the frame

**Files:**
- Modify: `src/content/main.mjs` (`send`/engine relay → port; frame injection; `onMessage` events now from the port)
- Test: `src/content/__tests__/main.test.mjs`

**Acceptance criteria:**
- WHEN a session starts THEN the shadow host holds exactly one iframe with `src` = `chrome.runtime.getURL("src/player.html")` and `allow="autoplay"`, sized 1×1 and visually hidden (or 1px visible per the Task 1 result)
- WHEN the frame connects with name `"player"` THEN the pending `play` (with `title: document.title`) is sent on that port; ports with another name are ignored
- WHEN the port disconnects during a live session at sentence 5 THEN one new frame is injected and `play` resumes from 5
- WHEN the re-injected frame's port disconnects too THEN playback stops and the bar shows the error with Retry
- WHEN the session closes THEN the frame is removed and `stop` is sent first

**Tests (names only — red first):**
- "start injects one player frame into the shadow host"
- "sends play with the page title when the frame connects"
- "ignores ports with another name"
- "re-injects once and resumes from the current sentence on disconnect"
- "second disconnect shows the bar error"
- "close stops and removes the frame"

- [x] **Step 1: Write the failing tests** — Run: `pnpm test` — Expected: FAIL
- [x] **Step 2: Minimal implementation** — Run: `pnpm test` — Expected: PASS
- [x] **Step 3: Commit** — `git commit -m "feat: content script hosts the player frame"`

### Task 5: Service worker without offscreen; manifest

**Files:**
- Modify: `src/background.mjs` (remove `OFFSCREEN_URL`, `ensureOffscreen`, `offscreenAlive`, `replay`, `stopOffscreen`, `REPLAYABLE`, `onOffscreenEvent` and the relay in `onControl`/`onPlay`; keep ownership: starting in tab B sends `stop` to tab A's content script)
- Modify: `manifest.json` (drop `offscreen`; add `web_accessible_resources: [{resources:["src/player.html","src/player.mjs","src/player/*.mjs","src/engine.mjs","src/settings.mjs"], matches:["<all_urls>"]}]`, the files the frame imports)
- Delete: `src/offscreen.html`, `src/offscreen.mjs`, `src/__tests__/offscreen.test.mjs`
- Test: `src/__tests__/background.test.mjs`, `src/__tests__/manifest.test.mjs`

**Acceptance criteria:**
- WHEN a session runs in tab A and the user starts in tab B THEN tab A's content script receives `stop`
- WHEN the owner tab closes THEN the service worker clears ownership and calls no offscreen API
- WHEN the manifest is inspected THEN `permissions` lacks `offscreen`, `web_accessible_resources` lists `src/player.html`, `host_permissions` holds only localhost and 127.0.0.1, and no remote script URL appears
- WHEN `grep -r offscreen src manifest.json` runs (tests excluded) THEN nothing matches

**Tests (names only — red first):**
- "starting in another tab stops the previous owner tab"
- "owner tab close clears ownership"
- "manifest has no offscreen permission"
- "player frame is web accessible"

- [x] **Step 1: Write the failing tests** — Run: `pnpm test` — Expected: FAIL
- [x] **Step 2: Minimal implementation** — Run: `pnpm test && pnpm lint` — Expected: PASS
- [x] **Step 3: Commit** — `git commit -m "feat: drop offscreen document; frame is web accessible"`

### Task 6: Compact player bar

**Files:**
- Modify: `src/content/bar.mjs` (`makeBar`: row layout, speed chip, ⋯ fold-out; `onAction` gains `speed-cycle`)
- Test: `src/content/__tests__/bar.test.mjs`
- Mockup: [projects/omnivoice-server/mockups/2026-11-16-lektor-mobile-bar-options.html](/project/omnivoice-server/mockups?file=omnivoice-server%2Fmockups%2F2026-11-16-lektor-mobile-bar-options.html) — option A

**Acceptance criteria:**
- WHEN the bar renders during playback THEN the row holds, in order, prev · play/pause · next · speed chip · spacer · ⋯ · close, and Voice, Speed slider and Autoscroll are not in the row
- WHEN the bar's CSS is read THEN every control has `min-width` and `min-height` of 44px and play/pause has the accent fill
- WHEN the row is laid out at 390px THEN it uses `flex-wrap: nowrap`
- WHEN the speed is 1.0 and the chip is tapped three times THEN the speed goes 1.2 → 1.5 → 2.0, the chip label follows, and each value is saved as the default
- WHEN the speed is 1.3 (slider) and the chip is tapped THEN it becomes 1.5; from 2.0 it becomes 0.8
- WHEN ⋯ is tapped THEN a fold-out under the row shows Voice select, Speed slider with value and Autoscroll toggle, and ⋯ gets `aria-expanded="true"` and the collapse icon
- WHEN the bar is styled THEN it floats with rounded corners, background `#1f2328`, 10px side margins, and `max-width` stops it from stretching at 1280px
- WHEN a voice is picked in the fold-out during playback THEN `set-voice` is sent and saved as the default (living scenario)

**Tests (names only — red first):**
- "row holds transport controls in mockup order"
- "controls are at least 44px and play uses the accent"
- "row does not wrap"
- "speed chip cycles presets and saves the default"
- "speed chip moves from an off-preset value to the next preset"
- "more button folds out voice speed and autoscroll"
- "bar floats with margins and capped width"
- "voice change from the fold-out restarts the sentence"

- [x] **Step 1: Write the failing tests** — Run: `pnpm test` — Expected: FAIL
- [x] **Step 2: Minimal implementation** — Run: `pnpm test` — Expected: PASS
- [x] **Step 3: Commit** — `git commit -m "feat: compact one-row player bar"`

### Task 7: Selection actions

**Files:**
- Modify: `src/content/bar.mjs` (`showSelectionActions(bool)`, strip above the row), `src/content/main.mjs` (`selectionchange` listener, debounced 150ms; `from-here` / `selection` starts)
- Test: `src/content/__tests__/bar.test.mjs`, `src/content/__tests__/main.test.mjs`
- Mockup: as Task 6, state "Text selected"

**Acceptance criteria:**
- WHEN during a session a non-collapsed selection outside the bar exists for 150ms THEN the strip with two equal-width buttons "▶ From here" and "▶ Selection" shows above the row, and the row's left offset is unchanged
- WHEN the selection collapses THEN the strip is removed
- WHEN no session runs THEN no strip is shown and no listener does work
- WHEN "▶ From here" is tapped with the selection in paragraph 7 THEN a `from-here` start uses the selection's start node as target (same pane narrowing as Alt+click) and the selection is collapsed
- WHEN "▶ Selection" is tapped on two selected sentences THEN exactly those two are read and the session ends after the second

**Tests (names only — red first):**
- "selection strip shows above the row during a session"
- "strip hides when the selection collapses"
- "no strip without a session"
- "from here starts at the selection start and clears it"
- "selection button reads only the selected sentences"

- [x] **Step 1: Write the failing tests** — Run: `pnpm test` — Expected: FAIL
- [x] **Step 2: Minimal implementation** — Run: `pnpm test` — Expected: PASS
- [x] **Step 3: Commit** — `git commit -m "feat: selection actions in the player bar"`

### Task 8: Bar captures in the screenshot script

**Files:**
- Modify: `scripts/screenshots.mjs`
- Test: `scripts/__tests__/` (extend the existing screenshot-list test if present; otherwise verification below)

**Acceptance criteria:**
- WHEN `pnpm screenshots` runs THEN it also writes `qa/visual/bar-playing-{390,1280}.png`, `qa/visual/bar-selection-{390,1280}.png` and `qa/visual/bar-settings-{390,1280}.png` against the fake engine, and the existing outputs still appear

**Tests (names only — red first):**
- "screenshot plan lists the six bar captures"

- [x] **Step 1: Write the failing test** — Run: `pnpm test` — Expected: FAIL
- [x] **Step 2: Implement** — Run: `pnpm test && pnpm screenshots` — Expected: PASS, 6 new PNGs
- [x] **Step 3: Commit** — `git commit -m "chore: capture the player bar in screenshots"`

### Task 9: Visual verification against mockups
References:
- [projects/omnivoice-server/mockups/2026-11-16-lektor-mobile-bar-options.html](/project/omnivoice-server/mockups?file=omnivoice-server%2Fmockups%2F2026-11-16-lektor-mobile-bar-options.html) — option A — viewport 390px and 1280px
  - Check: one row prev · play/pause · next · speed chip · spacer · ⋯ · close, nothing wraps at 390px; controls ≥ 44×44px, play/pause accent; speed chip shows current value; selection strip with two equal-width "▶ From here" / "▶ Selection" above an unmoved row, gone when the selection collapses; ⋯ fold-out with Voice, Speed slider + value, Autoscroll, ⋯ turns into collapse; floats above the browser toolbar, rounded, `#1f2328`, 10px side margins; 1280px same layout, not full width
  - Agreed deviations: none
Acceptance criteria:
- WHEN rendered at 390px and 1280px THEN a screenshot is compared to the option A mockup; every Check item matches or is an agreed deviation
- WHEN a mismatch is found THEN fix it and repeat the comparison; DOM assertions alone do not satisfy visual verification
- WHEN the surface cannot be reached THEN ask the user for a screenshot; never check this task off without a comparison
Steps:
- [x] Step 1: Capture screenshots per reference and viewport (`pnpm screenshots`); record match/mismatch per Check item
- [x] Step 2: Fix mismatches and repeat until every item matches or is an agreed deviation
- [x] Step 3: Save screenshots to `openspec/changes/2026-11-16-mobile-reader/verification/` and list them with viewport sizes in the session progress note

### Task 10: Listing kit, README and version 1.1.0

**Files:**
- Modify: `store/listing.md` (permission justifications; new "Edge Android" section), `README.md` (§ Releasing), `manifest.json` + `package.json` (`1.1.0`), `PRIVACY.md` only if wording names the offscreen document
- Test: existing `scripts/__tests__/` package tests

**Acceptance criteria:**
- WHEN the justifications are read THEN there is none for `offscreen` and one for `web_accessible_resources` (player frame)
- WHEN "Edge Android" is read THEN it holds a mobile value statement, the request form link from MicrosoftEdge-Extensions#529, and numbered test cases (install; setup against an engine; read an article; selection actions; screen-locked playback; lock-screen media controls, unless Task 1 dropped it), each with steps and an expected result
- WHEN README § Releasing is read THEN it lists bump version, `pnpm test`, `pnpm package`, `pnpm screenshots`, upload to Edge Add-ons and the Chrome Web Store, tag `v<version>`, and links the Edge Android steps
- WHEN `pnpm package` runs THEN `lektor-tts-1.1.0.zip` is written with `src/player*` and without `src/offscreen*`

**Verification: non-testable** for the docs — Run: `pnpm test && pnpm package && unzip -l lektor-tts-1.1.0.zip | grep -c offscreen` — Expected: tests PASS, zip written, count `0`.

- [x] **Step 1:** Write docs and bump the version — Run: the verification command — Expected: as above
- [x] **Step 2:** Commit — `git commit -m "docs: 1.1.0 listing kit with Edge Android section"`

### Task 11: Device verification on Vivaldi Android

**Verification: non-testable** — send `lektor-tts-1.1.0.zip` to the phone (`tailscale file cp … galaxy-s23-ultra:`), remove 1.0.0, sideload 1.1.0, and run the Edge Android test cases from `store/listing.md` — Expected: every case passes. Also: the toolbar start with a selection reads only the selection (or the result is recorded as "selection lost on toolbar tap; selection actions cover it"); the bar fits one row. Results go to `openspec/changes/2026-11-16-mobile-reader/verification/device.md`.

- [x] **Step 1:** Greg runs the cases; record per-case results in `verification/device.md`
- [x] **Step 2:** Fix failures as new tasks only if a scenario from the delta specs fails; commit `verification/`

### Task 12: Release (Greg, manual)

**Verification: non-testable** — Expected: 1.1.0 uploaded to Edge Partner Center and the Chrome Web Store, tag `v1.1.0` pushed, and the Edge Android request form submitted with the test cases. The PR `feat/mobile-reader` → `main` is merged first.

- [ ] **Step 1:** Open the PR and merge after review
- [ ] **Step 2:** Greg uploads to both stores and submits the Edge Android form; tag `v1.1.0`

### Task 13: Start-point discovery (added after device testing)

**Files:**
- Modify: `src/content/bar.mjs` (`showTip`, `touch` option, "From here" title), `src/content/main.mjs` (tip once per device via `chrome.storage.local` `tipShown`, 8 s timer, hide on bar action, re-check), `src/options.mjs` (`START_HINT` per device, injectable `matchMedia`), `README.md`
- Test: `src/content/__tests__/main.test.mjs`, `src/__tests__/options.test.mjs`

**Acceptance criteria:**
- WHEN the first session on a desktop starts THEN the bar shows "Tip: Alt+click a paragraph to read from there." on a thin line above the row with a ×, and `tipShown: true` is written to `chrome.storage.local`
- WHEN the device has a coarse pointer (`matchMedia('(pointer: coarse)')`) THEN the tip reads "Tip: select text to read from there."
- WHEN 8 s pass, the × is tapped or any bar action fires THEN the tip is removed
- WHEN `tipShown` is already set THEN no tip is shown
- WHEN the tip appears while a sentence is highlighted THEN the sentence is re-checked (`recheckSentence`), as for the fold-out
- WHEN the selection strip appears THEN the tip is removed (the strip wins)
- WHEN "Save and test" succeeds THEN the hint is "Try it: open an article and click the Lektor icon, or select text and press Alt+Shift+R. Alt+click a paragraph to read from there." on desktop and "Try it: open an article and tap the Lektor icon in the toolbar. Select text to read from there." on touch
- WHEN the selection strip shows on desktop THEN "From here" has the title "Read from here — or Alt+click any paragraph"; on touch it has none

**Tests:** "first session shows the Alt+click tip once on desktop", "touch devices get the selection tip", "tip hides after 8 seconds, on ×, or on the first bar action", "tip is not shown again after it was shown", "showing the tip re-checks the current sentence", "setup hint matches the device", "From here has an Alt+click tooltip on desktop only"

- [x] **Step 1:** Write the tests and watch them fail — Run: `env -u NODE_ENV pnpm test` — Expected: the new tests FAIL
- [x] **Step 2:** Implement tip, tooltip and setup hint — Run: `env -u NODE_ENV pnpm test && pnpm lint` — Expected: PASS
- [x] **Step 3:** Commit — `git commit -m "feat: hint at Alt+click and selection start points"`
