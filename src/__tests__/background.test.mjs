import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createBackground } from "../background.mjs";
import { createController } from "../content/main.mjs";
import { createBar } from "../content/bar.mjs";

function event() {
  const listeners = [];
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    fire: (...args) => listeners.map((fn) => fn(...args)),
  };
}

// Minimal fake of the chrome.* surface the service worker uses; records every outgoing call.
// `session` (a plain object) backs a fake chrome.storage.session shared across workers.
// Settings default to a configured engine preset; pass `stored: { preset: "" }` for a fresh install.
function fakeChrome({ stored = {}, session } = {}) {
  const calls = { tabMessages: [], runtimeMessages: [], injected: [], menus: [], optionsOpened: 0 };
  // No offscreen API and no runtime.getContexts: calling either would throw.
  const chrome = {
    calls,
    runtime: {
      onInstalled: event(),
      onMessage: event(),
      sendMessage: async (msg) => {
        calls.runtimeMessages.push(msg);
      },
      getURL: (p) => `chrome-extension://id/${p}`,
      openOptionsPage: async () => {
        calls.optionsOpened++;
      },
    },
    action: { onClicked: event() },
    commands: { onCommand: event() },
    contextMenus: {
      onClicked: event(),
      create: (props) => calls.menus.push(props),
      removeAll: (cb) => {
        calls.menus.length = 0;
        cb?.();
      },
    },
    scripting: {
      executeScript: async (opts) => {
        calls.injected.push(opts);
      },
    },
    tabs: {
      onRemoved: event(),
      onUpdated: event(),
      sendMessage: async (tabId, msg) => {
        calls.tabMessages.push({ tabId, msg });
      },
    },
    storage: { sync: { get: async (defaults) => ({ ...defaults, preset: "omnivoice", ...stored }) } },
  };
  if (session) {
    chrome.storage.session = {
      get: async (key) => (key in session ? { [key]: structuredClone(session[key]) } : {}),
      set: async (items) => {
        for (const [k, v] of Object.entries(items)) session[k] = structuredClone(v);
      },
    };
  }
  return chrome;
}

const tick = () => new Promise((r) => setTimeout(r, 20));

// Delivers a runtime message as if it came from a content script in `tabId` (or an extension page).
function deliver(chrome, msg, tabId) {
  const sender = tabId === undefined ? { url: "chrome-extension://id/src/options.html" } : { tab: { id: tabId } };
  let response;
  const results = chrome.runtime.onMessage.fire(msg, sender, (r) => {
    response = r;
  });
  return { results, response: () => response };
}

const stopsTo = (chrome, tabId) =>
  chrome.calls.tabMessages.filter((m) => m.tabId === tabId && m.msg.type === "stop").length;

test("creates both context menus on install", async () => {
  const chrome = fakeChrome();
  createBackground(chrome);
  chrome.runtime.onInstalled.fire({ reason: "install" });
  await tick();
  const byTitle = Object.fromEntries(chrome.calls.menus.map((m) => [m.title, m]));
  assert.deepEqual(byTitle["Read selection"].contexts, ["selection"]);
  assert.deepEqual([...byTitle["Read from here"].contexts].sort(), ["image", "link", "page"]);
});

test("fresh install opens the options page", async () => {
  const chrome = fakeChrome();
  createBackground(chrome);
  chrome.runtime.onInstalled.fire({ reason: "install" });
  await tick();
  assert.equal(chrome.calls.optionsOpened, 1);
  assert.deepEqual(chrome.calls.menus.map((m) => m.id).sort(), ["read-from-here", "read-selection"]);
});

test("update does not open the options page", async () => {
  for (const reason of ["update", "chrome_update"]) {
    const chrome = fakeChrome();
    createBackground(chrome);
    chrome.runtime.onInstalled.fire({ reason });
    await tick();
    assert.equal(chrome.calls.optionsOpened, 0, reason);
    assert.equal(chrome.calls.menus.length, 2, reason);
  }
});

