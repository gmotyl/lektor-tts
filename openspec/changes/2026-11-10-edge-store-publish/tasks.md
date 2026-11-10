# Lektor TTS on Edge Add-ons Implementation Plan

> **For agentic workers:** implement this plan with [[pavilio-execute-plan]] — task-by-task, top-down; check off each step (`- [ ]` → `- [x]`) as it lands. Do one task fully (test → implement → verify → commit) before starting the next.

**Goal:** Move the reader extension into its own public repo `gmotyl/lektor-tts`, ship it as "Lektor TTS" 1.0.0 with a first-run setup screen, a new icon and a store release kit, and leave `omnivoice-server` server-only.

**Architecture:** `git filter-repo` extracts `extension/` (to the root) plus the reader-extension OpenSpec paths and this change dir into `/srv/git/prv/lektor-tts`. Extension work then happens there on branch `feat/store-release` (PR to `main`); the `omnivoice-server` cleanup happens on `feat/edge-store-publish` (PR to `master`). Presets live in one module that the options page, settings migration and background all read.

**Tech Stack:** MV3 extension (plain ES modules, esbuild for the content bundle), `node --test` + linkedom, pnpm 10, `@resvg/resvg-js`, `fflate`, `playwright`; omnivoice-server: Python 3.12 + uv, pytest, relay `node --test`.

**Design:** [design.md](design.md)

**Repos and paths.** Tasks 1–3 and 15 run in `/srv/git/prv/omnivoice-server`. Tasks 4–14 run in `/srv/git/prv/lektor-tts`, paths relative to its root (old `extension/src/…` is now `src/…`). Task 16 is Greg's. After Task 2 each repo's copy of this file keeps only its own tasks.

---

### Task 4: Rename to Lektor TTS 1.0.0

**Files:**
- Modify: `manifest.json` (`name`, `version`, `action.default_title`, `description`), `package.json` (`name` → `lektor-tts`, `version`, `description`), `src/options.html` (`<title>`, heading), `src/background.mjs` (context-menu titles if they name the product)
- Test: `src/__tests__/manifest.test.mjs`

**Acceptance criteria:**
- WHEN the manifest is read THEN `name` is "Lektor TTS", `version` is "1.0.0", equal to `package.json` `version`
- WHEN `grep -ri "omnivoice reader"` runs over `src/ manifest.json package.json README.md` THEN nothing matches

**Tests (names only — red first):**
- "manifest is named Lektor TTS at version 1.0.0"
- "manifest and package.json versions match"

- [ ] **Step 1: Write the failing tests** — Run: `corepack pnpm test` — Expected: FAIL
- [ ] **Step 2: Minimal implementation** — Run: `corepack pnpm test` — Expected: PASS
- [ ] **Step 3: Commit** — `git commit -am "feat: rename to Lektor TTS 1.0.0"`

### Task 5: Icon from one SVG

**Files:**
- Create: `icons/icon.svg`, `scripts/render-icons.mjs`, `store/logo-300.png`
- Modify: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`, `package.json` (script `icons`, devDependency `@resvg/resvg-js`)
- Test: `scripts/__tests__/render-icons.test.mjs`
- Reference: [projects/omnivoice-server/mockups/2026-11-10-lektor-icon-options.html](/project/omnivoice-server/mockups?file=omnivoice-server%2Fmockups%2F2026-11-10-lektor-icon-options.html) — option B

**Acceptance criteria:**
- WHEN `icons/icon.svg` is read THEN its viewBox is `0 0 128 128`
- WHEN it is read THEN a navy `#1e2a4a` rect with `rx="28"` covers 0,0–128,128 (no transparent margin)
- WHEN it is read THEN a white "L" path has stroke-width 18, round linecap and linejoin, and lies in the left half
- WHEN it is read THEN two concentric `#ffd54a` arcs with stroke-width 8 start at the L's corner region and stay inside the tile
- WHEN `corepack pnpm icons` runs THEN 16, 48, 128 and 300 px PNGs are written from that SVG only (no other image sources)
- WHEN the 16 px PNG is sampled THEN the L's pixels are light and the outer arc's pixels are yellowish against the navy tile (legible on `#f3f3f3` and `#2b2b2b`, confirmed visually in Task 13)

