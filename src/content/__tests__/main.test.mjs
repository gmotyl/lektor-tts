import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createController, install } from '../main.mjs';
import { createBar } from '../bar.mjs';
import { installTextRange } from './fake-range.mjs';
import { SLACK, CHANNELS, scrollPanes } from './app-pages.mjs';

const longParagraph = (n) =>
  `<p id="p${n}">Paragraph ${n} talks about the topic at length, with commas, details, and more words so that it scores well. ` +
  `It keeps going for a while longer here, adding context, examples, and some plain filler text.</p>`;

const PAGE = `
  <nav><a href="/">Home</a> <a href="/about">About us</a></nav>
  <main><article id="art"><h1>Title of the article</h1>
    ${[1, 2, 3, 4, 5, 6].map(longParagraph).join('\n')}
  </article></main>
  <footer><p>Copyright notice.</p></footer>`;

function fakeSelection(startNode, startOffset, endNode, endOffset) {
  const range = { startContainer: startNode, startOffset, endContainer: endNode, endOffset };
  const ancestors = new Set();
  for (let n = startNode; n; n = n.parentNode) ancestors.add(n);
  let common = endNode;
  while (common && !ancestors.has(common)) common = common.parentNode;
  range.commonAncestorContainer = common;
  return { rangeCount: 1, isCollapsed: false, getRangeAt: () => range };
}

// A Port as the content script sees it: what it posts lands in `posted` (shared by every port),
// emit() delivers a frame event, drop() is the frame going away.
function fakePort(name, posted) {
  const onMessage = [];
  const onDisconnect = [];
  const port = {
    name,
    connected: true,
    postMessage: (msg) => {
      if (!port.connected) throw new Error('Attempting to use a disconnected port object');
      posted.push(msg);
    },
    disconnect: () => {
      port.connected = false;
    },
    onMessage: { addListener: (fn) => onMessage.push(fn) },
    onDisconnect: { addListener: (fn) => onDisconnect.push(fn) },
    emit: (msg) => onMessage.forEach((fn) => fn(msg, port)),
    drop: () => {
      port.connected = false;
      onDisconnect.forEach((fn) => fn(port));
    },
  };
  return port;
}

function fakeChrome(stored = {}) {
  const sent = [];
  const posted = [];
  const listeners = [];
  const connectListeners = [];
  const ports = [];
  return {
    sent,
    posted,
    ports,
    listeners,
    connectListeners,
    // The player frame opening its Port to this tab.
    connect(name = 'player') {
      const port = fakePort(name, posted);
      ports.push(port);
      connectListeners.forEach((fn) => fn(port));
      return port;
    },
    runtime: {
      id: 'test',
      getURL: (path) => `chrome-extension://test/${path}`,
      sendMessage: async (msg) => {
        sent.push(msg);
      },
      onMessage: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => listeners.splice(listeners.indexOf(fn), 1),
      },
      onConnect: {
        addListener: (fn) => connectListeners.push(fn),
      },
    },
    stored,
    storage: {
      sync: {
        get: async (defaults) => ({ ...defaults, ...stored }),
        set: async (obj) => {
          Object.assign(stored, obj);
        },
      },
    },
  };
}

// autoConnect: every player frame the controller creates opens its Port on the next microtask,
// as the real frame does once loaded. Off, the test connects with chrome.connect().
function setup({ selection = null, stored = {}, listVoices = null, page = PAGE, autoConnect = true } = {}) {
  const { document, window } = parseHTML(
    `<!doctype html><html lang="en"><head><title>Test</title></head><body>${page}</body></html>`,
  );
  installTextRange(document);
  const frames = [];
  const createElement = document.createElement.bind(document);
  document.createElement = (name, ...rest) => {
    const el = createElement(name, ...rest);
    if (String(name).toLowerCase() === 'iframe') {
      frames.push(el);
      if (autoConnect) queueMicrotask(() => chrome.connect('player'));
    }
    return el;
  };
  // Count the controller's capture-phase click listeners, so a missing removeEventListener shows.
  const clickListeners = new Set();
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  document.addEventListener = (type, fn, opts) => {
    if (type === 'click') clickListeners.add(fn);
    return add(type, fn, opts);
  };
  document.removeEventListener = (type, fn, opts) => {
    if (type === 'click') clickListeners.delete(fn);
    return remove(type, fn, opts);
  };
  const chrome = fakeChrome(stored);
  const win = {
    document,
    chrome,
    navigator: { language: 'en-US' },
    getSelection: () => selection?.(document),
    innerHeight: 800,
    innerWidth: 1200,
  };
  const highlights = [];
  const highlighter = {
    shown: null,
    show(s, opts) {
      this.shown = s;
      this.opts = opts;
      highlights.push(s);
    },
    clear() {
      this.shown = null;
      highlights.push(null);
    },
  };
  const bars = [];
  const makeBar = (opts) => {
    const bar = createBar(opts);
    const states = [];
    const wrapped = {
      ...bar,
      states,
      action: opts.onAction,
      setState: (s, e) => {
        states.push(s);
        bar.setState(s, e);
      },
    };
    bars.push(wrapped);
    return wrapped;
  };
  const deps = { createBar: makeBar, createHighlighter: () => highlighter, listVoices };
  return { document, window, win, chrome, highlighter, highlights, bars, deps, clickListeners, frames };
}