test("action click injects content and sends start", async () => {
  const chrome = fakeChrome();
  createBackground(chrome);
  chrome.action.onClicked.fire({ id: 7 });
  await tick();
  assert.deepEqual(chrome.calls.injected, [{ target: { tabId: 7 }, files: ["dist/content.js"] }]);
  assert.deepEqual(chrome.calls.tabMessages, [{ tabId: 7, msg: { type: "start", source: "auto" } }]);

  // Menu items inject too and carry their source; from-here carries the clicked link/image.
  chrome.contextMenus.onClicked.fire({ menuItemId: "read-selection" }, { id: 7 });
  await tick();
  chrome.contextMenus.onClicked.fire(
    { menuItemId: "read-from-here", linkUrl: "https://a.example/x", srcUrl: "https://a.example/i.png" },
    { id: 8 },
  );
  await tick();
  assert.equal(chrome.calls.injected.length, 3);
  assert.deepEqual(chrome.calls.tabMessages.slice(1), [
    { tabId: 7, msg: { type: "start", source: "selection" } },
    // Tab 8 takes over the session from tab 7.
    { tabId: 7, msg: { type: "stop" } },
    {
      tabId: 8,
      msg: { type: "start", source: "from-here", linkUrl: "https://a.example/x", srcUrl: "https://a.example/i.png" },
    },
  ]);
});

test("shortcut toggles an existing session", async () => {
  const chrome = fakeChrome();
  createBackground(chrome);
  // No session anywhere yet: the shortcut starts one, and that tab now owns the session.
  chrome.commands.onCommand.fire("toggle-reading", { id: 3 });
  await tick();
  assert.deepEqual(chrome.calls.tabMessages, [{ tabId: 3, msg: { type: "start", source: "auto" } }]);
  chrome.calls.tabMessages.length = 0;
  chrome.calls.injected.length = 0;

  chrome.commands.onCommand.fire("toggle-reading", { id: 3 });
  await tick();
  assert.deepEqual(chrome.calls.tabMessages, [{ tabId: 3, msg: { type: "toggle" } }]);
  assert.equal(chrome.calls.injected.length, 0);

  // Another tab is not the owner: the shortcut starts there.
  chrome.commands.onCommand.fire("toggle-reading", { id: 4 });
  await tick();
  assert.deepEqual(chrome.calls.tabMessages.at(-1), { tabId: 4, msg: { type: "start", source: "auto" } });
});

test("starting in another tab stops the previous owner tab", async () => {
  const chrome = fakeChrome();
  createBackground(chrome);
  chrome.action.onClicked.fire({ id: 1 });
  await tick();
  chrome.calls.tabMessages.length = 0;

  // Every way of starting takes ownership: tab 1 is stopped before tab 2 starts.
  chrome.contextMenus.onClicked.fire({ menuItemId: "read-selection" }, { id: 2 });
  await tick();
  assert.deepEqual(
    chrome.calls.tabMessages.map(({ tabId, msg }) => `tab${tabId}:${msg.type}`),
    ["tab1:stop", "tab2:start"],
  );

  chrome.commands.onCommand.fire("toggle-reading", { id: 3 });
  await tick();
  assert.equal(stopsTo(chrome, 2), 1);

  // Restarting in the owner tab itself sends it no stop.
  chrome.action.onClicked.fire({ id: 3 });
  await tick();
  assert.equal(stopsTo(chrome, 3), 0);
  assert.equal(chrome.calls.runtimeMessages.length, 0, "nothing goes to an offscreen document");
});

test("owner tab close clears ownership", async () => {
  const chrome = fakeChrome();
  createBackground(chrome);
  chrome.action.onClicked.fire({ id: 4 });
  await tick();

  // Another tab, or a non-loading update, changes nothing.
  chrome.tabs.onRemoved.fire(5, {});
  chrome.tabs.onUpdated.fire(4, { title: "x" });
  await tick();
  chrome.commands.onCommand.fire("toggle-reading", { id: 4 });
  await tick();
  assert.deepEqual(chrome.calls.tabMessages.at(-1), { tabId: 4, msg: { type: "toggle" } });

  chrome.tabs.onRemoved.fire(4, {});
  await tick();
  // No owner left: starting elsewhere stops nobody, and the shortcut on tab 4 starts afresh.
  chrome.action.onClicked.fire({ id: 6 });
  await tick();
  assert.equal(stopsTo(chrome, 4), 0);
  chrome.commands.onCommand.fire("toggle-reading", { id: 4 });
  await tick();
  assert.deepEqual(chrome.calls.tabMessages.at(-1), { tabId: 4, msg: { type: "start", source: "auto" } });
  assert.equal(chrome.calls.runtimeMessages.length, 0, "nothing goes to an offscreen document");
});

