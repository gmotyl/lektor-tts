// Player bar: one host element with a closed shadow root, so page CSS cannot style it
// and page scripts cannot reach its controls. The host is a custom tag (never matched by
// page rules on div) and carries an inline `all: initial !important` reset, which beats
// any page stylesheet rule that still targets it (e.g. `* { transform: … }`).

const HOST_TAG = 'omnivoice-reader-bar';
const HOST_STYLE = 'all: initial !important;';

// Inline SVG icons: unicode media glyphs render as tofu without a symbol font.
const svg = (body) =>
  `<svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">${body}</svg>`;
const ICONS = {
  prev: svg('<rect x="2" y="3" width="2" height="10"/><path d="M14 3v10L5 8z"/>'),
  next: svg('<rect x="12" y="3" width="2" height="10"/><path d="M2 3v10l9-5z"/>'),
  play: svg('<path d="M4 2.5v11L13.5 8z"/>'),
  pause: svg('<rect x="3.5" y="2.5" width="3" height="11"/><rect x="9.5" y="2.5" width="3" height="11"/>'),
  // Down arrow over a page line: follow the read sentence down the page.
  autoscroll: svg('<rect x="2" y="1.5" width="12" height="1.6"/><path d="M7.2 4.5h1.6v5.2l2-2 1.1 1.1L8 12.7 4.1 8.8l1.1-1.1 2 2z"/><rect x="2" y="13" width="12" height="1.6"/>'),
  // Lektor monogram: L with a sound arc.
  logo: '<svg aria-hidden="true" focusable="false" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#1e2a4a"/><path d="M38 28 V94 H76" fill="none" stroke="#ffffff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><path d="M72 46 a14 14 0 0 1 0 24" fill="none" stroke="#ffd54a" stroke-width="8" stroke-linecap="round"/><path d="M84 34 a30 30 0 0 1 0 48" fill="none" stroke="#ffd54a" stroke-width="8" stroke-linecap="round"/></svg>',
  close: svg('<path d="M3.5 2.1 8 6.6l4.5-4.5 1.4 1.4L9.4 8l4.5 4.5-1.4 1.4L8 9.4l-4.5 4.5-1.4-1.4L6.6 8 2.1 3.5z"/>'),
  // Three dots: open the fold-out with voice, speed slider and autoscroll.
  more: svg('<circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/>'),
  // Chevron up: close the fold-out again.
  collapse: svg('<path d="M8 4.5l5.5 5.5-1.2 1.2L8 6.9l-4.3 4.3-1.2-1.2z"/>'),
};

// Speed chip presets: a tap moves to the smallest preset above the current speed, and
// from the top preset (or above it) back to the lowest.
const SPEED_PRESETS = [0.8, 1.0, 1.2, 1.5, 2.0];

export function nextSpeed(current) {
  const s = Number(current);
  return SPEED_PRESETS.find((p) => p > s + 1e-9) ?? SPEED_PRESETS[0];
}

const STYLE = `
  :host { all: initial; }
  /* Floating card: 10px side margins, centred and capped so it does not stretch on desktop. */
  .bar {
    position: fixed; left: 10px; right: 10px; bottom: 16px; max-width: 560px; margin: 0 auto;
    box-sizing: border-box; z-index: 2147483647; display: flex; flex-direction: column; gap: 8px;
    padding: 8px; border-radius: 14px; background: #1f2328; color: #f6f8fa;
    font: 15px/1.3 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  }
  .row { display: flex; flex-wrap: nowrap; align-items: center; gap: 6px; min-width: 0; }
  .spacer { flex: 1 1 auto; min-width: 0; }
  button svg { display: block; width: 20px; height: 20px; }
  button, select { font: inherit; color: inherit; background: #2d333b; border: 1px solid #444c56;
    border-radius: 10px; padding: 0 10px; cursor: pointer; }
  /* Touch targets: every control is at least 44x44. */
  button, select, input { box-sizing: border-box; min-width: 44px; min-height: 44px; }
  button { display: inline-flex; align-items: center; justify-content: center; flex: none; }
  button:focus-visible, select:focus-visible, input:focus-visible, a:focus-visible {
    outline: 2px solid #58a6ff; outline-offset: 2px; }
  button[aria-pressed="false"] { opacity: 0.55; }
  .toggle { background: #2f8f7a; border-color: #2f8f7a; min-width: 52px; }
  .speed-chip { padding: 0 12px; font-weight: 600; }
  .more, .close { background: transparent; border-color: transparent; }
  .fold { display: grid; gap: 10px; border-top: 1px solid #30363d; padding-top: 10px; }
  .fold label { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #c9d1d9; }
  .fold select { min-width: 170px; max-width: 60%; }
  .fold .speed { flex: 1; min-width: 0; }
  .speed-value { min-width: 2.5em; text-align: right; }
  .fold[hidden], .error[hidden] { display: none; }
  .error { display: flex; gap: 8px; align-items: center; color: #ffb4ab; }
  .error a { color: #58a6ff; }
  .player { display: contents; }
  .player[hidden], .setup[hidden] { display: none; }
  /* Basis 0: on a narrow viewport the prompt wraps inside itself and × stays beside it. */
  .setup { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; flex: 1 1 0; min-width: 0; }
  .setup svg { width: 22px; height: 22px; flex: none; }
  .setup .message { flex: 1; min-width: 160px; }
  .setup-engine { background: #ffd54a; color: #1e2a4a; border-color: #ffd54a; font-weight: 600; }
  /* Selection actions: their own block above the row, so the row never shifts sideways. */
  .selection-actions { display: flex; gap: 6px; }
  .selection-actions button { flex: 1 1 0; gap: 6px; }
`;

