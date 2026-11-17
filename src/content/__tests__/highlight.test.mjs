import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createHighlighter } from '../highlight.mjs';

// Fake of the CSS Custom Highlight API: Highlight is set-like, the registry map-like.
class FakeHighlight extends Set {
  constructor(...ranges) { super(ranges); }
}

function setup({ rect = { top: 100, bottom: 120, left: 10, right: 200 }, obscuredBottom } = {}) {
  const { document, window } = parseHTML(`<!doctype html><html><head></head><body>
    <article id="root"><p id="p1">First sentence. Second sentence.</p><p id="p2">Third one.</p></article>
  </body></html>`);
  const win = { innerHeight: 800, innerWidth: 1200 };
  const scrolls = [];
  for (const p of document.querySelectorAll('p')) {
    p.scrollIntoView = (opts) => scrolls.push({ id: p.id, opts });
  }
  // A range stand-in: the highlighter only reads its start node and its rect.
  const makeSentence = (id, r = rect) => ({
    text: id,
    range: {
      startContainer: document.getElementById(id).firstChild,
      getBoundingClientRect: () => r,
    },
  });
  const highlights = new Map();
  const hl = createHighlighter({ highlights, Highlight: FakeHighlight, doc: document, win, obscuredBottom });
  return { document, window, win, scrolls, makeSentence, highlights, hl };
}

test('show puts only the current range in the highlight', () => {
  const { document, makeSentence, highlights, hl } = setup();
  const a = makeSentence('p1');
  const b = makeSentence('p2');
  hl.show(a);
  hl.show(b);
  const current = highlights.get('reader-current');
  assert.ok(current instanceof FakeHighlight);
  assert.deepEqual([...current], [b.range]);
  const styles = [...document.querySelectorAll('style')].filter((s) => s.textContent.includes('::highlight(reader-current)'));
  assert.equal(styles.length, 1);
  hl.clear();
  assert.equal(highlights.has('reader-current'), false);
});

test('scrolls only when the sentence is off-screen', () => {
  const { scrolls, makeSentence, hl } = setup();
  hl.show(makeSentence('p1', { top: 100, bottom: 120, left: 0, right: 100 }));
  assert.equal(scrolls.length, 0);
  hl.show(makeSentence('p2', { top: 1500, bottom: 1520, left: 0, right: 100 }));
  hl.show(makeSentence('p1', { top: -300, bottom: -280, left: 0, right: 100 }));
  assert.deepEqual(scrolls, [
    { id: 'p2', opts: { block: 'center', behavior: 'smooth' } },
    { id: 'p1', opts: { block: 'center', behavior: 'smooth' } },
  ]);
});

test('highlighting leaves the container DOM unchanged', () => {
  const { document, makeSentence, hl } = setup();
  const root = document.getElementById('root');
  const before = root.innerHTML;
  hl.show(makeSentence('p1'));
  hl.show(makeSentence('p2', { top: 2000, bottom: 2020, left: 0, right: 10 }));
  hl.clear();
  assert.equal(root.innerHTML, before);
});

test('tall paragraph scrolls the window to the sentence', () => {
  const { document, win, scrolls, makeSentence, hl } = setup();
  const winScrolls = [];
  win.scrollBy = (opts) => winScrolls.push(opts);
  // p1 is taller than the 800px viewport: centring the paragraph could leave the sentence off-screen.
  document.getElementById('p1').getBoundingClientRect = () => ({ top: -500, bottom: 2500, height: 3000, left: 0, right: 100 });
  hl.show(makeSentence('p1', { top: 1900, bottom: 1920, left: 0, right: 100 }));
  assert.equal(scrolls.length, 0);
  // Sentence centre (1910) moves to the viewport centre (400).
  assert.deepEqual(winScrolls, [{ top: 1510, behavior: 'smooth' }]);
  // An on-screen sentence in the same tall paragraph does not scroll.
  hl.show(makeSentence('p1', { top: 300, bottom: 320, left: 0, right: 100 }));
  assert.equal(winScrolls.length, 1);
});

test('tall paragraph in a scroll container scrolls the container to the sentence', () => {
  const { document, win, scrolls, makeSentence, hl } = setup();
  const winScrolls = [];
  win.scrollBy = (opts) => winScrolls.push(opts);
  const root = document.getElementById('root');
  // #root is a 600px-high scroll box 200px down the page; the page itself does not scroll.
  win.getComputedStyle = (el) => ({ overflowY: el === root ? 'auto' : 'visible' });
  Object.defineProperty(root, 'scrollHeight', { value: 5000 });
  Object.defineProperty(root, 'clientHeight', { value: 600 });
  root.getBoundingClientRect = () => ({ top: 200, bottom: 800, height: 600, left: 0, right: 100 });
  const boxScrolls = [];
  root.scrollBy = (opts) => boxScrolls.push(opts);
  document.getElementById('p1').getBoundingClientRect = () => ({ top: -500, bottom: 2500, height: 3000, left: 0, right: 100 });
  hl.show(makeSentence('p1', { top: 1900, bottom: 1920, left: 0, right: 100 }));
  assert.equal(scrolls.length, 0);
  assert.equal(winScrolls.length, 0);
  // Sentence centre (1910) moves to the container's centre (200 + 600 / 2 = 500).
  assert.deepEqual(boxScrolls, [{ top: 1410, behavior: 'smooth' }]);
});