test("owner tab navigation clears ownership", async () => {
  const chrome = fakeChrome();
  createBackground(chrome);
  chrome.action.onClicked.fire({ id: 4 });
  await tick();
  chrome.tabs.onUpdated.fire(5, { status: "loading" });
  chrome.tabs.onUpdated.fire(4, { status: "loading" });
  await tick();
  chrome.commands.onCommand.fire("toggle-reading", { id: 4 });
  await tick();
  assert.deepEqual(chrome.calls.tabMessages.at(-1), { tabId: 4, msg: { type: "start", source: "auto" } });
});

test("in-page navigation in the owner tab stops its session", async () => {
  const chrome = fakeChrome();
  createBackground(chrome);
  chrome.action.onClicked.fire({ id: 4 });
  await tick();
  // A non-owner tab loading is not told anything.
  chrome.tabs.onUpdated.fire(5, { status: "loading" });
  await tick();
  assert.equal(stopsTo(chrome, 5), 0);

  // pushState / hash change on an SPA: the page (and its session) survive, so it is stopped.
  // On a real navigation nothing receives the stop; that failure is ignored.
  chrome.tabs.sendMessage = async (tabId, msg) => {
    chrome.calls.tabMessages.push({ tabId, msg });
    throw new Error("Could not establish connection. Receiving end does not exist.");
  };
  chrome.tabs.onUpdated.fire(4, { status: "loading" });
  await tick();
  assert.equal(stopsTo(chrome, 4), 1);

  // Ownership is gone: a start elsewhere stops nobody, the shortcut on tab 4 starts afresh.
  chrome.action.onClicked.fire({ id: 6 });
  await tick();
  assert.equal(stopsTo(chrome, 4), 1);
  chrome.commands.onCommand.fire("toggle-reading", { id: 4 });
  await tick();
  assert.deepEqual(chrome.calls.tabMessages.at(-1), { tabId: 4, msg: { type: "start", source: "auto" } });
});

test("a stale start does not show the setup prompt", async () => {
  const chrome = fakeChrome();
  // The first start's settings load is slow and finds no engine; the second is configured.
  let release;
  const loads = [
    () => new Promise((r) => (release = r)),
    async () => ({ preset: "omnivoice" }),
  ];
  createBackground(chrome, { loadSettings: () => loads.shift()() });
  chrome.action.onClicked.fire({ id: 1 });
  await tick();
  chrome.action.onClicked.fire({ id: 2 });
  await tick();
  release({ preset: "" });
  await tick();
  assert.deepEqual(chrome.calls.tabMessages, [{ tabId: 2, msg: { type: "start", source: "auto" } }]);
});

test("closing the bar in the owner tab ends its ownership", async () => {
  const chrome = fakeChrome();
  createBackground(chrome);
  chrome.action.onClicked.fire({ id: 4 });
  await tick();
  // A non-owner's session-end changes nothing.
  deliver(chrome, { type: "session-end" }, 5);
  await tick();
  chrome.commands.onCommand.fire("toggle-reading", { id: 4 });
  await tick();
  assert.deepEqual(chrome.calls.tabMessages.at(-1), { tabId: 4, msg: { type: "toggle" } });

  deliver(chrome, { type: "session-end" }, 4);
  await tick();
  chrome.commands.onCommand.fire("toggle-reading", { id: 4 });
  await tick();
  assert.deepEqual(chrome.calls.tabMessages.at(-1), { tabId: 4, msg: { type: "start", source: "auto" } });
});

test("a restarted worker still knows the owner tab", async () => {
  const session = {};
  const first = fakeChrome({ session });
  createBackground(first);
  first.action.onClicked.fire({ id: 1 });
  await tick();

  const second = fakeChrome({ session });
  createBackground(second);
  second.action.onClicked.fire({ id: 2 });
  await tick();
  assert.equal(stopsTo(second, 1), 1);
});

test("of two starts racing, the newest wins", async () => {
  const chrome = fakeChrome();
  createBackground(chrome);
  chrome.action.onClicked.fire({ id: 1 });
  chrome.action.onClicked.fire({ id: 2 });
  await tick();
  assert.deepEqual(chrome.calls.tabMessages, [{ tabId: 2, msg: { type: "start", source: "auto" } }]);
});

