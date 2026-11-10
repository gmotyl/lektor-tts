// Store screenshots and visual-check captures, made in headless Chromium with the unpacked
// extension, the fake engine (scripts/fake-engine.mjs) and a local sample article. No GPU, no
// API key.
//
// Writes store/screenshot-setup.png, store/screenshot-unconfigured.png and
// store/screenshot-reading.png (1280×800 each), plus qa/visual/setup-390.png,
// qa/visual/setup-1280.png, qa/visual/icon-toolbars.png and the other setup states
// (setup-{other,omnivoice,success,more}-{1280,390}.png, bar-unconfigured-390.png) for the
// mockup comparison.
//
// The toolbar button cannot be clicked in headless Chromium, and chrome.action.onClicked
// cannot be fired from outside, so the script runs the same path in the service worker as the
// action listener: inject dist/content.js, then send "setup-prompt" (no engine set up) or
// "start" to the tab.
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

async function atWidths(page, name) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await shoot(page, join(QA, `${name}-${width}.png`), { fullPage: true });
  }
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
    const articleUrl = `${engine.url}${ARTICLE}`;
    await setupScreens(browser);
    await unconfiguredBar(browser, articleUrl);
    await setupStates(browser, engine.url);
    await reading(browser, articleUrl, engine.url);
    await iconToolbars(browser);
  } finally {
    await browser.close();
    await engine.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