const barHosts = (doc) => doc.querySelectorAll('[data-omnivoice-reader="bar"]').length;
const ofType = (sent, type) => sent.filter((m) => m.type === type);

function altClick(document, el) {
  const ev = new document.defaultView.Event('click', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'altKey', { value: true });
  el.dispatchEvent(ev);
  return ev;
}

async function started(opts, startMsg = { type: 'start', source: 'auto' }) {
  const t = setup(opts);
  const c = install(t.win, t.deps);
  await c.handle(startMsg);
  return { ...t, c };
}

test('auto start reads the article from the first sentence', async () => {
  const { chrome, document, c } = await started({ stored: { voice: 'alba', speed: 1.2 } });
  const [play] = ofType(chrome.posted, 'play');
  assert.ok(play, 'play sent');
  assert.equal(play.start, 0);
  assert.equal(play.voice, 'alba');
  assert.equal(play.speed, 1.2);
  assert.ok(play.sentences.every((s) => Array.isArray(s) && s.every((p) => typeof p === 'string')));
  assert.match(play.sentences[0][0], /Title of the article/);
  assert.ok(!play.sentences.flat().some((p) => /Copyright|About us/.test(p)));
  assert.equal(play.sentences.length, c.session.sentences.length);
  assert.equal(barHosts(document), 1);
});

test('selection start reads only the selection', async () => {
  const selection = (doc) => {
    const text = doc.getElementById('p2').firstChild;
    return fakeSelection(text, 0, text, text.data.indexOf('It keeps'));
  };
  for (const source of ['selection', 'auto']) {
    const { chrome } = await started({ selection }, { type: 'start', source });
    const [play] = ofType(chrome.posted, 'play');
    assert.equal(play.start, 0);
    assert.equal(play.sentences.length, 1, source);
    assert.match(play.sentences[0][0], /^Paragraph 2 talks/);
  }
});

test('from-here starts at the paragraph under the point', async () => {
  // The context menu reports the clicked link: start at the paragraph holding it.
  const t = setup();
  const a = t.document.createElement('a');
  a.setAttribute('href', 'https://example.com/more');
  a.textContent = 'more';
  t.document.getElementById('p4').appendChild(a);
  const c = install(t.win, t.deps);
  await c.handle({ type: 'start', source: 'from-here', linkUrl: 'https://example.com/more' });
  const [play] = ofType(t.chrome.posted, 'play');
  assert.match(play.sentences[play.start][0], /^Paragraph 4 talks/);

  // A plain page right-click has no link: the innermost hovered element decides.
  const t2 = setup();
  const qsa = t2.document.querySelectorAll.bind(t2.document);
  t2.document.querySelectorAll = (sel) =>
    sel === ':hover'
      ? [t2.document.documentElement, t2.document.body, t2.document.getElementById('art'), t2.document.getElementById('p3')]
      : qsa(sel);
  const c2 = install(t2.win, t2.deps);
  await c2.handle({ type: 'start', source: 'from-here' });
  const [play2] = ofType(t2.chrome.posted, 'play');
  assert.match(play2.sentences[play2.start][0], /^Paragraph 3 talks/);

  // nothing resolvable → falls back to the first sentence
  const t3 = setup();
  const c3 = install(t3.win, t3.deps);
  await c3.handle({ type: 'start', source: 'from-here', srcUrl: 'https://example.com/missing.png' });
  assert.equal(ofType(t3.chrome.posted, 'play')[0].start, 0);
});