const TEMPLATE = `
  <style>${STYLE}</style>
  <div class="bar" role="toolbar" aria-label="Reader">
    <div class="row">
      <div class="player">
        <button type="button" class="prev" aria-label="Previous" title="Previous sentence (Shift: paragraph)">${ICONS.prev}</button>
        <button type="button" class="toggle" aria-label="Play">${ICONS.play}</button>
        <button type="button" class="next" aria-label="Next" title="Next sentence (Shift: paragraph)">${ICONS.next}</button>
        <button type="button" class="speed-chip" aria-label="Speed 1.0×, tap for the next preset">1.0&times;</button>
        <span class="spacer"></span>
        <button type="button" class="more" aria-label="More settings" aria-expanded="false" aria-controls="fold">${ICONS.more}</button>
      </div>
      <div class="setup" role="status" hidden>
        ${ICONS.logo}
        <span class="message">Lektor needs a speech engine before it can read.</span>
        <button type="button" class="setup-engine">Set up a speech engine</button>
      </div>
      <button type="button" class="close" aria-label="Close">${ICONS.close}</button>
    </div>
    <div class="fold" id="fold" hidden>
      <label>Voice <select class="voice" aria-label="Voice"></select></label>
      <label>Speed
        <input class="speed" type="range" min="0.5" max="2" step="0.1" value="1" aria-label="Speed">
        <span class="speed-value">1.0&times;</span>
      </label>
      <label>Autoscroll
        <button type="button" class="autoscroll" aria-label="Autoscroll" aria-pressed="true" title="Scroll to the read sentence">${ICONS.autoscroll}</button>
      </label>
    </div>
    <div class="error" role="alert" hidden>
      <span class="message"></span>
      <a class="options" href="#">Open options</a>
      <button type="button" class="retry" aria-label="Retry">Retry</button>
    </div>
  </div>
`;

// Shown while text outside the bar is selected during a session.
const SELECTION_ACTIONS = `
  <button type="button" class="read-from-here" aria-label="Read from here">${ICONS.play}<span>From here</span></button>
  <button type="button" class="read-selection" aria-label="Read selection">${ICONS.play}<span>Selection</span></button>
`;

const PLAYING_STATES = new Set(['playing', 'loading']);