test("a tab that cannot be scripted does not take ownership", async () => {
  const chrome = fakeChrome();
  createBackground(chrome);
  chrome.action.onClicked.fire({ id: 1 });
  await tick();
  chrome.scripting.executeScript = async () => {
    throw new Error("Cannot access a chrome:// URL");
  };
  chrome.action.onClicked.fire({ id: 2 });
  await tick();
  assert.equal(stopsTo(chrome, 1), 0);
});

test("list-voices answers from the engine with the stored settings", async () => {
  const chrome = fakeChrome({ stored: { baseUrl: "http://localhost:9000/v1" } });
  const asked = [];
  createBackground(chrome, {
    listVoices: async (settings) => {
      asked.push(settings.baseUrl);
      return { ok: true, voices: ["a"] };
    },
  });
  const { results, response } = deliver(chrome, { type: "list-voices" }, 1);
  assert.deepEqual(results, [true], "channel kept open");
  await tick();
  assert.deepEqual(response(), { ok: true, voices: ["a"] });
  assert.deepEqual(asked, ["http://localhost:9000/v1"]);
});

test("unconfigured start shows the setup prompt without calling the engine", async () => {
  const chrome = fakeChrome({ stored: { preset: "" } });
  const fetched = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    throw new Error("no engine call expected");
  };
  try {
    createBackground(chrome);
    // One at a time: of concurrent starts only the newest would show the prompt.
    chrome.action.onClicked.fire({ id: 7 });
    await tick();
    chrome.commands.onCommand.fire("toggle-reading", { id: 8 });
    await tick();
    chrome.contextMenus.onClicked.fire({ menuItemId: "read-selection" }, { id: 9 });
    await tick();
    chrome.contextMenus.onClicked.fire({ menuItemId: "read-from-here", linkUrl: "https://a.example/x" }, { id: 10 });
    await tick();
  } finally {
    globalThis.fetch = realFetch;
  }
  // Every trigger injects the content script and asks it for the setup prompt, not a start.
  assert.deepEqual(
    chrome.calls.injected.map((o) => o.target.tabId).sort((a, b) => a - b),
    [7, 8, 9, 10],
  );
  assert.deepEqual(
    chrome.calls.tabMessages.map(({ tabId, msg }) => [tabId, msg.type]).sort((a, b) => a[0] - b[0]),
    [
      [7, "setup-prompt"],
      [8, "setup-prompt"],
      [9, "setup-prompt"],
      [10, "setup-prompt"],
    ],
  );
  assert.equal(chrome.calls.runtimeMessages.length, 0);
  assert.deepEqual(fetched, []);
});

test("setup button opens the options page", async () => {
  const chrome = fakeChrome({ stored: { preset: "" } });
  createBackground(chrome);

  // A page with the content controller and the real bar; its closed shadow root is captured
  // by wrapping attachShadow, as in bar.test.mjs.
  const { document, window } = parseHTML("<!doctype html><html><head></head><body><p>Page</p></body></html>");
  const roots = [];
  const realCreate = document.createElement.bind(document);
  document.createElement = (name, ...rest) => {
    const el = realCreate(name, ...rest);
    const attach = el.attachShadow;
    el.attachShadow = function (init) {
      const root = attach.call(this, init);
      roots.push(root);
      return root;
    };
    return el;
  };
  const TAB = 5;
  const tabListeners = [];
  const contentChrome = {
    runtime: {
      // Content-script messages reach the worker with sender.tab set.
      sendMessage: async (msg) => {
        deliver(chrome, msg, TAB);
      },
      onMessage: { addListener: (fn) => tabListeners.push(fn) },
    },
    storage: { sync: { get: async (defaults) => ({ ...defaults }) } },
  };
  createController({ doc: document, win: window, chrome: contentChrome, createBar, listVoices: null });
  // The worker's messages to the tab reach the controller.
  chrome.tabs.sendMessage = async (tabId, msg) => {
    chrome.calls.tabMessages.push({ tabId, msg });
    if (tabId === TAB) for (const fn of tabListeners) fn(msg, {});
  };

  chrome.action.onClicked.fire({ id: TAB });
  await tick();
  assert.equal(roots.length, 1, "setup prompt bar shown");
  const button = [...roots[0].querySelectorAll("button")].find((b) => b.textContent.trim() === "Set up a speech engine");
  assert.ok(button, "setup button");
  button.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(chrome.calls.optionsOpened, 1);
});