**Tests (names only — red first):**
- "icon svg has a 128 viewBox"
- "icon svg tile is navy rx 28 and fills the square"
- "icon svg L is white stroke 18 with round caps on the left half"
- "icon svg has two yellow stroke-8 arcs inside the tile"
- "render-icons writes 16 48 128 and 300 px PNGs from icon.svg"
- "16 px icon keeps the L and the outer arc distinguishable from the tile"

- [ ] **Step 1: Write the failing tests** — Run: `corepack pnpm test` — Expected: FAIL
- [ ] **Step 2: Minimal implementation** — Run: `corepack pnpm icons && corepack pnpm test` — Expected: PASS
- [ ] **Step 3: Commit** — `git add icons store scripts package.json pnpm-lock.yaml && git commit -m "feat: L monogram icon rendered from one SVG"`

### Task 6: Engine presets

**Files:**
- Create: `src/presets.mjs`
- Test: `src/__tests__/presets.test.mjs`

**Contract:**
```js
// src/presets.mjs
export const PRESET_IDS = ["openai", "omnivoice", "other"];
export const PRESETS; // { [id]: { id, label, baseUrl, models: string[], defaultModel, voicesByModel?: {[model]: string[]}, quickStartUrl? } }
export function voicesFor(presetId, model); // string[] | null (null = ask the engine)
export function presetForBaseUrl(baseUrl); // "omnivoice" | "openai" | "other"
```

**Acceptance criteria:**
- WHEN the presets task starts THEN the OpenAI voice lists per model are checked against OpenAI's current TTS docs and the result (date + URL) is noted in the progress file; the counts below follow that check
- WHEN `voicesFor("openai", "gpt-4o-mini-tts")` THEN it returns the model's voices (11 per the design, incl. `ballad`, `verse`)
- WHEN `voicesFor("openai", "tts-1")` or `"tts-1-hd"` THEN it returns 9 voices without `ballad`/`verse`
- WHEN `voicesFor("omnivoice" | "other", any)` THEN it returns `null`
- WHEN `PRESETS.openai` is read THEN `baseUrl` is `https://api.openai.com/v1`, `defaultModel` `gpt-4o-mini-tts`, `models` `["gpt-4o-mini-tts","tts-1","tts-1-hd"]`
- WHEN `PRESETS.omnivoice` is read THEN `baseUrl` is `http://localhost:8892/v1` and `quickStartUrl` is `https://github.com/gmotyl/omnivoice-server#quick-start-read-web-pages-aloud`
- WHEN `presetForBaseUrl` gets `http://localhost:8892/v1`, `http://127.0.0.1:8892/v1`, `https://api.openai.com/v1/`, `https://spock.example.ts.net:8444/v1` THEN it returns `omnivoice`, `omnivoice`, `openai`, `other`

**Tests (names only — red first):**
- "openai preset lists gpt-4o-mini-tts voices"
- "openai tts-1 and tts-1-hd list voices without ballad and verse"
- "self-hosted presets defer voices to the engine"
- "openai preset defaults"
- "omnivoice preset points at localhost 8892 and the GitHub quick start"
- "presetForBaseUrl maps known hosts"

- [ ] **Step 1: Write the failing tests** — Run: `corepack pnpm test` — Expected: FAIL
- [ ] **Step 2: Minimal implementation** — Run: `corepack pnpm test` — Expected: PASS
- [ ] **Step 3: Commit** — `git commit -am "feat: engine presets"` (add the new files)

### Task 7: `preset` setting and migration

**Files:**
- Modify: `src/settings.mjs` (`DEFAULTS`, `loadSettings`, new export `isConfigured`)
- Test: `src/__tests__/settings.test.mjs`

**Acceptance criteria:**
- WHEN `DEFAULTS` is read THEN it has `preset: ""`; other defaults unchanged
- WHEN stored settings have no `preset`, `baseUrl` `http://localhost:8892/v1` and a non-empty `voice` THEN `loadSettings` returns `preset: "omnivoice"` and writes it back to storage
- WHEN stored settings have no `preset` and `baseUrl` `https://spock-wsl.example.ts.net:8444/v1` THEN `preset` becomes `other`
- WHEN stored settings have no `preset` and every engine key (`baseUrl`, `apiKey`, `voice`, `model`) equals the old defaults THEN `preset` stays `""` and `isConfigured` returns false
- WHEN `preset` is any of `PRESET_IDS` THEN `isConfigured` returns true

**Tests (names only — red first):**
- "defaults include an empty preset"
- "migrates a saved localhost 8892 setup to omnivoice and persists it"
- "migrates a saved non-local server to other"
- "untouched defaults stay unconfigured"
- "isConfigured is true for every preset id"