export function createBar({ doc = globalThis.document, onAction = () => {} } = {}) {
  const host = doc.createElement(HOST_TAG);
  host.setAttribute('data-omnivoice-reader', 'bar');
  host.setAttribute('style', HOST_STYLE);
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = TEMPLATE;
  (doc.body || doc.documentElement).appendChild(host);

  const $ = (sel) => root.querySelector(sel);
  const toggle = $('.toggle');
  const voice = $('.voice');
  const speed = $('.speed');
  const speedValue = $('.speed-value');
  const chip = $('.speed-chip');
  const more = $('.more');
  const fold = $('.fold');
  const autoscroll = $('.autoscroll');
  const error = $('.error');
  const message = $('.error .message');
  const player = $('.player');
  const setup = $('.setup');
  const barEl = $('.bar');
  const row = $('.row');
  let selectionActions = null;

  const on = (el, type, fn) => el.addEventListener(type, fn);
  on(toggle, 'click', () => onAction('toggle'));
  on($('.prev'), 'click', (e) => onAction(e.shiftKey ? 'prev-paragraph' : 'prev'));
  on($('.next'), 'click', (e) => onAction(e.shiftKey ? 'next-paragraph' : 'next'));
  on($('.close'), 'click', () => onAction('close'));
  on(autoscroll, 'click', () => {
    const value = autoscroll.getAttribute('aria-pressed') !== 'true';
    setAutoscroll(value);
    onAction('autoscroll', value);
  });
  on($('.retry'), 'click', () => onAction('retry'));
  on($('.setup-engine'), 'click', () => onAction('setup'));
  on($('.options'), 'click', (e) => { e.preventDefault(); onAction('options'); });
  on(voice, 'change', () => onAction('voice', voice.value));
  on(chip, 'click', () => {
    const s = nextSpeed(speed.value);
    setSpeed(s);
    onAction('speed-cycle', s);
  });
  on(more, 'click', () => setFold(more.getAttribute('aria-expanded') !== 'true'));
  on(speed, 'input', () => {
    const s = Math.round(Number(speed.value) * 10) / 10;
    showSpeed(s);
    onAction('speed', s);
  });

  function showSpeed(s) {
    const label = `${Number(s).toFixed(1)}×`;
    speedValue.textContent = label;
    chip.textContent = label;
    chip.setAttribute('aria-label', `Speed ${label}, tap for the next preset`);
  }

  function setFold(open) {
    more.setAttribute('aria-expanded', open ? 'true' : 'false');
    more.innerHTML = open ? ICONS.collapse : ICONS.more;
    if (open) fold.removeAttribute('hidden');
    else fold.setAttribute('hidden', '');
  }

  // 'setup': no engine configured yet; only the setup prompt and × are shown.
  function setState(state, err) {
    const setupMode = state === 'setup';
    if (setupMode) player.setAttribute('hidden', '');
    else player.removeAttribute('hidden');
    if (setupMode) setup.removeAttribute('hidden');
    else setup.setAttribute('hidden', '');
    if (setupMode) setFold(false);
    const playing = PLAYING_STATES.has(state);
    toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    toggle.innerHTML = playing ? ICONS.pause : ICONS.play;
    if (state === 'error') {
      message.textContent = String(err ?? 'Something went wrong');
      error.removeAttribute('hidden');
    } else {
      message.textContent = '';
      error.setAttribute('hidden', '');
    }
  }

  // list === null means the engine gave no voice list: show only the current voice.
  function setVoices(list, current) {
    const ids = list ?? (current ? [current] : []);
    voice.textContent = '';
    for (const id of ids) {
      const opt = doc.createElement('option');
      opt.value = id;
      opt.textContent = id;
      if (id === current) opt.setAttribute('selected', '');
      voice.appendChild(opt);
    }
    if (list === null) voice.setAttribute('disabled', '');
    else voice.removeAttribute('disabled');
  }

  function setSpeed(s) {
    speed.value = String(s);
    showSpeed(s);
  }

  function setAutoscroll(value) {
    autoscroll.setAttribute('aria-pressed', value ? 'true' : 'false');
  }

  // Hosts an element (the player frame) inside the closed shadow root, out of the page's reach.
  function mount(el) {
    root.appendChild(el);
  }

  // Puts the host back if the page removed it (a frame in a detached host never loads).
  // Returns true when it had to.
  function attach() {
    if (host.isConnected) return false;
    (doc.body || doc.documentElement).appendChild(host);
    return true;
  }

  function showSelectionActions(show) {
    if (!show) {
      selectionActions?.remove();
      selectionActions = null;
      return;
    }
    if (selectionActions) return;
    const strip = doc.createElement('div');
    strip.className = 'selection-actions';
    strip.innerHTML = SELECTION_ACTIONS;
    for (const [sel, type] of [['.read-from-here', 'read-from-here'], ['.read-selection', 'read-selection']]) {
      const button = strip.querySelector(sel);
      // Keep the page selection: a press on a button would otherwise clear it before the click.
      on(button, 'mousedown', (e) => e.preventDefault());
      on(button, 'click', () => onAction(type));
    }
    barEl.insertBefore(strip, row);
    selectionActions = strip;
  }

  function destroy() {
    host.remove();
  }

  return { setState, setVoices, setSpeed, setAutoscroll, showSelectionActions, mount, attach, destroy };
}
