// Highlights the current sentence with the CSS Custom Highlight API, so the page DOM is
// never mutated, and scrolls it into view only when it is off-screen (unless the caller turns
// scrolling off: show(sentence, {scroll: false}) only highlights). The player bar floats over the
// bottom of the viewport, so the visible area ends above it: obscuredBottom() returns the bar's
// top edge in viewport rows (or null/innerHeight when there is no bar), read at every check
// because the bar grows with the selection strip and the fold-out.

const NAME = 'reader-current';
const STYLE_ID = 'omnivoice-reader-highlight-style';
// Gap kept between the sentence and the bar's top edge.
const BAR_MARGIN = 16;
// Gap kept above a sentence too tall for the visible area, aligned to its top.
const TOP_MARGIN = 16;
const STYLE = `::highlight(${NAME}) { background-color: rgba(255, 213, 0, 0.45); color: inherit; }`;

// Defaults are read from globalThis at call time (not import time), so the module loads in
// Node where CSS, Highlight, document and window do not exist.
export function createHighlighter({
  highlights = globalThis.CSS?.highlights,
  Highlight = globalThis.Highlight,
  doc = globalThis.document,
  win = globalThis.window,
  obscuredBottom = () => null,
} = {}) {
  let current = null;

  function ensureStyle() {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    (doc.head || doc.documentElement).appendChild(style);
  }

  // Rows of the window not covered by the bar: `bar` is where its top edge sits (innerHeight with
  // no bar), `bottom` where the visible area ends (the bar's top minus the margin).
  function windowArea() {
    const height = win.innerHeight;
    const edge = obscuredBottom?.();
    if (typeof edge !== 'number' || !Number.isFinite(edge) || edge >= height) return { bar: height, bottom: height };
    const bar = Math.max(0, edge);
    return { bar, bottom: Math.max(0, bar - BAR_MARGIN) };
  }

  const SCROLLING = new Set(['auto', 'scroll']);

  // Ancestors that scroll their own content (overflow auto/scroll), innermost first.
  function scrollers(el) {
    const out = [];
    for (let node = el?.parentElement; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
      const style = win.getComputedStyle?.(node);
      if (style && (SCROLLING.has(style.overflowY) || SCROLLING.has(style.overflowX))) out.push(node);
    }
    return out;
  }

  // The box's scrollport (its padding box, without scrollbars) in viewport coordinates.
  function clientRect(box) {
    const r = box.getBoundingClientRect();
    const top = r.top + (box.clientTop || 0);
    const left = r.left + (box.clientLeft || 0);
    return { top, bottom: top + (box.clientHeight || r.height), left, right: left + (box.clientWidth || r.width) };
  }

  // What the user can actually see: the window viewport above the bar, clipped by every
  // scrolling ancestor.
  function visibleRect(boxes, area) {
    const v = { top: 0, bottom: area.bottom, left: 0, right: win.innerWidth };
    for (const box of boxes) {
      const r = clientRect(box);
      v.top = Math.max(v.top, r.top);
      v.bottom = Math.min(v.bottom, r.bottom);
      v.left = Math.max(v.left, r.left);
      v.right = Math.min(v.right, r.right);
    }
    return v;
  }

  // Off-screen = no part of the sentence lies in the visible rect (an empty rect hides everything),
  // or its bottom runs below the visible area, under the bar.
  function isOffScreen(rect, visible) {
    return (
      visible.bottom <= visible.top ||
      visible.right <= visible.left ||
      rect.bottom <= visible.top ||
      rect.bottom > visible.bottom ||
      rect.right <= visible.left ||
      rect.left >= visible.right
    );
  }

  function scrollTarget(range) {
    const node = range.startContainer;
    return node && node.nodeType === 1 ? node : node?.parentElement ?? node?.parentNode ?? null;
  }

  // Centre the sentence's block with scrollIntoView, which scrolls every scrolling ancestor and
  // the window. But when the block is taller than a scrollport it sits in, centring the block can
  // leave the sentence itself hidden, so scroll each level by the sentence's own offset instead:
  // every vertically overflowing ancestor from the innermost outwards, then the window, each
  // centring the sentence within it unless it is already fully visible there (a sentence taller
  // than the level is aligned to its top instead, so its start is readable).
  // The offsets are computed up front from one set of measurements: scrolling a box moves the
  // sentence by the scrolled amount but never moves the box's ancestors, so the sentence's next
  // position is plain arithmetic. That keeps every step smooth (no re-measuring a rect that a
  // running smooth scroll has not updated yet), at the cost of trusting that each scrollBy is
  // applied in full (a box clamped at its scroll end leaves the sentence slightly off-centre).
  // With the bar on screen the window level centres the sentence in the rows above the bar, and
  // a box reaching under the bar counts only down to the visible area. scrollIntoView cannot keep
  // clear of the bar, so then the per-level path is used for a short block too.
  function scrollToSentence(range, rect, boxes, area) {
    const target = scrollTarget(range);
    const block = target?.getBoundingClientRect?.();
    // top..bottom: the rows the sentence must lie in to stay put; centre: the row it is centred on.
    const barShown = area.bar < win.innerHeight;
    const levels = boxes
      .filter((box) => box.scrollHeight > box.clientHeight && box.scrollBy)
      .map((box) => {
        const r = clientRect(box);
        // A box reaching down under the bar is clipped by it (one wholly below is left alone).
        const bottom = barShown && r.top < area.bottom ? Math.min(r.bottom, area.bottom) : r.bottom;
        return { top: r.top, bottom, centre: (r.top + bottom) / 2, scrollBy: (opts) => box.scrollBy(opts) };
      });
    if (win.scrollBy) {
      levels.push({ top: 0, bottom: area.bottom, centre: area.bar / 2, scrollBy: (opts) => win.scrollBy(opts) });
    }
    const smallest = Math.min(area.bottom, ...levels.map((l) => l.bottom - l.top));
    if (block && ((barShown && win.scrollBy) || block.height > smallest) && levels.length) {
      let top = rect.top;
      let bottom = rect.bottom;
      for (const level of levels) {
        if (top >= level.top && bottom <= level.bottom) continue;
        // Too tall to fit: centring would hide its start, so its top goes near the top instead.
        const tall = bottom - top > level.bottom - level.top;
        const delta = Math.round(tall ? top - (level.top + TOP_MARGIN) : (top + bottom) / 2 - level.centre);
        if (!delta) continue;
        level.scrollBy({ top: delta, behavior: 'smooth' });
        top -= delta;
        bottom -= delta;
      }
      return;
    }
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }

  function show(sentence, { scroll = true } = {}) {
    ensureStyle();
    if (!current) current = new Highlight();
    current.clear();
    current.add(sentence.range);
    highlights.set(NAME, current);
    if (!scroll) return;
    const rect = sentence.range.getBoundingClientRect();
    const boxes = scrollers(scrollTarget(sentence.range));
    const area = windowArea();
    if (isOffScreen(rect, visibleRect(boxes, area))) scrollToSentence(sentence.range, rect, boxes, area);
  }

  function clear() {
    current?.clear();
    highlights.delete(NAME);
  }

  return { show, clear };
}