test('from-here resolves a clicked image by srcUrl', async () => {
  const t = setup();
  const img = t.document.createElement('img');
  img.setAttribute('src', 'https://example.com/pic.png');
  t.document.getElementById('p5').appendChild(img);
  const c = install(t.win, t.deps);
  await c.handle({ type: 'start', source: 'from-here', srcUrl: 'https://example.com/pic.png' });
  const [play] = ofType(t.chrome.posted, 'play');
  assert.match(play.sentences[play.start][0], /^Paragraph 5 talks/);
});

test('alt+click seeks to the paragraph start', async () => {
  const { chrome, document, c } = await started();
  c.handle({ type: 'state', state: 'playing' });
  const p5 = document.getElementById('p5');
  const ev = altClick(document, p5.firstChild.parentElement);
  assert.equal(ev.defaultPrevented, true);
  const [seek] = ofType(chrome.posted, 'seek');
  assert.ok(seek, 'seek sent');
  assert.match(c.session.sentences[seek.index].text, /^Paragraph 5 talks/);

  // a plain click is left alone
  const plain = new document.defaultView.Event('click', { bubbles: true, cancelable: true });
  p5.dispatchEvent(plain);
  assert.equal(plain.defaultPrevented, false);
  assert.equal(ofType(chrome.posted, 'seek').length, 1);
});

test('alt+click on the article container itself does not seek', async () => {
  const { chrome, document, c } = await started();
  c.handle({ type: 'state', state: 'playing' });
  // Empty space between paragraphs targets the wrapper; so do clicks on main and body.
  for (const el of [document.getElementById('art'), document.querySelector('main'), document.body]) {
    const ev = altClick(document, el);
    assert.equal(ev.defaultPrevented, false, el.tagName);
  }
  await new Promise((r) => setImmediate(r));
  assert.equal(ofType(chrome.posted, 'seek').length, 0);
  assert.equal(ofType(chrome.posted, 'play').length, 1);
});

test('sentence-start moves the highlight', async () => {
  const { highlighter, c } = await started();
  c.handle({ type: 'sentence-start', index: 2 });
  assert.equal(highlighter.shown, c.session.sentences[2]);
  c.handle({ type: 'sentence-start', index: 3 });
  assert.equal(highlighter.shown, c.session.sentences[3]);
});

test('bar actions map to engine messages', async () => {
  const { chrome, bars, c } = await started();
  const act = bars[0].action;
  const last = () => chrome.posted.at(-1);
  const n = c.session.sentences.length;
  const paraStart = c.session.sentences.findIndex((s) => s.paragraph === 1);
  c.handle({ type: 'state', state: 'playing' });

  c.handle({ type: 'sentence-start', index: 0 });
  act('next');
  assert.deepEqual(last(), { type: 'seek', index: 1 });
  c.handle({ type: 'sentence-start', index: 1 });
  act('prev');
  assert.deepEqual(last(), { type: 'seek', index: 0 });
  c.handle({ type: 'sentence-start', index: 0 });
  act('next-paragraph');
  assert.deepEqual(last(), { type: 'seek', index: paraStart });
  c.handle({ type: 'sentence-start', index: paraStart + 1 });
  act('prev-paragraph');
  assert.deepEqual(last(), { type: 'seek', index: paraStart });

  act('toggle');
  assert.deepEqual(last(), { type: 'pause' });
  act('toggle');
  assert.deepEqual(last(), { type: 'resume' });
  act('speed', 1.3);
  assert.deepEqual(last(), { type: 'set-speed', speed: 1.3 });
  act('voice', 'bob');
  assert.deepEqual(last(), { type: 'set-voice', voice: 'bob' });

  c.handle({ type: 'sentence-start', index: n - 1 });
  act('next');
  assert.deepEqual(last(), { type: 'stop' });
  assert.equal(c.session, null);

  // close sends stop
  const t = await started();
  t.bars[0].action('close');
  assert.deepEqual(t.chrome.posted.at(-1), { type: 'stop' });
});

test('toggle pauses and resumes', async () => {
  const { chrome, c, bars } = await started();
  c.handle({ type: 'state', state: 'playing' });
  c.handle({ type: 'toggle' });
  assert.deepEqual(chrome.posted.at(-1), { type: 'pause' });
  assert.equal(bars[0].states.at(-1), 'paused');
  c.handle({ type: 'toggle' });
  assert.deepEqual(chrome.posted.at(-1), { type: 'resume' });
  assert.equal(bars[0].states.at(-1), 'playing');
});

