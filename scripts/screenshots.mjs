// Store screenshots and visual-check captures, made in headless Chromium with the unpacked
// extension, the fake engine (scripts/fake-engine.mjs) and a local sample article. No GPU, no
// API key.
//
// Writes store/screenshot-setup.png, store/screenshot-unconfigured.png and
// store/screenshot-reading.png (1280×800 each), plus qa/visual/setup-390.png,
// qa/visual/setup-1280.png, qa/visual/icon-toolbars.png and the other setup states
// (setup-{other,omnivoice,success,more}-{1280,390}.png, bar-unconfigured-390.png) and the
// player bar states (bar-{playing,selection,settings}-{390,1280}.png and bar-tip-390.png, see
// barCaptures()) for the mockup comparison.
//
// Each run starts from a fresh profile, so the one-time start-point tip would show in the first
// session; the tip flag is seeded before any capture and cleared only for bar-tip-390.png.
//
// The toolbar button cannot be clicked in headless Chromium, and chrome.action.onClicked
// cannot be fired from outside, so the script runs the same path in the service worker as the
// action listener: inject dist/content.js, then send "setup-prompt" (no engine set up) or
// "start" to the tab.

// Callbacks passed to worker.evaluate / page.evaluate run in the browser, not in Node.
/* global chrome, document */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { start as startEngine } from "./fake-engine.mjs";
import { PRESET_IDS } from "../src/presets.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STORE = join(root, "store");
const QA = join(root, "qa", "visual");
const SIZE = { width: 1280, height: 800 };
const ARTICLE = "/article.html";