- [ ] **Step 1: Write the failing tests** — Run: `corepack pnpm test` — Expected: FAIL
- [ ] **Step 2: Minimal implementation** — Run: `corepack pnpm test` — Expected: PASS
- [ ] **Step 3: Commit** — `git commit -am "feat: preset setting with migration of saved settings"`

### Task 8: Open the setup screen on install

**Files:**
- Modify: `src/background.mjs` (`onInstalled` listener)
- Test: `src/__tests__/background.test.mjs`

**Acceptance criteria:**
- WHEN `onInstalled` fires with `reason: "install"` THEN `chrome.runtime.openOptionsPage` is called once and the context menus are still created
- WHEN it fires with `reason: "update"` or `"chrome_update"` THEN `openOptionsPage` is not called

**Tests (names only — red first):**
- "fresh install opens the options page"
- "update does not open the options page"

- [ ] **Step 1: Write the failing tests** — Run: `corepack pnpm test` — Expected: FAIL
- [ ] **Step 2: Minimal implementation** — Run: `corepack pnpm test` — Expected: PASS
- [ ] **Step 3: Commit** — `git commit -am "feat: open setup screen on install"`

### Task 9: Setup prompt while unconfigured

**Files:**
- Modify: `src/background.mjs` (start-trigger handling), `src/content/bar.mjs` (setup-prompt state), `src/content/main.mjs` (message handling)
- Test: `src/__tests__/background.test.mjs`, `src/content/__tests__/bar.test.mjs`
- Reference: [projects/omnivoice-server/mockups/2026-11-10-lektor-setup-screen-options.html](/project/omnivoice-server/mockups?file=omnivoice-server%2Fmockups%2F2026-11-10-lektor-setup-screen-options.html) — "All options: player bar before setup"

**Acceptance criteria:**
- WHEN no preset is configured and the icon, Alt+Shift+R or a context-menu item fires THEN the content script is injected, the bar shows the setup prompt, and no offscreen `play` / `/audio/speech` request is made
- WHEN the setup prompt is shown THEN its text is "Lektor needs a speech engine before it can read." with a yellow "Set up a speech engine" button and a × close button, and no error text or Retry button
- WHEN "Set up a speech engine" is clicked THEN the background calls `chrome.runtime.openOptionsPage`
- WHEN × is clicked THEN the bar is removed

**Tests (names only — red first):**
- "unconfigured start shows the setup prompt without calling the engine"
- "setup prompt shows the message, the setup button and close, no retry"
- "setup button opens the options page"
- "close removes the setup prompt bar"

- [ ] **Step 1: Write the failing tests** — Run: `corepack pnpm test` — Expected: FAIL
- [ ] **Step 2: Minimal implementation** — Run: `corepack pnpm build && corepack pnpm test` — Expected: PASS
- [ ] **Step 3: Commit** — `git commit -am "feat: setup prompt in the player bar while unconfigured"`

### Task 10: Setup screen (options page)

**Files:**
- Modify: `src/options.html`, `src/options.mjs`
- Test: `src/__tests__/options.test.mjs`
- Reference: [projects/omnivoice-server/mockups/2026-11-10-lektor-setup-screen-options.html](/project/omnivoice-server/mockups?file=omnivoice-server%2Fmockups%2F2026-11-10-lektor-setup-screen-options.html) — option A

**Acceptance criteria:**
- WHEN the page renders THEN the header shows the icon and "Lektor TTS" and the lede "Lektor reads web pages aloud through a text-to-speech server. Choose one to get started."
- WHEN it renders THEN "Speech engine" holds three radio cards in order OpenAI ("Paste an API key. Paid per use."), omnivoice-server ("Free, runs on your own computer."), Other server ("Any OpenAI-compatible endpoint."); the checked card has a navy border and a yellow dot; the cards wrap at 390 px
- WHEN OpenAI is selected THEN an API key field with a hint (where to create a key, sent only to OpenAI) and a voice select from `voicesFor("openai", model)` are shown, and no URL field
- WHEN omnivoice-server is selected THEN the address field holds `http://localhost:8892/v1` and a "Quick start" link with `target="_blank"` points to the GitHub quick-start URL and mentions `./omnivoicectl start`; the voice select fills after a successful test
- WHEN Other server is selected THEN base URL, optional API key and a voice field (select if listed, else free text) are shown
- WHEN the page renders THEN there is exactly one primary button "Save and test" and no separate "Test connection"
- WHEN "Save and test" succeeds for OpenAI THEN host permission for `https://api.openai.com/*` was requested, settings incl. `preset` were saved, `GET /models` was called with the key, and the status reads "✓ Connected to OpenAI · N voices" (N = length of the shipped list) plus a hint how to start reading
- WHEN the engine answers 401 THEN its error message is shown under the button and the settings stay saved
- WHEN the permission request is denied THEN nothing is saved and the status reads "Lektor needs permission to reach <origin>"
- WHEN the page renders THEN speed, autoscroll and model sit in a collapsed `<details>` "More settings"; changing the OpenAI model there re-renders the voice list
- WHEN the page renders THEN a "Buy me a coffee" footer link to `https://buymeacoffee.com/motyl.dev` sits below "More settings"