// Makes `el` a vertical scroll box whose scrollport sits at viewport rows top..top+height.
function scrollBox(win, el, { top, height, scrollHeight = 5000 }) {
  const boxes = (win.boxes ??= new Set());
  boxes.add(el);
  win.getComputedStyle = (node) => ({ overflowY: boxes.has(node) ? 'auto' : 'visible', overflowX: 'visible' });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { value: height });
  el.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 1000 });
  const scrolls = [];
  el.scrollBy = (opts) => scrolls.push(opts);
  return scrolls;
}

test('a sentence clipped by its scroll box but inside the window scrolls into view', () => {
  const { document, win, scrolls, makeSentence, hl } = setup();
  // #root shows viewport rows 200..500; the sentence at 600 is inside the window but hidden by the box.
  scrollBox(win, document.getElementById('root'), { top: 200, height: 300 });
  document.getElementById('p2').getBoundingClientRect = () => ({ top: 590, bottom: 630, height: 40, left: 0, right: 100 });
  hl.show(makeSentence('p2', { top: 600, bottom: 620, left: 0, right: 100 }));
  assert.deepEqual(scrolls, [{ id: 'p2', opts: { block: 'center', behavior: 'smooth' } }]);
  // Inside the box's scrollport: no scroll.
  hl.show(makeSentence('p2', { top: 300, bottom: 320, left: 0, right: 100 }));
  assert.equal(scrolls.length, 1);
});

test('a tall paragraph in a scroll box below the window is revealed through the window', () => {
  const { document, win, scrolls, makeSentence, hl } = setup();
  const winScrolls = [];
  win.scrollBy = (opts) => winScrolls.push(opts);
  // #root's scrollport (rows 1200..1800) is itself below the 800px window.
  const boxScrolls = scrollBox(win, document.getElementById('root'), { top: 1200, height: 600 });
  document.getElementById('p1').getBoundingClientRect = () => ({ top: -500, bottom: 2500, height: 3000, left: 0, right: 100 });
  hl.show(makeSentence('p1', { top: 1900, bottom: 1920, left: 0, right: 100 }));
  assert.equal(scrolls.length, 0);
  // Box: sentence centre 1910 -> box centre 1500. Window: 1500 -> window centre 400.
  assert.deepEqual(boxScrolls, [{ top: 410, behavior: 'smooth' }]);
  assert.deepEqual(winScrolls, [{ top: 1100, behavior: 'smooth' }]);
});

test('a tall paragraph in a nested scroll box is revealed through the outer scroll box', () => {
  const { document, win, scrolls, makeSentence, hl } = setup();
  const winScrolls = [];
  win.scrollBy = (opts) => winScrolls.push(opts);
  const root = document.getElementById('root');
  const outer = document.createElement('div');
  root.parentNode.insertBefore(outer, root);
  outer.appendChild(root);
  // The outer box fills the window (rows 0..800); the inner box sits below its visible part.
  const outerScrolls = scrollBox(win, outer, { top: 0, height: 800 });
  const innerScrolls = scrollBox(win, root, { top: 1200, height: 600 });
  document.getElementById('p1').getBoundingClientRect = () => ({ top: -500, bottom: 2500, height: 3000, left: 0, right: 100 });
  hl.show(makeSentence('p1', { top: 1900, bottom: 1920, left: 0, right: 100 }));
  assert.equal(scrolls.length, 0);
  assert.deepEqual(innerScrolls, [{ top: 410, behavior: 'smooth' }]);
  assert.deepEqual(outerScrolls, [{ top: 1100, behavior: 'smooth' }]);
  // The sentence is then centred in the outer box, which the window already shows.
  assert.equal(winScrolls.length, 0);
});

test('show with scroll off highlights without scrolling', () => {
  const { scrolls, makeSentence, highlights, hl, win } = setup();
  const scrolledWindow = [];
  win.scrollBy = (opts) => scrolledWindow.push(opts);
  const far = makeSentence('p2', { top: 1500, bottom: 1520, left: 0, right: 100 });
  hl.show(far, { scroll: false });
  assert.deepEqual([...highlights.get('reader-current')], [far.range]);
  assert.equal(scrolls.length, 0);
  assert.equal(scrolledWindow.length, 0);
  // Default (no options) still scrolls.
  hl.show(far);
  assert.equal(scrolls.length, 1);
});