test('stop tears down bar, highlight and listeners', async () => {
  for (const how of ['message', 'close']) {
    const { chrome, document, highlighter, bars, c, clickListeners } = await started();
    c.handle({ type: 'sentence-start', index: 1 });
    assert.equal(clickListeners.size, 1, how);
    if (how === 'message') c.handle({ type: 'stop' });
    else bars[0].action('close');
    assert.equal(clickListeners.size, 0, `${how}: click listener removed`);
    assert.equal(highlighter.shown, null, how);
    assert.equal(barHosts(document), 0, how);
    assert.equal(c.session, null, how);
    const before = chrome.posted.length;
    const ev = altClick(document, document.getElementById('p3'));
    assert.equal(ev.defaultPrevented, false, how);
    assert.equal(chrome.posted.length, before, how);
  }
});

test('double injection keeps one session', async () => {
  const t = setup();
  const first = install(t.win, t.deps);
  const second = install(t.win, t.deps);
  assert.equal(first, second);
  assert.equal(t.chrome.listeners.length, 1);
  await first.handle({ type: 'start', source: 'auto' });
  await second.handle({ type: 'start', source: 'auto' });
  assert.equal(barHosts(t.document), 1);
  assert.equal(t.bars.length, 1);
  assert.equal(ofType(t.chrome.posted, 'play').length, 2);
});

test('empty stored voice uses the first listed voice, asked once', async () => {
  let calls = 0;
  const listVoices = async () => {
    calls++;
    return { ok: true, voices: ['first', 'second'] };
  };
  const t = setup({ listVoices });
  const c = createController({ ...t.deps, doc: t.document, win: t.win, chrome: t.chrome });
  await c.handle({ type: 'start', source: 'auto' });
  await c.handle({ type: 'start', source: 'auto' });
  assert.equal(calls, 1);
  assert.ok(ofType(t.chrome.posted, 'play').every((p) => p.voice === 'first'));
});

test('natural end keeps alt+click, which starts reading again there', async () => {
  const { chrome, document, c, clickListeners } = await started();
  c.handle({ type: 'state', state: 'playing' });
  c.handle({ type: 'state', state: 'idle' });
  assert.equal(clickListeners.size, 1, 'listener kept after the last sentence ended');
  const before = ofType(chrome.posted, 'play').length;
  const ev = altClick(document, document.getElementById('p6'));
  assert.equal(ev.defaultPrevented, true);
  const plays = ofType(chrome.posted, 'play');
  assert.equal(plays.length, before + 1);
  assert.match(plays.at(-1).sentences[plays.at(-1).start][0], /^Paragraph 6 talks/);
});

test('stop during start does not start a session', async () => {
  let release;
  const listVoices = () => new Promise((r) => (release = r));
  const t = setup({ listVoices });
  const c = install(t.win, t.deps);
  const starting = c.handle({ type: 'start', source: 'auto' });
  await new Promise((r) => setImmediate(r));
  c.handle({ type: 'stop' });
  release({ ok: true, voices: ['a'] });
  await starting;
  assert.ok(c.session === null, 'no session'); // not assert.equal: inspecting a session walks the DOM
  assert.equal(ofType(t.chrome.posted, 'play').length, 0);
  assert.equal(barHosts(t.document), 0);
});

test('setup prompt during start cancels the pending start', async () => {
  let release;
  const listVoices = () => new Promise((r) => (release = r));
  const t = setup({ listVoices });
  const c = install(t.win, t.deps);
  const starting = c.handle({ type: 'start', source: 'auto' });
  await new Promise((r) => setImmediate(r));
  c.handle({ type: 'setup-prompt' });
  release({ ok: true, voices: ['a'] });
  await starting;
  assert.ok(c.session === null, 'no session'); // not assert.equal: inspecting a session walks the DOM
  assert.equal(ofType(t.chrome.posted, 'play').length, 0);
  assert.equal(t.bars.length, 1, 'only the setup bar');
  assert.deepEqual(t.bars[0].states, ['setup']);
  assert.equal(barHosts(t.document), 1, 'setup bar stays');
});

test('voices are asked once per session', async () => {
  let calls = 0;
  const listVoices = async () => {
    calls++;
    return { ok: true, voices: ['first'] };
  };
  const { c, bars } = await started({ listVoices });
  await c.handle({ type: 'start', source: 'auto' });
  assert.equal(calls, 1);
  bars[0].action('close');
  await c.handle({ type: 'start', source: 'auto' });
  assert.equal(calls, 2, 'a new session asks again');
});