**Tests (names only — red first):**
- "header shows icon, name and lede"
- "three preset cards in order with their copy"
- "checked card is marked"
- "openai card shows key and fixed voices, no url"
- "omnivoice card shows localhost address and GitHub quick start link"
- "other card shows url, optional key and voice"
- "single Save and test button"
- "save and test with openai requests permission, saves, tests and reports voices"
- "401 shows the engine message and keeps settings"
- "denied permission saves nothing"
- "more settings is collapsed and model change updates voices"
- "footer has the buy me a coffee link"

- [ ] **Step 1: Write the failing tests** — Run: `corepack pnpm test` — Expected: FAIL
- [ ] **Step 2: Minimal implementation** — Run: `corepack pnpm test` — Expected: PASS
- [ ] **Step 3: Commit** — `git commit -am "feat: setup screen with engine presets"`

### Task 11: Store package

**Files:**
- Create: `scripts/package.mjs`
- Modify: `package.json` (script `package`, devDependency `fflate`)
- Test: `scripts/__tests__/package.test.mjs`

**Acceptance criteria:**
- WHEN `corepack pnpm package` runs THEN it builds first and writes `lektor-tts-1.0.0.zip` containing `manifest.json`, `dist/**`, `src/**` without any `__tests__`, and `icons/*.png`, and nothing from `node_modules/`, `scripts/`, `store/`, `qa/`, `openspec/`
- WHEN the manifest and package.json versions differ THEN it exits non-zero and writes no zip

**Tests (names only — red first):**
- "package zip holds only runtime files"
- "package refuses mismatched versions"

- [ ] **Step 1: Write the failing tests** — Run: `corepack pnpm test` — Expected: FAIL
- [ ] **Step 2: Minimal implementation** — Run: `corepack pnpm package && unzip -l lektor-tts-1.0.0.zip` — Expected: PASS, runtime files only
- [ ] **Step 3: Commit** — `git commit -am "feat: pnpm package builds the store zip"`

### Task 12: Fake engine and screenshots

**Files:**
- Create: `scripts/fake-engine.mjs`, `scripts/screenshots.mjs`, `scripts/fixtures/article.html`, `store/screenshot-reading.png`, `store/screenshot-setup.png`, `store/screenshot-unconfigured.png`
- Modify: `package.json` (script `screenshots`, devDependency `playwright`)
- Test: `scripts/__tests__/fake-engine.test.mjs`

**Acceptance criteria:**
- WHEN the fake engine runs THEN `GET /v1/models` is 200, `GET /v1/audio/voices` returns `{voices:["demo-1","demo-2"]}`, `POST /v1/audio/speech` returns a short silent `audio/mpeg`, all with permissive CORS
- WHEN `corepack pnpm screenshots` runs THEN Chromium loads the unpacked extension and writes the three `store/*.png` at exactly 1280×800, plus `qa/visual/setup-390.png`, `qa/visual/setup-1280.png`, `qa/visual/icon-toolbars.png`, without a GPU or an API key
- WHEN `store/screenshot-reading.png` is viewed THEN a sentence is highlighted and the player bar is visible

**Tests (names only — red first):**
- "fake engine serves models, voices and silent speech with CORS"

- [ ] **Step 1: Write the failing test** — Run: `corepack pnpm test` — Expected: FAIL
- [ ] **Step 2: Implement both scripts** — Run: `corepack pnpm exec playwright install chromium && corepack pnpm screenshots && file store/*.png` — Expected: PASS, 1280 x 800
- [ ] **Step 3: Commit** — `git add scripts store package.json pnpm-lock.yaml && git commit -m "feat: fake engine and store screenshots"`