// A player bar whose top edge sits at viewport row `top` (800 = no bar), read at each check.
function withBar(top) {
  const bar = { top };
  const ctx = setup({ obscuredBottom: () => bar.top });
  const winScrolls = [];
  ctx.win.scrollBy = (opts) => winScrolls.push(opts);
  return { ...ctx, bar, winScrolls };
}

test('a sentence behind the bar counts as off-screen', () => {
  // Bar 60px tall: its top at 740, so the visible area ends at 740 - 16 = 724.
  const { winScrolls, makeSentence, hl } = withBar(740);
  hl.show(makeSentence('p1', { top: 600, bottom: 620, left: 0, right: 100 }));
  assert.equal(winScrolls.length, 0);
  // Inside the window but under the bar.
  hl.show(makeSentence('p1', { top: 750, bottom: 770, left: 0, right: 100 }));
  assert.equal(winScrolls.length, 1);
  // Partly above the bar, but its bottom runs into the margin.
  hl.show(makeSentence('p1', { top: 710, bottom: 730, left: 0, right: 100 }));
  assert.equal(winScrolls.length, 2);
});

test('autoscroll centres the sentence in the area above the bar', () => {
  const { scrolls, winScrolls, makeSentence, hl } = withBar(740);
  hl.show(makeSentence('p2', { top: 1000, bottom: 1020, left: 0, right: 100 }));
  // Sentence centre (1010) moves to the centre of rows 0..740 (370); no scrollIntoView,
  // which would centre it in the full viewport (400) and leave it nearer the bar.
  assert.equal(scrolls.length, 0);
  assert.deepEqual(winScrolls, [{ top: 640, behavior: 'smooth' }]);
});

test('taller bar (fold-out open) scrolls earlier', () => {
  const { bar, winScrolls, makeSentence, hl } = withBar(740);
  const sentence = makeSentence('p1', { top: 554, bottom: 574, left: 0, right: 100 });
  hl.show(sentence);
  assert.equal(winScrolls.length, 0);
  // The fold-out opens: the bar is now 235px tall (top at 565), read again at the next check.
  bar.top = 565;
  hl.show(sentence);
  // Sentence centre (564) moves to the centre of rows 0..565 (282.5).
  assert.deepEqual(winScrolls, [{ top: 282, behavior: 'smooth' }]);
});

test('no bar uses the full viewport', () => {
  for (const obscuredBottom of [undefined, () => 800, () => null]) {
    const { win, scrolls, makeSentence, hl } = setup({ obscuredBottom });
    const winScrolls = [];
    win.scrollBy = (opts) => winScrolls.push(opts);
    // Near the bottom edge but fully inside the viewport: no scroll, no margin.
    hl.show(makeSentence('p1', { top: 770, bottom: 790, left: 0, right: 100 }));
    assert.equal(scrolls.length, 0);
    assert.equal(winScrolls.length, 0);
    // Below the viewport: the block is centred with scrollIntoView, as before.
    hl.show(makeSentence('p2', { top: 1500, bottom: 1520, left: 0, right: 100 }));
    assert.deepEqual(scrolls, [{ id: 'p2', opts: { block: 'center', behavior: 'smooth' } }]);
    assert.equal(winScrolls.length, 0);
  }
});

test('a sentence taller than the area above the bar is aligned to its top', () => {
  const { winScrolls, makeSentence, hl } = withBar(740);
  // 900px tall, the visible area only 724: centring would hide its start above the window.
  hl.show(makeSentence('p2', { top: 1000, bottom: 1900, left: 0, right: 100 }));
  // Its top (1000) moves to 16px below the top of the area.
  assert.deepEqual(winScrolls, [{ top: 984, behavior: 'smooth' }]);
});

test('a scroll box reaching under the bar is clipped to the area above it', () => {
  const { document, win, scrolls, winScrolls, makeSentence, hl } = withBar(740);
  // #root fills the window (rows 0..800), so its bottom 76px sit under the bar.
  const boxScrolls = scrollBox(win, document.getElementById('root'), { top: 0, height: 800 });
  document.getElementById('p1').getBoundingClientRect = () => ({ top: -500, bottom: 2500, height: 3000, left: 0, right: 100 });
  hl.show(makeSentence('p1', { top: 1900, bottom: 1920, left: 0, right: 100 }));
  assert.equal(scrolls.length, 0);
  // Sentence centre (1910) moves to the centre of rows 0..724 (362), not of the full box (400).
  assert.deepEqual(boxScrolls, [{ top: 1548, behavior: 'smooth' }]);
  // Already above the bar after the box scrolls: the window stays put.
  assert.equal(winScrolls.length, 0);
});