test('default listVoices asks the service worker', async () => {
  const t = setup();
  const send = t.chrome.runtime.sendMessage;
  t.chrome.runtime.sendMessage = async (msg) => {
    await send(msg);
    return msg.type === 'list-voices' ? { ok: true, voices: ['sw-voice'] } : undefined;
  };
  const { listVoices, ...deps } = t.deps;
  const c = createController({ ...deps, doc: t.document, win: t.win, chrome: t.chrome });
  await c.handle({ type: 'start', source: 'auto' });
  assert.equal(ofType(t.chrome.sent, 'list-voices').length, 1);
  assert.equal(ofType(t.chrome.posted, 'play')[0].voice, 'sw-voice');
});

test('retry after nothing to read picks sentences again', async () => {
  const t = setup({ page: '<main id="m"></main>' });
  const c = install(t.win, t.deps);
  await c.handle({ type: 'start', source: 'auto' });
  assert.equal(c.session.state, 'error');
  assert.equal(ofType(t.chrome.posted, 'play').length, 0);
  // The page finished rendering its article meanwhile.
  t.document.getElementById('m').innerHTML = `<article>${[1, 2, 3, 4].map(longParagraph).join('')}</article>`;
  await t.bars[0].action('retry');
  const [play] = ofType(t.chrome.posted, 'play');
  assert.ok(play, 'play sent');
  assert.ok(play.sentences.length > 0);
});

test('a new start with nothing to read stops the running audio', async () => {
  const t = await started();
  assert.equal(ofType(t.chrome.posted, 'play').length, 1);
  assert.equal(ofType(t.chrome.posted, 'stop').length, 0);
  // The page now has nothing readable; a fresh start must not leave the old audio playing.
  t.document.body.innerHTML = '<main></main>';
  await t.c.handle({ type: 'start', source: 'auto' });
  assert.equal(t.c.session.state, 'error');
  assert.equal(ofType(t.chrome.posted, 'stop').length, 1);
  assert.equal(ofType(t.chrome.posted, 'play').length, 1);
});

test('an older start finishing after a newer one has no side effects', async () => {
  const t = await started();
  t.chrome.posted.length = 0;
  // The first settings load is slow, so the older start resumes after the newer one played.
  let release;
  const get = t.chrome.storage.sync.get;
  let calls = 0;
  t.chrome.storage.sync.get = async (defaults) => {
    if (calls++ === 0) await new Promise((r) => (release = r));
    return get(defaults);
  };
  // Older start: "Read selection" with nothing selected finds no sentences.
  const older = t.c.handle({ type: 'start', source: 'selection' });
  await new Promise((r) => setImmediate(r));
  await t.c.handle({ type: 'start', source: 'auto' });
  assert.equal(ofType(t.chrome.posted, 'play').length, 1);
  const statesBefore = t.bars[0].states.length;
  release();
  await older;
  assert.equal(ofType(t.chrome.posted, 'stop').length, 0, 'no stop for the newer playback');
  assert.equal(t.bars[0].states.length, statesBefore, 'bar untouched');
  assert.equal(t.c.session.state, 'loading');
});

test('autoscroll setting is read at start and passed to the highlighter', async () => {
  const on = await started();
  on.c.handle({ type: 'sentence-start', index: 1 });
  assert.equal(on.highlighter.opts.scroll, true);

  const off = await started({ stored: { autoscroll: false } });
  off.c.handle({ type: 'sentence-start', index: 1 });
  assert.equal(off.highlighter.shown, off.c.session.sentences[1], 'still highlighted');
  assert.equal(off.highlighter.opts.scroll, false);
});

test('autoscroll toggle on the bar saves the setting and stops scrolling', async () => {
  const { chrome, bars, highlighter, c } = await started();
  c.handle({ type: 'sentence-start', index: 1 });
  bars[0].action('autoscroll', false);
  await new Promise((r) => setImmediate(r));
  assert.equal(chrome.stored.autoscroll, false);
  c.handle({ type: 'sentence-start', index: 2 });
  assert.equal(highlighter.opts.scroll, false);
  // Turning it back on brings the current sentence into view right away.
  bars[0].action('autoscroll', true);
  await new Promise((r) => setImmediate(r));
  assert.equal(chrome.stored.autoscroll, true);
  assert.equal(highlighter.shown, c.session.sentences[2]);
  assert.equal(highlighter.opts.scroll, true);
  assert.equal(ofType(chrome.posted, 'autoscroll').length, 0, 'nothing sent to the engine');
});