function build() {
  const run = spawnSync(process.execPath, [join(root, "build.mjs")], { cwd: root, stdio: "inherit" });
  if (run.status !== 0) throw new Error("build failed");
}

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), "lektor-shots-"));
  const context = await chromium.launchPersistentContext(profile, {
    // Extensions need the full Chromium build in the new headless mode, not headless_shell.
    channel: "chromium",
    headless: true,
    viewport: SIZE,
    deviceScaleFactor: 1,
    colorScheme: "light",
    args: [
      `--disable-extensions-except=${root}`,
      `--load-extension=${root}`,
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
      "--disable-gpu",
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  return {
    context,
    worker,
    extensionId,
    async close() {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

// What chrome.action.onClicked does for a tab, run inside the service worker. Mirrors
// startIn() in src/background.mjs; keep the two in step. The function body is serialized
// into the worker, so PRESET_IDS is passed in as an argument instead of closed over.
async function clickAction(worker, url) {
  await worker.evaluate(async ({ pageUrl, presetIds }) => {
    const [tab] = await chrome.tabs.query({ url: pageUrl });
    if (!tab) throw new Error(`no tab for ${pageUrl}`);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["dist/content.js"] });
    const settings = await chrome.storage.sync.get(null);
    const configured = presetIds.includes(settings.preset);
    await chrome.tabs.sendMessage(tab.id, configured ? { type: "start", source: "auto" } : { type: "setup-prompt" });
  }, { pageUrl: url, presetIds: PRESET_IDS });
}

async function shoot(page, path, options = {}) {
  await page.screenshot({ path, animations: "disabled", ...options });
  console.log(`wrote ${path.slice(root.length + 1)}`);
}

async function setupScreens({ context, extensionId }) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);
  // A fresh install has no card checked; the screenshots show the OpenAI card chosen.
  await page.locator('label.card:has(input[value="openai"])').click();
  await page.locator("#apiKey").waitFor({ state: "visible" });
  await shoot(page, join(STORE, "screenshot-setup.png"));
  await shoot(page, join(QA, "setup-1280.png"), { fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await shoot(page, join(QA, "setup-390.png"), { fullPage: true });
  await page.close();
}

async function unconfiguredBar({ context, worker }, articleUrl) {
  const page = await context.newPage();
  await page.goto(articleUrl);
  await clickAction(worker, articleUrl);
  await page.locator("omnivoice-reader-bar").waitFor({ state: "attached" });
  await page.waitForTimeout(300);
  await shoot(page, join(STORE, "screenshot-unconfigured.png"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shoot(page, join(QA, "bar-unconfigured-390.png"));
  await page.close();
}

async function reading({ context, worker }, articleUrl, engineUrl) {
  await worker.evaluate(
    (baseUrl) => chrome.storage.sync.set({ preset: "other", baseUrl, apiKey: "", model: "tts-1", voice: "demo-1", speed: 1, autoscroll: true }),
    `${engineUrl}/v1`,
  );
  const page = await context.newPage();
  await page.goto(articleUrl);
  await clickAction(worker, articleUrl);
  const highlighted = () => page.waitForFunction(() => globalThis.CSS?.highlights?.get("reader-current")?.size > 0, null, { timeout: 15000 });
  await highlighted();
  // Alt+click a sentence further down: reading jumps there, as a user would do.
  const target = page.locator("article p", { hasText: "Reading aloud was also social." });
  await target.click({ modifiers: ["Alt"], position: { x: 40, y: 12 } });
  await page.waitForFunction(
    () => {
      const range = [...(globalThis.CSS?.highlights?.get("reader-current") ?? [])][0];
      return range && String(range).startsWith("Reading aloud was also social.");
    },
    null,
    { timeout: 15000 },
  );
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  await shoot(page, join(STORE, "screenshot-reading.png"));
  await page.close();
}

const WIDTHS = [1280, 390];

const BAR_STATES = ["playing", "selection", "settings"];
const BAR_VIEWPORTS = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 800 } };

// The player bar captures for the mockup comparison: each state at a phone and a desktop
// viewport, full viewport so the bar's place at the bottom shows, plus the one-time start-point
// tip at the phone width. Pure, for the tests.
export function barCaptures() {
  const capture = (state, width) => ({
    state,
    width,
    viewport: { ...BAR_VIEWPORTS[width] },
    file: `bar-${state}-${width}.png`,
  });
  return [...BAR_STATES.flatMap((state) => Object.keys(BAR_VIEWPORTS).map((width) => capture(state, Number(width)))), capture("tip", 390)];
}

// The tip shows once per device (chrome.storage.local "tipShown"). A fresh profile has no flag.
const setTipShown = (worker, shown) =>
  worker.evaluate((value) => (value ? chrome.storage.local.set({ tipShown: true }) : chrome.storage.local.remove("tipShown")), shown);

async function atWidths(page, name) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await shoot(page, join(QA, `${name}-${width}.png`), { fullPage: true });
  }
}

// Centre of the bar's ⋯ button in page coordinates. The bar lives in a closed shadow root, so
// the point is derived from its CSS: fixed, 10px side margins, centred, max-width 560px,
// bottom 16px, padding 8px; with the fold-out closed the row is the bottom block, and ⋯ is
// the 44px button left of × (also 44px) with a 6px gap. Keep in step with src/content/bar.mjs.
async function moreButtonPoint(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vh = globalThis.innerHeight;
    const barWidth = Math.min(vw - 20, 560);
    const barRight = (vw + barWidth) / 2;
    return { x: barRight - 8 - 44 - 6 - 22, y: vh - 16 - 8 - 22 };
  });
}

// Height of the player bar in CSS px. The host ([data-omnivoice-reader]) is an inline box with
// a fixed-position child behind a closed shadow root, so its own rect is empty; hits inside the
// shadow tree retarget to the host, so walk up the bar's centre line from the bottom until
// elementFromPoint leaves it.
async function barHeight(page) {
  return page.evaluate(() => {
    const host = document.querySelector("[data-omnivoice-reader]");
    if (!host) return 0;
    const x = document.documentElement.clientWidth / 2;
    let top = null;
    let bottom = null;
    for (let y = globalThis.innerHeight - 1; y >= 0; y--) {
      const onBar = document.elementFromPoint(x, y) === host;
      if (onBar && bottom === null) bottom = y;
      if (onBar) top = y;
      else if (bottom !== null) break;
    }
    return bottom === null ? 0 : bottom - top + 1;
  });
}

