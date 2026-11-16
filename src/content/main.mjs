// Content script entry, bundled to dist/content.js and injected on demand by the service worker.
// Owns the reading session in the page: picks the source (article, selection, from-here),
// hosts the player frame (the extension-origin audio iframe) in the bar's shadow root, sends it
// `play` with the sentences' pieces over the frame's Port, follows its `sentence-start` /
// `state` / `error` events, and maps player-bar actions and Alt+click to engine commands.

import { articleSource, paneContainer, pointSource, selectionSentences, sentenceIndexAt } from './source.mjs';
import * as nav from './nav.mjs';
import { createHighlighter } from './highlight.mjs';
import { createBar } from './bar.mjs';
import { DEFAULTS, saveSettings } from '../settings.mjs';

// One controller per page, shared by every injection of the bundle.
export const CONTROLLER_KEY = Symbol.for('omnivoice-reader.controller');

const SETTINGS_DEFAULTS = { voice: DEFAULTS.voice, speed: DEFAULTS.speed, autoscroll: DEFAULTS.autoscroll };
const PLAYING = new Set(['playing', 'loading']);

// Player frame: opens a Port with this name to its tab; hidden, but still allowed to play audio.
const PLAYER_PORT = 'player';
const PLAYER_PAGE = 'src/player.html';
const FRAME_STYLE = 'width:1px;height:1px;opacity:0;border:0;position:fixed;pointer-events:none';
const FRAME_LOST = 'Audio player stopped';

function pageLang(doc, win) {
  return doc.documentElement.getAttribute('lang') || win.navigator?.language || undefined;
}

// Tags whose `src` the context menu reports as OnClickData.srcUrl.
const SRC_SELECTOR = 'img, video, audio, source, iframe, embed';