// A Slack-like page with fake layout, and "Read from here" on the hovered element.
function slackSetup(hoveredId) {
  const t = setup({ page: SLACK });
  t.win.getComputedStyle = scrollPanes(t.document);
  const qsa = t.document.querySelectorAll.bind(t.document);
  t.document.querySelectorAll = (sel) =>
    sel === ':hover' ? [t.document.body, t.document.querySelector(`#${hoveredId} .text`)] : qsa(sel);
  return t;
}

test('from-here on an app page reads only the clicked pane', async () => {
  const t = slackSetup('t2');
  const c = install(t.win, t.deps);
  await c.handle({ type: 'start', source: 'from-here' });
  const [play] = ofType(t.chrome.posted, 'play');
  const texts = play.sentences.map((p) => p.join(' '));
  assert.ok(texts.slice(play.start, play.start + 2).some((x) => x.startsWith('Thursday works')), texts.join(' | '));
  assert.ok(!texts.some((x) => CHANNELS.some((ch) => x.includes(ch))), texts.join(' | '));
  assert.ok(!texts.some((x) => x.includes('nightly build')), texts.join(' | '));
});

test('alt+click outside the current source starts reading that pane', async () => {
  const t = slackSetup('t2');
  const c = install(t.win, t.deps);
  await c.handle({ type: 'start', source: 'from-here' });
  c.handle({ type: 'state', state: 'playing' });

  // On the player bar (a page-level host element): ignored.
  const host = t.document.querySelector('[data-omnivoice-reader="bar"]');
  assert.equal(altClick(t.document, host).defaultPrevented, false);
  assert.equal(ofType(t.chrome.posted, 'play').length, 1);

  const ev = altClick(t.document, t.document.querySelector('#c2 .text'));
  assert.equal(ev.defaultPrevented, true);
  await new Promise((r) => setImmediate(r));
  const plays = ofType(t.chrome.posted, 'play');
  assert.equal(plays.length, 2);
  const last = plays.at(-1);
  const texts = last.sentences.map((p) => p.join(' '));
  assert.ok(texts.slice(last.start, last.start + 2).some((x) => x.startsWith('I can take a look')), texts.join(' | '));
  assert.ok(!texts.some((x) => x.includes('Thursday works')), texts.join(' | '));
  assert.equal(t.bars.length, 1, 'the running bar is reused');
  assert.equal(ofType(t.chrome.posted, 'seek').length, 0);
});

test('alt+click inside a whole-page session narrows to the clicked pane', async () => {
  // Toolbar start on an app page: Readability finds no article, the whole page is read.
  const t = slackSetup('t2');
  const c = install(t.win, t.deps);
  await c.handle({ type: 'start', source: 'auto' });
  c.handle({ type: 'state', state: 'playing' });
  const [first] = ofType(t.chrome.posted, 'play');
  const all = first.sentences.map((p) => p.join(' '));
  assert.ok(all.some((x) => x.includes('nightly build')), all.join(' | '));
  assert.ok(all.some((x) => x.startsWith('Thursday works')), all.join(' | '));

  const ev = altClick(t.document, t.document.querySelector('#t2 .text'));
  assert.equal(ev.defaultPrevented, true);
  await new Promise((r) => setImmediate(r));
  const plays = ofType(t.chrome.posted, 'play');
  assert.equal(plays.length, 2);
  const last = plays.at(-1);
  const texts = last.sentences.map((p) => p.join(' '));
  assert.ok(texts[last.start].startsWith('Thursday works'), texts.join(' | '));
  assert.ok(!texts.some((x) => CHANNELS.some((ch) => x.includes(ch))), texts.join(' | '));
  assert.ok(!texts.some((x) => x.includes('nightly build')), texts.join(' | '));
  assert.equal(t.bars.length, 1, 'the running bar is reused');
  assert.equal(ofType(t.chrome.posted, 'seek').length, 0);
});

test('voice chosen on the bar is saved as the stored voice', async () => {
  const { chrome, bars, c } = await started({ stored: { voice: 'alba', speed: 1.2 } });
  bars[0].action('voice', 'bob');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(chrome.posted.at(-1), { type: 'set-voice', voice: 'bob' });
  assert.equal(chrome.stored.voice, 'bob');
  // Speed on the bar stays session-only.
  bars[0].action('speed', 1.5);
  await new Promise((r) => setImmediate(r));
  assert.equal(chrome.stored.speed, 1.2);
  // The next session starts with the saved voice.
  await c.handle({ type: 'start', source: 'auto' });
  assert.equal(ofType(chrome.posted, 'play').at(-1).voice, 'bob');
});