### Task 13: Visual verification against mockups
References:
- [projects/omnivoice-server/mockups/2026-11-10-lektor-icon-options.html](/project/omnivoice-server/mockups?file=omnivoice-server%2Fmockups%2F2026-11-10-lektor-icon-options.html) — option B — sizes 16/48/128/300, toolbars `#f3f3f3` and `#2b2b2b`
  - Check: 128 viewBox source; navy `#1e2a4a` tile rx 28 with no margin; white "L" stroke 18 round caps on the left half; two yellow `#ffd54a` arcs stroke 8 from the L's corner inside the tile; PNGs 16/48/128/300 from the one SVG; at 16 px the L and the outer arc visible on both toolbars
  - Agreed deviations: none
- [projects/omnivoice-server/mockups/2026-11-10-lektor-setup-screen-options.html](/project/omnivoice-server/mockups?file=omnivoice-server%2Fmockups%2F2026-11-10-lektor-setup-screen-options.html) — option A + player bar before setup — viewports 390px and 1280px
  - Check: header icon + name + lede; three cards in order with their copy, checked = navy border + yellow dot, wrap at 390; OpenAI → key + fixed voices, no URL; omnivoice-server → localhost address + GitHub Quick start link; Other → URL, optional key, voice; one "Save and test", success "✓ Connected to … · N voices" + start hint; "More settings ▸" collapsed with speed, autoscroll, model; unconfigured bar with message, yellow setup button, ×, no Retry
  - Agreed deviations: voice count = shipped OpenAI list, not "9"; Quick start link goes to GitHub; "Buy me a coffee" footer link below "More settings"
Acceptance criteria:
- WHEN rendered at each viewport/size THEN a screenshot is compared to its reference; every Check item matches or is an agreed deviation
- WHEN a mismatch is found THEN fix it and repeat the comparison; DOM assertions alone do not satisfy visual verification
- WHEN the surface cannot be reached THEN ask the user for a screenshot; never check this task off without a comparison
Steps:
- [ ] Step 1: Capture screenshots per reference and viewport (`corepack pnpm screenshots` → `qa/visual/`); record match/mismatch per Check item
- [ ] Step 2: Fix mismatches and repeat until every item matches or is an agreed deviation
- [ ] Step 3: Save screenshots to `openspec/changes/2026-11-10-edge-store-publish/verification/` and list them with viewport sizes in the session progress note

### Task 14: Listing kit, privacy policy and README

**Files:**
- Create: `store/listing.md`, `PRIVACY.md`
- Modify: `README.md` (rewrite for lektor-tts: what it is, install from Edge Add-ons + build from source, setup per preset, using it, troubleshooting, development, § Releasing, footer)

**Acceptance criteria:**
- WHEN `store/listing.md` is read THEN it has name, short description, full description (three engines, OpenAI setup steps, omnivoice-server Quick start link, closing Buy me a coffee line), category Productivity (Accessibility noted), support URL `https://github.com/gmotyl/lektor-tts/issues`, privacy URL `https://github.com/gmotyl/lektor-tts/blob/main/PRIVACY.md`, one justification for each of `activeTab`, `scripting`, `offscreen`, `contextMenus`, `storage`, the localhost hosts and optional `http(s)://*/*`, and certification test steps that say the key is supplied at submission; no key in the file
- WHEN any OpenAI price is written THEN it was checked against OpenAI's pricing page that day (URL + date in the progress note)
- WHEN `PRIVACY.md` is read THEN it states no data collected, page text only to the configured engine, settings incl. the key in browser sync storage, no analytics, no remote code
- WHEN the README is read THEN § Releasing lists bump version → `pnpm test` → `pnpm package` → `pnpm screenshots` if the UI changed → upload + paste `store/listing.md` → tag `v<version>`, and the file ends with the creator line and the yellow badge exactly as in design.md

**Verification: non-testable** — Run: `grep -c "buymeacoffee.com/motyl.dev" README.md store/listing.md; grep -E "sk-[A-Za-z0-9]" -r store README.md PRIVACY.md` — Expected: ≥1 each; no key matches.

- [ ] **Step 1: Write the three files, commit** — `git add store/listing.md PRIVACY.md README.md && git commit -m "docs: store listing kit, privacy policy, README"`
- [ ] **Step 2: Push `feat/store-release`, open PR to `main`** — `gh pr create --base main` (body ends with the Claude Code attribution)