// The player bar during a session: playing, with a phrase selected (selection strip above the
// row) and with ⋯ opened (fold-out). Runs after reading(), which saved the engine settings.
async function barStates({ context, worker }, articleUrl) {
  const byState = Object.groupBy(barCaptures(), (c) => c.state);
  const captureState = async (page, state) => {
    for (const { viewport, file } of byState[state]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(300);
      await shoot(page, join(QA, file));
    }
  };
  const page = await context.newPage();
  await page.setViewportSize(BAR_VIEWPORTS[390]);
  await page.goto(articleUrl);
  await clickAction(worker, articleUrl);
  await page.waitForFunction(() => globalThis.CSS?.highlights?.get("reader-current")?.size > 0, null, { timeout: 15000 });
  await page.mouse.move(0, 0);
  await captureState(page, "playing");

  // A phrase in a paragraph visible at both widths; the strip shows after the 150ms debounce.
  await page.evaluate(() => {
    const p = [...document.querySelectorAll("article p")].find((el) => el.textContent.startsWith("Texts were written to be heard."));
    const text = p.firstChild;
    const phrase = "Scrolls had no spaces between words";
    const start = text.textContent.indexOf(phrase);
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + phrase.length);
    const selection = globalThis.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.waitForTimeout(400);
  await captureState(page, "selection");

  await page.evaluate(() => globalThis.getSelection().removeAllRanges());
  await page.waitForTimeout(400);
  await page.setViewportSize(byState.settings[0].viewport);
  const more = await moreButtonPoint(page);
  const closedHeight = await barHeight(page);
  await page.mouse.click(more.x, more.y);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const openHeight = await barHeight(page);
  if (!(closedHeight > 0 && openHeight > closedHeight)) {
    throw new Error(
      `The ⋯ click did not open the fold-out: bar height ${closedHeight}px before, ${openHeight}px after ` +
        `(click at ${more.x},${more.y}; keep moreButtonPoint in step with src/content/bar.mjs).`,
    );
  }
  console.log(`fold-out opened: bar ${closedHeight}px -> ${openHeight}px`);
  await captureState(page, "settings");
  await page.close();
}

// The one-time start-point tip above the row: clear the flag, start a session and capture well
// within the tip's 8 seconds. Starting the session sets the flag again.
async function barTip({ context, worker }, articleUrl) {
  const [{ viewport, file }] = barCaptures().filter((c) => c.state === "tip");
  await setTipShown(worker, false);
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(articleUrl);
  await clickAction(worker, articleUrl);
  await page.waitForFunction(() => globalThis.CSS?.highlights?.get("reader-current")?.size > 0, null, { timeout: 15000 });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const shown = await worker.evaluate(() => chrome.storage.local.get({ tipShown: false }));
  if (!shown.tipShown) throw new Error("The start-point tip did not show (tipShown flag not set).");
  await shoot(page, join(QA, file));
  await page.close();
}

// The other setup states the mockup shows: each card selected, the connected status after
// "Save and test" (omnivoice-server pointed at the fake engine) and "More settings" opened.
// Saves settings, so it runs after the unconfigured bar.
async function setupStates({ context, extensionId }, engineUrl) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options.html`);
  const card = (value) => page.locator(`label.card:has(input[value="${value}"])`);
  await card("other").click();
  await page.locator("#baseUrl").waitFor({ state: "visible" });
  await atWidths(page, "setup-other");
  await card("omnivoice").click();
  await page.locator("#quick-start").waitFor({ state: "visible" });
  await atWidths(page, "setup-omnivoice");
  await page.setViewportSize(SIZE);
  await page.locator("#baseUrl").fill(`${engineUrl}/v1`);
  await page.getByRole("button", { name: "Save and test" }).click();
  await page.locator("#status.ok").waitFor();
  await page.mouse.move(0, 0);
  await atWidths(page, "setup-success");
  await page.locator("#more summary").click();
  await page.locator("#speed").waitFor({ state: "visible" });
  await page.mouse.move(0, 0);
  await atWidths(page, "setup-more");
  await page.close();
}

// The rendered PNG icons at 16/48/128/300 on a light and a dark toolbar strip.
async function iconToolbars({ context }) {
  // Inlined as data URLs: a setContent page cannot load file:// images.
  const src = (file) => `data:image/png;base64,${readFileSync(join(root, file)).toString("base64")}`;
  const icon16 = src("icons/icon16.png");
  const sizes = [
    ["icons/icon16.png", 16],
    ["icons/icon48.png", 48],
    ["icons/icon128.png", 128],
    ["store/logo-300.png", 300],
  ];
  const strip = (theme) => `
    <section class="${theme}">
      <div class="toolbar"><span class="url"></span><span class="dummy"></span><span class="ours"><img src="${icon16}" width="16" height="16" alt=""></span><span class="dummy"></span></div>
      <div class="sizes">${sizes.map(([file, px]) => `<figure><img src="${src(file)}" width="${px}" height="${px}" alt=""><figcaption>${px}</figcaption></figure>`).join("")}</div>
    </section>`;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; font: 12px/1.3 system-ui, sans-serif; }
    section { padding: 16px 20px; }
    .light { background: #f3f3f3; color: #444; }
    .dark { background: #2b2b2b; color: #bbb; }
    .toolbar { display: flex; align-items: center; gap: 12px; height: 36px; padding: 0 12px; border-radius: 8px; max-width: 420px; }
    .light .toolbar { background: #f3f3f3; border: 1px solid #d9d9d9; }
    .dark .toolbar { background: #2b2b2b; border: 1px solid #3a3a3a; }
    .url { flex: 1; height: 22px; border-radius: 11px; }
    .light .url { background: #fff; border: 1px solid #ddd; }
    .dark .url { background: #3b3b3b; }
    .dummy { width: 16px; height: 16px; border-radius: 4px; }
    .light .dummy { background: #9a9a9a; }
    .dark .dummy { background: #8a8a8a; }
    .ours { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 4px; }
    .light .ours { outline: 1px dashed #b0b0b0; }
    .dark .ours { outline: 1px dashed #666; }
    .sizes { display: flex; align-items: flex-end; gap: 24px; margin-top: 16px; }
    figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
    img { display: block; }
  </style>${strip("light")}${strip("dark")}`;
  const page = await context.newPage();
  await page.setViewportSize({ width: 640, height: 400 });
  await page.setContent(html);
  await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
  await shoot(page, join(QA, "icon-toolbars.png"), { fullPage: true });
  await page.close();
}

export async function main() {
  build();
  mkdirSync(STORE, { recursive: true });
  mkdirSync(QA, { recursive: true });
  const engine = await startEngine({
    port: 0,
    // Long silent clips, so the highlighted sentence holds still for the screenshot.
    speechSeconds: 30,
    pages: { [ARTICLE]: readFileSync(join(root, "scripts", "fixtures", "article.html"), "utf8") },
  });
  const browser = await launch();
  try {
    // No tip in the store and bar captures; barTip() shows it on purpose.
    await setTipShown(browser.worker, true);
    const articleUrl = `${engine.url}${ARTICLE}`;
    await setupScreens(browser);
    await unconfiguredBar(browser, articleUrl);
    await setupStates(browser, engine.url);
    await reading(browser, articleUrl, engine.url);
    await barStates(browser, articleUrl);
    await barTip(browser, articleUrl);
    await iconToolbars(browser);
  } finally {
    await browser.close();
    await engine.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