// Starts a session and records the bar's closed shadow root, so the test can tap its controls.
async function startedWithBarRoot(opts) {
  const t = setup(opts);
  const roots = [];
  const realCreate = t.document.createElement.bind(t.document);
  t.document.createElement = (name, ...rest) => {
    const el = realCreate(name, ...rest);
    const attach = el.attachShadow;
    el.attachShadow = function (init) {
      const root = attach.call(this, init);
      roots.push(root);
      return root;
    };
    return el;
  };
  const c = install(t.win, t.deps);
  await c.handle({ type: 'start', source: 'auto' });
  const tap = (el) => el.dispatchEvent(new t.document.defaultView.Event('click', { bubbles: true, cancelable: true }));
  return { ...t, c, root: roots[0], tap };
}

const settle = () => new Promise((r) => setImmediate(r));

test('speed chip cycles presets and saves the default', async () => {
  const { chrome, root, tap } = await startedWithBarRoot({ stored: { voice: 'alba', speed: 1 } });
  const chip = root.querySelector('button.speed-chip');
  assert.equal(chip.textContent.trim(), '1.0×');
  for (const expected of [1.2, 1.5, 2]) {
    tap(chip);
    await settle();
    assert.deepEqual(chrome.posted.at(-1), { type: 'set-speed', speed: expected });
    assert.equal(chip.textContent.trim(), `${expected.toFixed(1)}×`);
    assert.equal(chrome.stored.speed, expected, `${expected} saved as the default`);
  }
});

test('voice change from the fold-out restarts the sentence', async () => {
  const { chrome, root, tap, c, document } = await startedWithBarRoot({ stored: { voice: 'alba', speed: 1 } });
  c.handle({ type: 'state', state: 'playing' });
  // Offer a second voice in the select, as an engine voice list would.
  const voice = root.querySelector('select[aria-label="Voice"]');
  const opt = document.createElement('option');
  opt.value = 'bob';
  opt.textContent = 'bob';
  voice.appendChild(opt);
  tap(root.querySelector('button.more'));
  assert.ok(voice.closest('.fold'), 'voice select lives in the fold-out');
  assert.equal(voice.closest('[hidden]'), null, 'fold-out is open');
  // linkedom's select.value is read-only: pick the option the way the user's tap would.
  for (const o of voice.querySelectorAll('option')) o.removeAttribute('selected');
  opt.setAttribute('selected', '');
  assert.equal(voice.value, 'bob');
  voice.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
  await settle();
  // set-voice makes the player drop prefetched audio and restart the current sentence.
  assert.deepEqual(chrome.posted.at(-1), { type: 'set-voice', voice: 'bob' });
  assert.equal(chrome.stored.voice, 'bob');
});

// Player frame: the content script hosts the extension-origin audio frame in the bar's shadow
// root and speaks the Port protocol with it.

test('start injects one player frame into the shadow host', async () => {
  const t = await startedWithBarRoot();
  const frames = t.root.querySelectorAll('iframe');
  assert.equal(frames.length, 1);
  const [frame] = frames;
  assert.equal(frame.getAttribute('src'), 'chrome-extension://test/src/player.html');
  assert.equal(frame.getAttribute('allow'), 'autoplay');
  const style = frame.getAttribute('style').replace(/\s/g, '');
  for (const rule of ['width:1px', 'height:1px', 'opacity:0', 'border:0', 'position:fixed', 'pointer-events:none']) {
    assert.ok(style.includes(rule), `${rule} in ${style}`);
  }
  assert.equal(t.document.querySelectorAll('iframe').length, 0, 'not in the page DOM');
  // A new start inside the session reuses the frame and its port.
  await t.c.handle({ type: 'start', source: 'auto' });
  assert.equal(t.frames.length, 1);
  assert.equal(t.root.querySelectorAll('iframe').length, 1);
  assert.equal(ofType(t.chrome.posted, 'play').length, 2);
});