// deps: {doc, win, chrome, createBar, createHighlighter, listVoices}
// listVoices: async () => {ok, voices: string[] | null}, asked once per session to pick the
// first listed voice when none is stored. The default asks the service worker (`list-voices`):
// a content-script fetch would run with the page's origin (CORS, Local Network Access).
// Pass null to never ask.
export function createController({
  doc = globalThis.document,
  win = globalThis.window,
  chrome = globalThis.chrome,
  createBar: makeBar = createBar,
  createHighlighter: makeHighlighter = createHighlighter,
  listVoices,
} = {}) {
  let session = null;
  // Voice listing of the current session (shared by restarts inside it); reset on teardown.
  let voicesAsked = null;
  // Bumped by every start and every teardown: a start that resumes after a stop or a newer start
  // is superseded and returns without side effects (no stop, no bar change).
  let startToken = 0;
  // Setup-prompt bar shown while no engine is configured (no session behind it), or null.
  let setupBar = null;

  if (listVoices === undefined) {
    listVoices = () => Promise.resolve(chrome.runtime.sendMessage({ type: 'list-voices' }));
  }

  // Messages for the service worker (open-options); engine commands go to the frame instead.
  const toWorker = (msg) => {
    try {
      return Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  };

  // Engine command for the session's player frame. Until the frame connects, a `play` (and what
  // follows it) waits; commands with no play to follow them are dropped.
  const send = (msg) => {
    const s = session;
    if (!s) return Promise.resolve();
    if (s.port) {
      try {
        s.port.postMessage(msg);
      } catch {
        // Port already closed: its onDisconnect handles the lost frame.
      }
    } else if (msg.type === 'play') {
      s.pending = [msg];
    } else if (s.pending.length) {
      s.pending.push(msg);
    }
    return Promise.resolve();
  };

  function injectFrame(s) {
    const frame = doc.createElement('iframe');
    frame.setAttribute('src', chrome.runtime.getURL(PLAYER_PAGE));
    frame.setAttribute('allow', 'autoplay');
    frame.setAttribute('style', FRAME_STYLE);
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    s.frame = frame;
    s.port = null;
    s.bar.mount(frame);
  }

  function dropFrame(s) {
    const port = s.port;
    s.port = null;
    s.pending = [];
    try {
      port?.disconnect();
    } catch {
      // already closed
    }
    s.frame?.remove();
    s.frame = null;
  }

  // The frame's Port closed while the session still holds it (the page removed the iframe,
  // the frame crashed). Playing: re-inject once and replay from the current sentence.
  function frameLost(s) {
    dropFrame(s);
    if (!PLAYING.has(s.state)) return; // paused / ended: the next play injects a new frame
    if (!s.reinjected) {
      s.reinjected = true;
      play(s.current);
      return;
    }
    s.state = 'error';
    s.bar.setState('error', FRAME_LOST);
  }

  function onFrameEvent(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'sentence-start') handle(msg);
    else if (msg.type === 'error') handle({ type: 'state', state: 'error', error: msg.message });
    else if (msg.type === 'state') handle({ type: 'state', state: msg.state === 'ended' ? 'idle' : msg.state });
  }

  function onConnect(port) {
    if (port?.name !== PLAYER_PORT) return;
    const s = session;
    // Only the frame this session injected and is waiting for.
    if (!s || !s.frame || s.port) {
      try {
        port.disconnect();
      } catch {
        // already closed
      }
      return;
    }
    s.port = port;
    const mine = () => session === s && s.port === port;
    port.onMessage.addListener((msg) => {
      if (mine()) onFrameEvent(msg);
    });
    port.onDisconnect.addListener(() => {
      if (mine()) frameLost(s);
    });
    const queued = s.pending;
    s.pending = [];
    for (const msg of queued) send(msg);
  }

  async function loadSettings() {
    try {
      const got = await chrome.storage?.sync?.get(SETTINGS_DEFAULTS);
      const merged = { ...SETTINGS_DEFAULTS, ...(got || {}) };
      return { ...merged, autoscroll: merged.autoscroll !== false };
    } catch {
      return { ...SETTINGS_DEFAULTS };
    }
  }

  async function askVoices() {
    if (!listVoices) return null;
    try {
      const res = await listVoices();
      return res && res.ok && Array.isArray(res.voices) ? res.voices : null;
    } catch {
      return null; // null = not known or the engine cannot list voices
    }
  }

  async function resolveVoice(stored) {
    voicesAsked ??= askVoices();
    const list = await voicesAsked;
    return { list, voice: stored || (list && list[0]) || '' };
  }

  // Context-menu "Read from here": OnClickData has no coordinates, only the clicked
  // link/image URL. Without one, the innermost hovered element is where the menu opened.
  function fromHereCandidates(msg) {
    const out = [];
    const matches = (el, attr, want) => {
      const raw = el.getAttribute(attr);
      if (!raw) return false;
      if (raw === want) return true;
      try {
        return new URL(raw, doc.baseURI || win.location?.href).href === want;
      } catch {
        return false;
      }
    };
    if (msg.linkUrl) {
      for (const a of doc.querySelectorAll('a[href]')) if (matches(a, 'href', msg.linkUrl)) out.push(a);
    }
    if (msg.srcUrl) {
      for (const el of doc.querySelectorAll(SRC_SELECTOR)) if (matches(el, 'src', msg.srcUrl)) out.push(el);
    }
    try {
      const hovered = doc.querySelectorAll(':hover');
      if (hovered.length) out.push(hovered[hovered.length - 1]);
    } catch {
      // :hover unsupported by this DOM
    }
    return out;
  }

  // picked: a pointSource result already computed for msg (Alt+click), reused as is.
  function pickSentences(msg, picked) {
    const lang = pageLang(doc, win);
    const selection = win.getSelection?.();
    const hasSelection = !!(selection && selection.rangeCount && !selection.isCollapsed);
    if (msg.source === 'selection' || (msg.source === 'auto' && hasSelection)) {
      return { sentences: selectionSentences(doc, selection, lang), start: 0, container: null };
    }
    if (msg.source === 'from-here') {
      // A start at a point reads the article, or on app pages only the pane around the point.
      const targets = msg.target ? [msg.target] : fromHereCandidates(msg);
      const point = picked ?? pointSource(doc, targets, lang, { getComputedStyle: paneStyle });
      return { ...point, start: Math.max(0, point.start) };
    }
    return { ...articleSource(doc, lang), start: 0 };
  }

  const paneStyle = (el) => win.getComputedStyle?.(el) ?? null;

  // True when the target's pane lies strictly inside the current source's container.
  function narrowerPane(container, target) {
    if (!container) return false;
    const pane = paneContainer(target, { getComputedStyle: paneStyle });
    return !!pane && pane !== doc.body && pane !== container && container.contains(pane);
  }

  function play(start) {
    const s = session;
    s.current = start;
    s.state = 'loading';
    s.bar.setState('loading');
    if (!s.frame) injectFrame(s);
    return send({
      type: 'play',
      sentences: s.sentences.map((x) => x.pieces),
      start,
      voice: s.voice,
      speed: s.speed,
      // Media Session title on the lock screen.
      title: doc.title || '',
    });
  }

  function seek(index) {
    if (!session) return undefined;
    // After the last sentence ended, an error, or a lost frame there is nothing to seek in.
    if (session.state === 'idle' || session.state === 'error' || !session.frame) return play(index);
    session.current = index;
    return send({ type: 'seek', index });
  }

  function teardown() {
    startToken++;
    voicesAsked = null;
    if (!session) return;
    const s = session;
    // Stop first, then remove the frame (and its audio) with the bar.
    send({ type: 'stop' });
    session = null;
    dropFrame(s);
    doc.removeEventListener('click', s.onClick, true);
    s.highlighter.clear();
    s.bar.destroy();
  }

  function stop() {
    if (!session) return;
    teardown();
  }

  function toggle() {
    if (!session) return undefined;
    if (PLAYING.has(session.state)) {
      session.state = 'paused';
      session.bar.setState('paused');
      return send({ type: 'pause' });
    }
    // A frame lost while paused: resume in a new one.
    if (session.state === 'paused' && !session.frame) return play(session.current);
    if (session.state === 'paused') {
      session.state = 'playing';
      session.bar.setState('playing');
      return send({ type: 'resume' });
    }
    return play(session.current);
  }

  function onAction(type, payload) {
    if (!session) return undefined;
    const { sentences, current } = session;
    switch (type) {
      case 'toggle':
        return toggle();
      case 'next': {
        const i = nav.next(sentences, current);
        return i === null ? stop() : seek(i);
      }
      case 'prev':
        return seek(nav.prev(sentences, current));
      case 'next-paragraph': {
        const i = nav.nextParagraph(sentences, current);
        return i === null ? stop() : seek(i);
      }
      case 'prev-paragraph':
        return seek(nav.prevParagraph(sentences, current));
      case 'speed':
        session.speed = payload;
        return send({ type: 'set-speed', speed: payload });
      case 'speed-cycle':
        // A chip preset is a deliberate pick: remembered as the default speed, unlike the slider.
        session.speed = payload;
        saveSetting({ speed: payload });
        return send({ type: 'set-speed', speed: payload });
      case 'voice':
        session.voice = payload;
        // Remembered for the next session and the options page.
        saveSetting({ voice: payload });
        return send({ type: 'set-voice', voice: payload });
      case 'autoscroll': {
        session.autoscroll = payload !== false;
        // Turned back on: bring the sentence being read into view now, not at the next one.
        if (session.autoscroll && session.shown != null && sentences[session.shown]) {
          session.highlighter.show(sentences[session.shown], { scroll: true });
        }
        return saveSetting({ autoscroll: session.autoscroll });
      }
      case 'retry':
        // A retry is the user's call: the frame may be re-injected once again.
        session.reinjected = false;
        // "Nothing to read" has no sentences to replay: pick them again (the page may have rendered since).
        return sentences.length ? play(current) : start(session.startMsg);
      case 'options':
        // Content scripts cannot call chrome.runtime.openOptionsPage; the service worker does.
        return toWorker({ type: 'open-options' });
      case 'close':
        return stop();
      default:
        return undefined;
    }
  }

  // Bar choices that are stored preferences (shared with the options page): voice, autoscroll,
  // and the speed picked with the chip.
  async function saveSetting(patch) {
    try {
      if (chrome.storage?.sync?.set) await saveSettings(chrome.storage.sync, patch);
    } catch {
      // storage unavailable (e.g. extension reloaded): the choice still applies to this session
    }
  }

  function createSession(voice, speed) {
    const s = {
      sentences: [],
      current: 0,
      state: 'idle',
      voice,
      speed,
      autoscroll: true,
      // Index of the highlighted sentence, or null.
      shown: null,
      // Root the sentences were read from (article, pane), or null for a selection.
      container: null,
      highlighter: makeHighlighter({ doc, win }),
      bar: null,
      onClick: null,
      // Player frame (iframe in the bar's shadow root), its Port once connected, the commands
      // waiting for that Port, and whether the frame was already re-injected after a loss.
      frame: null,
      port: null,
      pending: [],
      reinjected: false,
    };
    s.bar = makeBar({ doc, onAction });
    // Capture phase, so the page's own click handlers (links) do not run first.
    s.onClick = (e) => {
      if (!e.altKey || session !== s) return;
      const target = e.target;
      // The player bar's host sits in the page: its clicks are the bar's own.
      if (!target || target.closest?.('[data-omnivoice-reader]')) return;
      const readFrom = (picked) => {
        e.preventDefault();
        e.stopPropagation?.();
        start({ type: 'start', source: 'from-here', target }, picked);
      };
      const pick = () => pointSource(doc, [target], pageLang(doc, win), { getComputedStyle: paneStyle });
      const i = sentenceIndexAt(s.sentences, target);
      if (i >= 0) {
        // A whole-page source (toolbar start on Slack or Gmail) spans every pane: narrow it to
        // the clicked pane instead of seeking, or reading runs on into the sidebar. The pane
        // check needs no Readability, so an article page keeps the cheap seek.
        if (narrowerPane(s.container, target)) {
          const picked = pick();
          const c = picked.container;
          if (picked.start >= 0 && c && c !== s.container && s.container.contains(c)) return readFrom(picked);
        }
        e.preventDefault();
        e.stopPropagation?.();
        seek(i);
        return;
      }
      // Outside the current source (another pane of an app page): read from there instead.
      if (s.container && s.container.contains(target)) return;
      const picked = pick();
      if (picked.start < 0) return;
      readFrom(picked);
    };
    doc.addEventListener('click', s.onClick, true);
    return s;
  }

  function closeSetupPrompt() {
    setupBar?.destroy();
    setupBar = null;
  }

  function showSetupPrompt() {
    stop();
    // stop() is a no-op without a session: still supersede a start awaiting settings or voices.
    startToken++;
    if (setupBar) return;
    setupBar = makeBar({
      doc,
      onAction: (type) => {
        // Content scripts cannot call chrome.runtime.openOptionsPage; the service worker does.
        if (type === 'setup') toWorker({ type: 'open-options' });
        if (type === 'setup' || type === 'close') closeSetupPrompt();
      },
    });
    setupBar.setState('setup');
  }

  // picked is used only for this start; a retry of session.startMsg picks again.
  async function start(msg, picked) {
    closeSetupPrompt();
    const token = ++startToken;
    const settings = await loadSettings();
    if (token !== startToken) return;
    const { list, voice } = await resolveVoice(settings.voice);
    if (token !== startToken) return;
    const { sentences, start: from, container } = pickSentences(msg, picked);

    // A new start while a session runs reuses its bar and listener.
    const running = Boolean(session);
    if (running) session.highlighter.clear();
    else session = createSession(voice, settings.speed);
    session.startMsg = msg;
    session.sentences = sentences;
    session.container = container;
    session.voice = voice;
    session.speed = settings.speed;
    session.bar.setVoices(list, voice);
    session.bar.setSpeed(settings.speed);
    session.autoscroll = settings.autoscroll;
    session.shown = null;
    session.reinjected = false;
    session.bar.setAutoscroll?.(settings.autoscroll);
    if (!sentences.length) {
      // The previous session's audio would otherwise keep playing under the error.
      if (running) send({ type: 'stop' });
      session.state = 'error';
      session.bar.setState('error', 'Nothing to read on this page');
      return;
    }
    await play(from);
  }

  function handle(msg) {
    if (!msg || typeof msg.type !== 'string') return undefined;
    switch (msg.type) {
      case 'start':
        return start(msg);
      case 'setup-prompt':
        return showSetupPrompt();
      case 'toggle':
        return toggle();
      case 'stop':
        // Stopped from outside (another tab started, the tab navigates): no echo.
        return teardown();
      case 'sentence-start': {
        const s = session?.sentences[msg.index];
        if (!s) return undefined;
        session.current = msg.index;
        session.shown = msg.index;
        session.highlighter.show(s, { scroll: session.autoscroll });
        return undefined;
      }
      case 'state':
        if (!session) return undefined;
        session.state = msg.state;
        session.bar.setState(msg.state, msg.error);
        if (msg.state === 'idle') {
          session.highlighter.clear();
          session.shown = null;
        }
        return undefined;
      default:
        return undefined;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    handle(msg);
    return false;
  });
  chrome.runtime.onConnect?.addListener(onConnect);

  return {
    handle,
    onAction,
    get session() {
      return session;
    },
  };
}

// Install once per page: a second injection of the bundle reuses the existing controller.
export function install(win = globalThis, deps = {}) {
  if (win[CONTROLLER_KEY]) return win[CONTROLLER_KEY];
  const controller = createController({ win, doc: win.document, chrome: win.chrome, ...deps });
  win[CONTROLLER_KEY] = controller;
  return controller;
}

// Bundle entry: runs only inside an extension content script, not when imported by tests.
if (globalThis.chrome?.runtime?.id && globalThis.document) install(globalThis);
