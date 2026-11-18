// Service worker: triggers (action, shortcut, context menus), on-demand content injection,
// single-session ownership, and the few requests content scripts cannot serve themselves.
//
// Audio runs in the player frame the content script hosts; the worker never sees engine
// commands. It only knows which tab owns the session: the tab it last started reading in.
import { listVoices as engineListVoices } from "./engine.mjs";
import { isConfigured, loadSettings as loadStoredSettings } from "./settings.mjs";

export const CONTENT_FILE = "dist/content.js";
export const MENU_SELECTION = "read-selection";
export const MENU_FROM_HERE = "read-from-here";

const OWNER_KEY = "ownerTabId";

// A value kept in memory and mirrored to chrome.storage.session (survives a worker restart).
// get() loads it once (undefined = not loaded yet, null = none); set() updates both.
function sessionSlot(store, key) {
  let value;
  let loading = null;
  return {
    get() {
      if (value !== undefined) return Promise.resolve(value);
      loading ??= Promise.resolve()
        .then(() => store?.get?.(key))
        .catch(() => undefined)
        .then((got) => {
          if (value === undefined) value = got?.[key] ?? null;
          return value;
        });
      return loading;
    },
    set(next) {
      value = next;
      try {
        Promise.resolve(store?.set?.({ [key]: next })).catch(() => {});
      } catch {
        // storage.session unavailable: in-memory only
      }
    },
  };
}

// deps: {listVoices, loadSettings} — injectable for tests.
export function createBackground(chrome, deps = {}) {
  const listVoices = deps.listVoices ?? engineListVoices;
  const loadSettings = deps.loadSettings ?? (() => loadStoredSettings(chrome.storage?.sync));

  // The worker can be suspended mid-session; the owner is mirrored to storage.session so a
  // restarted worker still stops the right tab.
  const ownerSlot = sessionSlot(chrome.storage?.session, OWNER_KEY);
  const getOwner = () => ownerSlot.get();
  const setOwner = (tabId) => ownerSlot.set(tabId);
  async function clearOwnerIf(tabId) {
    if ((await getOwner()) === tabId) setOwner(null);
  }

  const ignore = () => {};
  const toTab = (tabId, msg) => {
    try {
      return Promise.resolve(chrome.tabs.sendMessage(tabId, msg)).catch(ignore);
    } catch {
      return Promise.resolve();
    }
  };

  // Bumped by every start that injected: a slower earlier start (settings load, stopping the
  // previous owner) must not take ownership or send `start` after a newer one; the newest
  // successful start wins. A start that cannot inject never bumps it, so it cannot cancel a
  // pending one.
  let startGeneration = 0;
  // The generation that last claimed ownership.
  let ownerGeneration = 0;

  async function startIn(tabId, start) {
    if (tabId === undefined || tabId === null) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_FILE] });
    } catch {
      // Restricted pages (chrome://, the web store) cannot be scripted; nothing to read there.
      return;
    }
    const generation = ++startGeneration;
    const stale = () => generation !== startGeneration;
    // No engine set up yet: the bar shows the setup prompt instead of starting a session.
    let settings = null;
    try {
      settings = await loadSettings();
    } catch {
      // Unreadable settings: start as before, the player frame reports any error.
    }
    if (stale()) return;
    if (settings && !isConfigured(settings)) return void (await toTab(tabId, { type: "setup-prompt" }));
    // One session at a time: the previous owner tab stops before this one starts.
    const previous = await getOwner();
    if (stale()) return;
    setOwner(tabId);
    ownerGeneration = generation;
    if (previous !== null && previous !== tabId) await toTab(previous, { type: "stop" });
    // A newer start may have taken over while the previous owner was stopping. If it has not
    // claimed ownership yet (e.g. it bailed with the setup prompt), this tab never gets `start`
    // and must not stay the owner.
    if (stale()) {
      if (ownerGeneration === generation) setOwner(null);
      return;
    }
    await toTab(tabId, { type: "start", ...start });
  }

  chrome.runtime.onInstalled.addListener((details) => {
    // First run: open the setup screen. Updates keep the user's existing setup.
    if (details?.reason === "install") {
      Promise.resolve()
        .then(() => chrome.runtime.openOptionsPage())
        .catch(ignore);
    }
    const create = () => {
      chrome.contextMenus.create({ id: MENU_SELECTION, title: "Read selection", contexts: ["selection"] });
      chrome.contextMenus.create({ id: MENU_FROM_HERE, title: "Read from here", contexts: ["page", "link", "image"] });
    };
    // removeAll first: updates and reloads would otherwise hit duplicate ids.
    if (chrome.contextMenus.removeAll) chrome.contextMenus.removeAll(create);
    else create();
  });

  chrome.action.onClicked.addListener((tab) => {
    void startIn(tab?.id, { source: "auto" });
  });

  chrome.commands.onCommand.addListener(async (command, tab) => {
    if (command !== "toggle-reading" || tab?.id === undefined) return;
    if ((await getOwner()) === tab.id) await toTab(tab.id, { type: "toggle" });
    else await startIn(tab.id, { source: "auto" });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_SELECTION) return void startIn(tab?.id, { source: "selection" });
    if (info.menuItemId !== MENU_FROM_HERE) return;
    // OnClickData has no coordinates; the content script resolves the clicked link/image itself.
    const start = { source: "from-here" };
    if (info.linkUrl) start.linkUrl = info.linkUrl;
    if (info.srcUrl) start.srcUrl = info.srcUrl;
    void startIn(tab?.id, start);
  });

  // The owner tab closing takes its session (and player frame) with it.
  chrome.tabs.onRemoved.addListener((tabId) => clearOwnerIf(tabId));

  // Does the tab's content script still hold a live session? No receiver (a cross-document
  // navigation destroyed the content script) counts as no.
  async function hasLiveSession(tabId) {
    try {
      const answer = await chrome.tabs.sendMessage(tabId, { type: "ping" });
      return answer?.alive === true;
    } catch {
      return false;
    }
  }

  // `loading` fires for real navigations but also for same-document URL changes
  // (history.replaceState/pushState, hash): the tab is asked whether its session survived.
  // A real navigation needs no stop: the document, content script and player frame die with it.
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo?.status !== "loading" || (await getOwner()) !== tabId) return;
    const generation = startGeneration;
    if (await hasLiveSession(tabId)) return;
    // A start during the ping (in this tab) owns a fresh session: leave it alone.
    if (generation !== startGeneration) return;
    await clearOwnerIf(tabId);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string") return false;
    // Only content scripts (sender.tab set) talk to the worker.
    const tabId = sender?.tab?.id;
    if (tabId === undefined) return false;
    switch (msg.type) {
      case "list-voices":
        Promise.resolve()
          .then(() => loadSettings())
          .then((settings) => listVoices(settings))
          .then(sendResponse, (err) => sendResponse({ ok: false, error: err?.message || String(err) }));
        return true; // keeps the channel open for the async answer
      case "open-options":
        Promise.resolve()
          .then(() => chrome.runtime.openOptionsPage())
          .catch(ignore);
        return false;
      case "session-end":
        // The user closed the bar: the shortcut on that tab starts afresh instead of toggling.
        void clearOwnerIf(tabId);
        return false;
      default:
        return false;
    }
  });
}

// Real service worker: listeners must be registered synchronously at top level.
if (typeof ServiceWorkerGlobalScope !== "undefined" && globalThis.chrome?.runtime?.id) {
  createBackground(globalThis.chrome);
}