test('sends play with the page title when the frame connects', async () => {
  const t = setup({ autoConnect: false, stored: { voice: 'alba', speed: 1.2 } });
  const c = install(t.win, t.deps);
  await c.handle({ type: 'start', source: 'auto' });
  assert.equal(t.chrome.posted.length, 0, 'nothing to send before the frame connects');
  t.chrome.connect('player');
  const plays = ofType(t.chrome.posted, 'play');
  assert.equal(plays.length, 1);
  const [play] = plays;
  assert.equal(play.title, 'Test');
  assert.equal(play.start, 0);
  assert.equal(play.voice, 'alba');
  assert.equal(play.speed, 1.2);
  assert.equal(play.sentences.length, c.session.sentences.length);
  assert.equal(ofType(t.chrome.sent, 'play').length, 0, 'no play through the service worker');
});

test('ignores ports with another name', async () => {
  const t = setup({ autoConnect: false });
  const c = install(t.win, t.deps);
  await c.handle({ type: 'start', source: 'auto' });
  const other = t.chrome.connect('something-else');
  assert.equal(t.chrome.posted.length, 0);
  other.emit({ type: 'sentence-start', index: 2 });
  assert.equal(t.highlighter.shown, null, 'its events are not followed');
  t.chrome.connect('player');
  assert.equal(ofType(t.chrome.posted, 'play').length, 1);
});

test('frame events drive the highlight and the bar', async () => {
  const t = await started();
  const [port] = t.chrome.ports;
  port.emit({ type: 'state', state: 'playing' });
  port.emit({ type: 'sentence-start', index: 2 });
  assert.equal(t.highlighter.shown, t.c.session.sentences[2]);
  assert.equal(t.c.session.state, 'playing');
  port.emit({ type: 'error', message: 'Engine said no' });
  assert.equal(t.c.session.state, 'error');
  assert.equal(t.bars[0].states.at(-1), 'error');
  port.emit({ type: 'state', state: 'ended' });
  assert.equal(t.c.session.state, 'idle');
  assert.equal(t.highlighter.shown, null);
});

test('re-injects once and resumes from the current sentence on disconnect', async () => {
  const t = await startedWithBarRoot();
  const [port] = t.chrome.ports;
  port.emit({ type: 'state', state: 'playing' });
  port.emit({ type: 'sentence-start', index: 5 });
  t.chrome.posted.length = 0;
  port.drop();
  await settle();
  assert.equal(t.frames.length, 2, 'one new frame');
  assert.equal(t.root.querySelectorAll('iframe').length, 1, 'the lost frame is gone');
  const plays = ofType(t.chrome.posted, 'play');
  assert.equal(plays.length, 1);
  assert.equal(plays[0].start, 5);
  // Commands go to the new port.
  t.bars[0].action('toggle');
  assert.deepEqual(t.chrome.posted.at(-1), { type: 'pause' });
});

test('second disconnect shows the bar error', async () => {
  const t = await startedWithBarRoot();
  t.chrome.ports[0].emit({ type: 'sentence-start', index: 3 });
  t.chrome.ports[0].drop();
  await settle();
  t.chrome.ports[1].emit({ type: 'state', state: 'playing' });
  t.chrome.ports[1].drop();
  await settle();
  assert.equal(t.frames.length, 2, 'no third frame on its own');
  assert.equal(t.c.session.state, 'error');
  assert.equal(t.bars[0].states.at(-1), 'error');
  const error = t.root.querySelector('.error');
  assert.equal(error.hasAttribute('hidden'), false);
  assert.match(error.querySelector('.message').textContent, /Audio player stopped/);
  // Retry brings a fresh frame and plays from the same sentence.
  t.chrome.posted.length = 0;
  await t.bars[0].action('retry');
  await settle();
  assert.equal(t.frames.length, 3);
  const [play] = ofType(t.chrome.posted, 'play');
  assert.equal(play.start, 3);
});

test('close stops and removes the frame', async () => {
  const t = await startedWithBarRoot();
  const [frame] = t.frames;
  const [port] = t.chrome.ports;
  const post = port.postMessage;
  let attachedAtStop = null;
  port.postMessage = (msg) => {
    if (msg.type === 'stop') attachedAtStop = t.root.querySelector('iframe') === frame;
    return post(msg);
  };
  t.chrome.posted.length = 0;
  t.bars[0].action('close');
  assert.deepEqual(t.chrome.posted, [{ type: 'stop' }]);
  assert.equal(attachedAtStop, true, 'stop is sent before the frame goes');
  assert.equal(t.root.querySelector('iframe'), null, 'frame removed');
  assert.equal(t.c.session, null);
  // The port closing after the frame went is not a lost frame.
  port.drop();
  await settle();
  assert.equal(t.frames.length, 1);
});
