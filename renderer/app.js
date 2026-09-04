'use strict';

/* ==========================================================================
   Post-It Wall — renderer logic
   ========================================================================== */

const NOTE_COLORS = ['#ffd94a', '#ffb3ba', '#bae1ff', '#b5e7a0', '#ffcf9e', '#e0bbff', '#ffffff', '#c8c8c8'];
const HEADER_COLORS = ['#4a90d9', '#e0574a', '#3fae6b', '#c9862f', '#7d5fbf', '#3a3f47'];
const INTERACTIVE = '.note, .header, .note-tools, .header-tools, .floatbar, .tool, .panel, .ctx, .grip, .welcome, .modal-overlay';

// DOM refs
const wallEl = document.getElementById('wall');
const bgLayer = document.getElementById('bg-layer');
const linksSvg = document.getElementById('links');
const outline = document.getElementById('window-outline');
const hotTL = document.getElementById('hotzone-tl');
const hotTR = document.getElementById('hotzone-tr');
const ctxMenu = document.getElementById('context-menu');
const panel = document.getElementById('settings-panel');

// State
let doc = { settings: {}, notes: [], headers: [] };
let selectedId = null;         // id of selected note or header
let linkingFrom = null;        // note id waiting to link to a header
let saveTimer = null;

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 250);
}

function flushSave() {
  clearTimeout(saveTimer);
  window.wall.save({ notes: doc.notes, headers: doc.headers, settings: doc.settings });
}

// Best-effort flush if the window is closed within the debounce window.
window.addEventListener('beforeunload', flushSave);

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// Keep an item of size w×h fully inside the window, anchored to the top-left.
function clampPos(x, y, w, h) {
  return {
    x: Math.round(clamp(x, 0, Math.max(0, window.innerWidth - w))),
    y: Math.round(clamp(y, 0, Math.max(0, window.innerHeight - h)))
  };
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function transparentMode() { return (doc.settings.background && doc.settings.background.type === 'none'); }
function effectiveClickThrough() { return transparentMode() && !!doc.settings.clickThrough; }

/* -------------------------------------------------------------------------- */
/* Background                                                                 */
/* -------------------------------------------------------------------------- */
async function applyBackground() {
  const bg = doc.settings.background || { type: 'none' };
  const op = (typeof bg.opacity === 'number') ? bg.opacity : 1;
  bgLayer.style.opacity = String(op);
  bgLayer.style.background = 'transparent';
  bgLayer.style.backgroundSize = 'auto';
  bgLayer.style.backgroundRepeat = 'repeat';

  if (bg.type === 'pattern' && window.BG_PATTERNS[bg.value]) {
    bgLayer.style.backgroundImage = window.BG_PATTERNS[bg.value].css;
    bgLayer.style.backgroundRepeat = 'repeat';
  } else if (bg.type === 'color') {
    bgLayer.style.background = bg.value || '#1e3a5f';
  } else if (bg.type === 'image' && bg.value) {
    const url = await window.wall.backgroundUrl(bg.value);
    if (url) {
      bgLayer.style.backgroundImage = `url("${url}")`;
      if (bg.fit === 'cover') {
        bgLayer.style.backgroundSize = 'cover';
        bgLayer.style.backgroundRepeat = 'no-repeat';
        bgLayer.style.backgroundPosition = 'center';
      } else {
        bgLayer.style.backgroundRepeat = 'repeat';
        bgLayer.style.backgroundSize = 'auto';
      }
    }
  } else {
    // none / transparent
    bgLayer.style.backgroundImage = 'none';
  }

  document.body.classList.toggle('transparent', transparentMode());
  document.body.classList.toggle('has-bg', !transparentMode());
  updateIgnoreMouse(true);
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */
function render() {
  renderHeaders();
  renderNotes();
  renderLinks();
}

function renderNotes() {
  // remove notes no longer present
  wallEl.querySelectorAll('.note').forEach(el => {
    if (!doc.notes.find(n => n.id === el.dataset.id)) el.remove();
  });
  doc.notes.forEach(n => {
    let el = wallEl.querySelector(`.note[data-id="${n.id}"]`);
    if (!el) el = createNoteEl(n);
    syncNoteEl(el, n);
  });
}

function createNoteEl(n) {
  const el = document.createElement('div');
  el.className = 'note';
  el.dataset.id = n.id;
  el.innerHTML = `
    <div class="note-tools">
      ${NOTE_COLORS.map(c => `<span class="swatch" data-color="${c}" style="background:${c}"></span>`).join('')}
      <span class="divider"></span>
      <button data-act="anchor" title="Anchor / unlock">📌</button>
      <button data-act="link" title="Link to header">🔗</button>
      <button data-act="dup" title="Duplicate">⧉</button>
      <button data-act="del" title="Delete">🗑</button>
    </div>
    <div class="note-head"><div class="note-title" contenteditable="true" spellcheck="false"></div></div>
    <div class="note-body" contenteditable="true" spellcheck="false"></div>
    <div class="note-foot">
      <span class="note-tag" contenteditable="true" spellcheck="false"></span>
      <span class="note-date"></span>
    </div>
    <div class="note-resize" title="Resize"></div>`;
  wallEl.appendChild(el);
  wireNote(el, n);
  return el;
}

function syncNoteEl(el, n) {
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';
  el.style.width = n.width + 'px';
  el.style.height = n.height + 'px';
  el.style.background = n.color;
  el.style.setProperty('--rot', (n.rot || 0) + 'deg');
  el.classList.toggle('anchored', !!n.anchored);
  el.classList.toggle('selected', selectedId === n.id);
  const title = el.querySelector('.note-title');
  const body = el.querySelector('.note-body');
  const tag = el.querySelector('.note-tag');
  if (document.activeElement !== title) title.textContent = n.title || '';
  if (document.activeElement !== body) body.textContent = n.description || '';
  if (document.activeElement !== tag) tag.textContent = n.tag || '';
  el.querySelector('.note-date').textContent = fmtDate(n.updatedAt || n.createdAt);
}

function renderHeaders() {
  wallEl.querySelectorAll('.header').forEach(el => {
    if (!doc.headers.find(h => h.id === el.dataset.id)) el.remove();
  });
  doc.headers.forEach(h => {
    let el = wallEl.querySelector(`.header[data-id="${h.id}"]`);
    if (!el) el = createHeaderEl(h);
    syncHeaderEl(el, h);
  });
}

function createHeaderEl(h) {
  const el = document.createElement('div');
  el.className = 'header';
  el.dataset.id = h.id;
  el.innerHTML = `
    <div class="header-tools">
      ${HEADER_COLORS.map(c => `<span class="swatch" data-color="${c}" style="background:${c}"></span>`).join('')}
      <span class="divider"></span>
      <button data-act="anchor" title="Anchor / unlock">📌</button>
      <button data-act="del" title="Delete">🗑</button>
    </div>
    <div class="header-text" contenteditable="true" spellcheck="false"></div>`;
  wallEl.appendChild(el);
  wireHeader(el, h);
  return el;
}

function syncHeaderEl(el, h) {
  el.style.left = h.x + 'px';
  el.style.top = h.y + 'px';
  el.style.background = h.color;
  el.classList.toggle('anchored', !!h.anchored);
  el.classList.toggle('selected', selectedId === h.id);
  const txt = el.querySelector('.header-text');
  if (document.activeElement !== txt) txt.textContent = h.title || '';
}

function centerOf(item, el) {
  return { x: item.x + el.offsetWidth / 2, y: item.y + el.offsetHeight / 2 };
}

function renderLinks() {
  linksSvg.setAttribute('width', window.innerWidth);
  linksSvg.setAttribute('height', window.innerHeight);
  let out = '';
  doc.notes.forEach(n => {
    if (!n.headerId) return;
    const h = doc.headers.find(x => x.id === n.headerId);
    if (!h) return;
    const nEl = wallEl.querySelector(`.note[data-id="${n.id}"]`);
    const hEl = wallEl.querySelector(`.header[data-id="${h.id}"]`);
    if (!nEl || !hEl) return;
    const a = centerOf(h, hEl);
    const b = centerOf(n, nEl);
    out += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
  });
  linksSvg.innerHTML = out;
}

/* -------------------------------------------------------------------------- */
/* Model mutation helpers                                                     */
/* -------------------------------------------------------------------------- */
function getNote(id) { return doc.notes.find(n => n.id === id); }
function getHeader(id) { return doc.headers.find(h => h.id === id); }
function touch(n) { n.updatedAt = Date.now(); }

function addNote(x, y, patch = {}) {
  const n = {
    id: uid(), title: '', description: '', tag: '',
    color: NOTE_COLORS[0], x: Math.round(x), y: Math.round(y),
    width: 190, height: 150, rot: (Math.random() * 3 - 1.5),
    anchored: false, headerId: null,
    createdAt: Date.now(), updatedAt: Date.now(), ...patch
  };
  const p = clampPos(n.x, n.y, n.width, n.height);
  n.x = p.x; n.y = p.y;
  doc.notes.push(n);
  render();
  select(n.id);
  persist();
  const el = wallEl.querySelector(`.note[data-id="${n.id}"] .note-title`);
  if (el) el.focus();
  return n;
}

function addHeader(x, y, patch = {}) {
  const h = {
    id: uid(), title: 'Header', color: HEADER_COLORS[0],
    x: Math.round(x), y: Math.round(y), anchored: false,
    createdAt: Date.now(), ...patch
  };
  doc.headers.push(h);
  render();
  const el = wallEl.querySelector(`.header[data-id="${h.id}"]`);
  if (el) {
    const p = clampPos(h.x, h.y, el.offsetWidth, el.offsetHeight);
    h.x = p.x; h.y = p.y; el.style.left = h.x + 'px'; el.style.top = h.y + 'px';
  }
  select(h.id);
  persist();
  return h;
}

function deleteItem(id) {
  const item = getNote(id) || getHeader(id);
  if (!item) return;
  // Anchored items are "locked in place" on purpose, so confirm before removing.
  if (item.anchored) {
    const kind = getNote(id) ? 'note' : 'header';
    confirmModal(`This ${kind} is anchored (locked). Delete it anyway?`, () => doDelete(id));
    return;
  }
  doDelete(id);
}

function doDelete(id) {
  const before = doc.notes.length + doc.headers.length;
  doc.notes = doc.notes.filter(n => n.id !== id);
  doc.headers = doc.headers.filter(h => h.id !== id);
  // unlink notes that pointed at a deleted header
  doc.notes.forEach(n => { if (n.headerId === id) n.headerId = null; });
  if (doc.notes.length + doc.headers.length !== before) {
    if (selectedId === id) selectedId = null;
    render();
    persist();
  }
}

function select(id) {
  selectedId = id;
  wallEl.querySelectorAll('.selected').forEach(e => e.classList.remove('selected'));
  if (id) {
    const el = wallEl.querySelector(`[data-id="${id}"]`);
    if (el) el.classList.add('selected');
  }
}

/* -------------------------------------------------------------------------- */
/* Dragging (notes & headers)                                                 */
/* -------------------------------------------------------------------------- */
const DRAG_THRESHOLD = 4;

function beginDrag(e, item, el, kind) {
  if (item.anchored) return;
  const startX = e.clientX, startY = e.clientY;
  const originX = item.x, originY = item.y;
  let dragging = false;

  // For headers: capture linked notes so they move together.
  const linked = kind === 'header'
    ? doc.notes.filter(n => n.headerId === item.id).map(n => ({ n, ox: n.x, oy: n.y }))
    : [];

  function move(ev) {
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      blurEditing();
      if (transparentMode()) outline.hidden = false;
    }
    const p = clampPos(originX + dx, originY + dy, el.offsetWidth, el.offsetHeight);
    item.x = p.x; item.y = p.y;
    el.style.left = item.x + 'px';
    el.style.top = item.y + 'px';
    linked.forEach(({ n, ox, oy }) => {
      const nEl = wallEl.querySelector(`.note[data-id="${n.id}"]`);
      const q = clampPos(ox + dx, oy + dy,
        nEl ? nEl.offsetWidth : n.width, nEl ? nEl.offsetHeight : n.height);
      n.x = q.x; n.y = q.y;
      if (nEl) { nEl.style.left = n.x + 'px'; nEl.style.top = n.y + 'px'; }
    });
    renderLinks();
  }

  function up(ev) {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    outline.hidden = true;
    if (dragging) {
      if (kind === 'note') touch(item);
      linked.forEach(({ n }) => touch(n));
      persist();
    } else {
      // treated as a click — allow editing the field that was clicked
      const t = e.target;
      if (t && t.isContentEditable) placeCaret(t, e.clientX, e.clientY);
    }
  }

  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function placeCaret(el, x, y) {
  el.focus();
  try {
    const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    if (r) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  } catch (_) { /* ignore */ }
}

function blurEditing() {
  const a = document.activeElement;
  if (a && a.isContentEditable) a.blur();
}

/* -------------------------------------------------------------------------- */
/* Note wiring                                                                */
/* -------------------------------------------------------------------------- */
function wireNote(el, ref) {
  const idOf = () => el.dataset.id;

  // The whole note is a drag handle. The click-vs-drag threshold in beginDrag
  // means a plain click still lands the caret in whatever field was clicked
  // (title / body / tag), while any real movement moves the note — so it can be
  // grabbed from anywhere on the note, not just the title bar.
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.note-tools') || e.target.closest('.note-resize')) return;
    const n = getNote(idOf());
    if (!n) return;
    if (document.body.classList.contains('linking')) return;
    select(n.id);
    beginDrag(e, n, el, 'note');
  });

  // Inline editing → model
  const title = el.querySelector('.note-title');
  const body = el.querySelector('.note-body');
  const tag = el.querySelector('.note-tag');
  title.addEventListener('input', () => { const n = getNote(idOf()); if (n) { n.title = title.textContent; touch(n); persist(); } });
  body.addEventListener('input', () => { const n = getNote(idOf()); if (n) { n.description = body.textContent; touch(n); persist(); } });
  tag.addEventListener('input', () => { const n = getNote(idOf()); if (n) { n.tag = tag.textContent; touch(n); persist(); } });

  // Toolbar
  el.querySelector('.note-tools').addEventListener('click', (e) => {
    const n = getNote(idOf());
    if (!n) return;
    const sw = e.target.closest('.swatch');
    if (sw) { n.color = sw.dataset.color; touch(n); render(); persist(); return; }
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'anchor') { n.anchored = !n.anchored; render(); persist(); }
    else if (act === 'del') { deleteItem(n.id); }
    else if (act === 'dup') { addNote(n.x + 24, n.y + 24, { title: n.title, description: n.description, tag: n.tag, color: n.color, width: n.width, height: n.height }); }
    else if (act === 'link') { toggleLink(n); }
  });

  // Resize
  el.querySelector('.note-resize').addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const n = getNote(idOf());
    if (!n) return;
    const sx = e.clientX, sy = e.clientY, sw = n.width, sh = n.height;
    if (transparentMode()) outline.hidden = false;
    function move(ev) {
      // Clamp so the note cannot grow past the right/bottom window edges.
      const maxW = Math.max(120, window.innerWidth - n.x);
      const maxH = Math.max(90, window.innerHeight - n.y);
      n.width = clamp(Math.round(sw + (ev.clientX - sx)), 120, maxW);
      n.height = clamp(Math.round(sh + (ev.clientY - sy)), 90, maxH);
      el.style.width = n.width + 'px';
      el.style.height = n.height + 'px';
      renderLinks();
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      outline.hidden = true;
      touch(n); persist();
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function toggleLink(n) {
  if (n.headerId) {
    n.headerId = null; render(); persist();
    return;
  }
  if (doc.headers.length === 0) {
    flash('Create a header first, then link.');
    return;
  }
  linkingFrom = n.id;
  document.body.classList.add('linking');
  flash('Click a header to link this note (Esc to cancel).');
}

/* -------------------------------------------------------------------------- */
/* Header wiring                                                              */
/* -------------------------------------------------------------------------- */
function wireHeader(el, ref) {
  const idOf = () => el.dataset.id;

  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const h = getHeader(idOf());
    if (!h) return;
    if (document.body.classList.contains('linking') && linkingFrom) {
      const n = getNote(linkingFrom);
      if (n) { n.headerId = h.id; touch(n); render(); persist(); }
      cancelLinking();
      e.stopPropagation();
      return;
    }
    select(h.id);
    if (!e.target.closest('.header-tools') && !e.target.classList.contains('header-text')) {
      beginDrag(e, h, el, 'header');
    } else if (e.target.classList.contains('header-text')) {
      beginDrag(e, h, el, 'header'); // threshold: click still edits, drag moves
    }
  });

  const txt = el.querySelector('.header-text');
  txt.addEventListener('input', () => { const h = getHeader(idOf()); if (h) { h.title = txt.textContent; persist(); renderLinks(); } });

  el.querySelector('.header-tools').addEventListener('click', (e) => {
    const h = getHeader(idOf());
    if (!h) return;
    const sw = e.target.closest('.swatch');
    if (sw) { h.color = sw.dataset.color; render(); persist(); return; }
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'anchor') { h.anchored = !h.anchored; render(); persist(); }
    else if (act === 'del') { deleteItem(h.id); }
  });
}

function cancelLinking() {
  linkingFrom = null;
  document.body.classList.remove('linking');
}

/* -------------------------------------------------------------------------- */
/* Wall interactions                                                          */
/* -------------------------------------------------------------------------- */
wallEl.addEventListener('mousedown', (e) => {
  if (e.target === wallEl) {
    if (document.body.classList.contains('linking')) { cancelLinking(); return; }
    select(null);
    hideContext();
  }
});

wallEl.addEventListener('dblclick', (e) => {
  if (e.target !== wallEl) return;
  addNote(e.clientX - 95, e.clientY - 75);
});

// Right-click context menu
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const noteEl = e.target.closest('.note');
  const headerEl = e.target.closest('.header');
  if (noteEl) return showNoteContext(e, noteEl.dataset.id);
  if (headerEl) return showHeaderContext(e, headerEl.dataset.id);
  showWallContext(e);
});

// How many items currently sit outside the visible window (possible after the
// window is shrunk, since resizing no longer moves content).
function offscreenCount() {
  const W = window.innerWidth, H = window.innerHeight;
  let c = 0;
  [...doc.notes, ...doc.headers].forEach(it => {
    const el = wallEl.querySelector(`[data-id="${it.id}"]`);
    const w = el ? el.offsetWidth : (it.width || 100);
    const h = el ? el.offsetHeight : (it.height || 40);
    if (it.x >= W || it.y >= H || it.x + w <= 0 || it.y + h <= 0) c++;
  });
  return c;
}

function showWallContext(e) {
  const x = e.clientX, y = e.clientY;
  const nN = doc.notes.length, nH = doc.headers.length, off = offscreenCount();
  const info = [`${nN} note${nN !== 1 ? 's' : ''}, ${nH} header${nH !== 1 ? 's' : ''}`];
  if (off > 0) info.push(`${off} off-screen — resize window to reveal`);
  buildContext([
    { info },
    { sep: true },
    { label: '＋  Add note here', act: () => addNote(x - 95, y - 75) },
    { label: 'H  Add header here', act: () => addHeader(x, y) },
    { sep: true },
    { label: '⚙  Settings', act: openSettings }
  ], x, y);
}

function showNoteContext(e, id) {
  const n = getNote(id); if (!n) return;
  select(id);
  buildContext([
    { swatches: NOTE_COLORS, pick: (c) => { n.color = c; touch(n); render(); persist(); } },
    { label: n.anchored ? '📌  Unanchor' : '📌  Anchor', act: () => { n.anchored = !n.anchored; render(); persist(); } },
    { label: n.headerId ? '🔗  Unlink from header' : '🔗  Link to header…', act: () => toggleLink(n) },
    { label: '⧉  Duplicate', act: () => addNote(n.x + 24, n.y + 24, { title: n.title, description: n.description, tag: n.tag, color: n.color, width: n.width, height: n.height }) },
    { sep: true },
    { label: '🗑  Delete', act: () => deleteItem(id) }
  ], e.clientX, e.clientY);
}

function showHeaderContext(e, id) {
  const h = getHeader(id); if (!h) return;
  select(id);
  buildContext([
    { swatches: HEADER_COLORS, pick: (c) => { h.color = c; render(); persist(); } },
    { label: h.anchored ? '📌  Unanchor' : '📌  Anchor', act: () => { h.anchored = !h.anchored; render(); persist(); } },
    { sep: true },
    { label: '🗑  Delete', act: () => deleteItem(id) }
  ], e.clientX, e.clientY);
}

function buildContext(items, x, y) {
  ctxMenu.innerHTML = '';
  items.forEach(it => {
    if (it.sep) { const d = document.createElement('div'); d.className = 'sep'; ctxMenu.appendChild(d); return; }
    if (it.info) {
      const d = document.createElement('div'); d.className = 'ctx-info';
      it.info.forEach(line => { const r = document.createElement('div'); r.textContent = line; d.appendChild(r); });
      ctxMenu.appendChild(d); return;
    }
    if (it.swatches) {
      const row = document.createElement('div'); row.className = 'swrow';
      it.swatches.forEach(c => {
        const s = document.createElement('span'); s.className = 'swatch'; s.style.background = c;
        s.addEventListener('click', () => { it.pick(c); hideContext(); });
        row.appendChild(s);
      });
      ctxMenu.appendChild(row); return;
    }
    const b = document.createElement('button');
    b.textContent = it.label;
    b.addEventListener('click', () => { it.act(); hideContext(); });
    ctxMenu.appendChild(b);
  });
  ctxMenu.hidden = false;
  const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
  ctxMenu.style.left = clamp(x, 4, window.innerWidth - w - 4) + 'px';
  ctxMenu.style.top = clamp(y, 4, window.innerHeight - h - 4) + 'px';
}
function hideContext() { ctxMenu.hidden = true; }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.ctx')) hideContext(); });

/* -------------------------------------------------------------------------- */
/* Keyboard                                                                   */
/* -------------------------------------------------------------------------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.body.classList.contains('linking')) return cancelLinking();
    if (!panel.hidden) return closeSettings();
    hideContext();
    return;
  }
  const editing = document.activeElement && document.activeElement.isContentEditable;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editing) {
    e.preventDefault();
    deleteItem(selectedId);
  }
});

/* -------------------------------------------------------------------------- */
/* Window resize grips                                                        */
/* -------------------------------------------------------------------------- */
document.querySelectorAll('.grip').forEach(g => {
  g.addEventListener('mousedown', async (e) => {
    e.preventDefault();

    // Notes clamp flush to the window edges, so a note can sit under this edge
    // grip. If one does, grab the note instead of resizing the window — that's
    // what lets a note be moved by the side that touches the window border.
    g.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    g.style.pointerEvents = '';
    const itemEl = under && under.closest('.note, .header');
    if (itemEl && !document.body.classList.contains('linking')) {
      const id = itemEl.dataset.id;
      const item = getNote(id) || getHeader(id);
      if (item) {
        select(id);
        beginDrag(e, item, itemEl, getNote(id) ? 'note' : 'header');
        return;
      }
    }

    const dir = g.dataset.dir;
    const start = await window.wall.getBounds();
    if (!start) return;
    const sx = e.screenX, sy = e.screenY;
    if (transparentMode()) outline.hidden = false;
    let raf = null, pending = null;

    function apply() {
      raf = null;
      if (pending) { window.wall.setBounds(pending); pending = null; }
    }
    function move(ev) {
      const dx = ev.screenX - sx, dy = ev.screenY - sy;
      let { x, y, width, height } = start;
      if (dir.includes('e')) width = start.width + dx;
      if (dir.includes('s')) height = start.height + dy;
      if (dir.includes('w')) { width = start.width - dx; x = start.x + dx; }
      if (dir.includes('n')) { height = start.height - dy; y = start.y + dy; }
      if (width < 320) { if (dir.includes('w')) x = start.x + (start.width - 320); width = 320; }
      if (height < 240) { if (dir.includes('n')) y = start.y + (start.height - 240); height = 240; }
      pending = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
      if (!raf) raf = requestAnimationFrame(apply);
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (raf) cancelAnimationFrame(raf);
      if (pending) window.wall.setBounds(pending);
      outline.hidden = true;
      renderLinks();
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
});

// Resizing the window never moves content: notes/headers keep their positions
// (they may be hidden when the window shrinks, and reappear when it grows back).
// We only resize the link canvas and redraw the connectors.
window.addEventListener('resize', () => { renderLinks(); });

/* -------------------------------------------------------------------------- */
/* Click-through + toolbar reveal                                             */
/* -------------------------------------------------------------------------- */
let ignoreState = null;      // last value sent to main
let forceInteractive = false;

function setIgnore(ignore) {
  if (ignore === ignoreState) return;
  ignoreState = ignore;
  window.wall.setIgnoreMouse(ignore, ignore ? { forward: true } : {});
}

function updateIgnoreMouse(force) {
  if (!effectiveClickThrough()) { setIgnore(false); return; }
  // Start click-through immediately; the next mousemove refines it per-element.
  if (force) { ignoreState = null; setIgnore(true); }
}

document.addEventListener('mousemove', (e) => {
  const x = e.clientX, y = e.clientY;

  // toolbar reveal (position-driven so it also works while click-through)
  const inTL = x < 406 && y < 74;
  const inTR = x > window.innerWidth - 96 && y < 48;
  hotTL.classList.toggle('pinned', inTL || !panel.hidden);
  hotTR.classList.toggle('pinned', inTR);

  if (!effectiveClickThrough()) { setIgnore(false); return; }
  if (forceInteractive) { setIgnore(false); return; }

  const el = document.elementFromPoint(x, y);
  const interactive = !!(el && el.closest(INTERACTIVE)) || inTL || inTR;
  setIgnore(!interactive);
}, true);

// While any drag/resize is happening we must keep the window interactive.
document.addEventListener('mousedown', () => { forceInteractive = true; setIgnore(false); });
document.addEventListener('mouseup', () => { forceInteractive = false; });

/* -------------------------------------------------------------------------- */
/* Toolbar buttons                                                            */
/* -------------------------------------------------------------------------- */
document.getElementById('btn-add-note').addEventListener('click', () => {
  addNote(window.innerWidth / 2 - 95, window.innerHeight / 2 - 75);
});
document.getElementById('btn-add-header').addEventListener('click', () => {
  addHeader(window.innerWidth / 2 - 40, 60);
});
document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('btn-minimize').addEventListener('click', () => window.wall.minimize());
document.getElementById('btn-close').addEventListener('click', () => window.wall.closeApp());

/* -------------------------------------------------------------------------- */
/* Window position/size presets ("wall 1..5")                                 */
/* -------------------------------------------------------------------------- */
const presetBtns = Array.from(document.querySelectorAll('.preset-btn'));
let activePresetSlot = null;   // slot index the current window bounds match, or null

function syncPresetButtons() {
  const presets = Array.isArray(doc.settings.windowPresets) ? doc.settings.windowPresets : [];
  presetBtns.forEach(btn => {
    const i = Number(btn.dataset.slot);
    btn.classList.toggle('has-preset', !!presets[i]);
    btn.classList.toggle('active', activePresetSlot === i);
  });
}

function boundsEqual(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

async function detectActivePreset() {
  const bounds = await window.wall.getBounds();
  const presets = Array.isArray(doc.settings.windowPresets) ? doc.settings.windowPresets : [];
  const i = presets.findIndex(p => boundsEqual(p, bounds));
  activePresetSlot = i === -1 ? null : i;
  syncPresetButtons();
}

window.wall.onBoundsDirty(() => { activePresetSlot = null; syncPresetButtons(); });

presetBtns.forEach(btn => {
  btn.addEventListener('click', async (e) => {
    const slot = Number(btn.dataset.slot);
    if (e.ctrlKey || e.metaKey) {
      const preset = await window.wall.savePreset(slot);
      if (preset) {
        doc.settings.windowPresets = doc.settings.windowPresets || [null, null, null, null, null];
        doc.settings.windowPresets[slot] = preset;
        activePresetSlot = slot;
        syncPresetButtons();
        flash(`Saved current window as wall ${slot + 1}`);
      }
    } else {
      const target = await window.wall.loadPreset(slot);
      if (target) {
        doc.settings.windowPresets = doc.settings.windowPresets || [null, null, null, null, null];
        activePresetSlot = slot;
        syncPresetButtons();
        flash(`Switched to wall ${slot + 1}`);
      } else {
        flash(`Wall ${slot + 1} is empty — Ctrl+click to save the current window here.`);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Settings panel                                                             */
/* -------------------------------------------------------------------------- */
const setBgType = document.getElementById('set-bg-type');
const setPattern = document.getElementById('set-pattern');
const setFit = document.getElementById('set-fit');
const setColor = document.getElementById('set-color');
const setOpacity = document.getElementById('set-opacity');
const opacityVal = document.getElementById('opacity-val');
const setClickThrough = document.getElementById('set-clickthrough');

function openSettings() { syncSettingsUI(); panel.hidden = false; hotTL.classList.add('pinned'); }
function closeSettings() { panel.hidden = true; }
document.getElementById('settings-close').addEventListener('click', closeSettings);
document.addEventListener('mousedown', (e) => { if (!panel.hidden && !e.target.closest('#settings-panel') && !e.target.closest('#btn-settings')) closeSettings(); });

function syncSettingsUI() {
  const bg = doc.settings.background || {};
  setBgType.value = bg.type || 'none';
  setPattern.value = (bg.type === 'pattern') ? bg.value : 'cork';
  setFit.value = bg.fit || 'tile';
  if (bg.type === 'color') setColor.value = bg.value || '#1e3a5f';
  const op = Math.round(((typeof bg.opacity === 'number') ? bg.opacity : 1) * 100);
  setOpacity.value = op; opacityVal.textContent = op + '%';
  setClickThrough.checked = !!doc.settings.clickThrough;
  document.getElementById('field-pattern').style.display = (bg.type === 'pattern') ? '' : 'none';
  document.getElementById('field-image').style.display = (bg.type === 'image') ? '' : 'none';
  document.getElementById('field-color').style.display = (bg.type === 'color') ? '' : 'none';
  document.getElementById('field-opacity').style.display = (bg.type === 'none') ? 'none' : '';
  document.getElementById('field-clickthrough').style.display = (bg.type === 'none') ? '' : 'none';
  document.getElementById('clickthrough-hint').style.display = (bg.type === 'none') ? '' : 'none';
}

async function commitBg(patch) {
  doc.settings.background = { ...doc.settings.background, ...patch };
  await window.wall.setSettings({ background: doc.settings.background });
  await applyBackground();
  syncSettingsUI();
}

setBgType.addEventListener('change', () => {
  const t = setBgType.value;
  if (t === 'pattern') commitBg({ type: 'pattern', value: setPattern.value || 'cork' });
  else if (t === 'color') commitBg({ type: 'color', value: setColor.value });
  else if (t === 'none') commitBg({ type: 'none' });
  else if (t === 'image') {
    if (doc.settings.background.type === 'image' && doc.settings.background.value) commitBg({ type: 'image' });
    else pickImage();
  }
});
setPattern.addEventListener('change', () => commitBg({ type: 'pattern', value: setPattern.value }));
setFit.addEventListener('change', () => commitBg({ fit: setFit.value }));
setColor.addEventListener('input', () => commitBg({ type: 'color', value: setColor.value }));
setOpacity.addEventListener('input', () => {
  opacityVal.textContent = setOpacity.value + '%';
  commitBg({ opacity: Number(setOpacity.value) / 100 });
});
document.getElementById('set-pick-image').addEventListener('click', pickImage);
setClickThrough.addEventListener('change', async () => {
  doc.settings.clickThrough = setClickThrough.checked;
  await window.wall.setSettings({ clickThrough: doc.settings.clickThrough });
  updateIgnoreMouse(true);
});

async function pickImage() {
  const s = await window.wall.pickBackground();
  if (s) { doc.settings = { ...doc.settings, ...s }; await applyBackground(); syncSettingsUI(); }
}

/* -------------------------------------------------------------------------- */
/* Transient toast                                                            */
/* -------------------------------------------------------------------------- */
let toastEl = null, toastTimer = null;
function flash(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    Object.assign(toastEl.style, {
      position: 'fixed', bottom: '18px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(28,30,36,.95)', color: '#eee', padding: '8px 14px',
      borderRadius: '8px', fontSize: '13px', zIndex: 95, pointerEvents: 'none',
      boxShadow: '0 8px 24px rgba(0,0,0,.4)'
    });
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, 2200);
}

/* -------------------------------------------------------------------------- */
/* Confirmation modal                                                         */
/* -------------------------------------------------------------------------- */
function confirmModal(message, onYes) {
  hideContext();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <p class="modal-msg"></p>
      <div class="modal-actions">
        <button class="mini ghost" data-a="no">Cancel</button>
        <button class="mini danger" data-a="yes">Delete</button>
      </div>
    </div>`;
  overlay.querySelector('.modal-msg').textContent = message;
  document.body.appendChild(overlay);
  const yes = overlay.querySelector('[data-a="yes"]');
  yes.focus();
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(); onYes(); }
  }
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-a="no"]').addEventListener('click', close);
  yes.addEventListener('click', () => { close(); onYes(); });
}

/* -------------------------------------------------------------------------- */
/* Main-process events                                                        */
/* -------------------------------------------------------------------------- */
window.wall.onSettingsChanged(async (s) => {
  doc.settings = { ...doc.settings, ...s };
  await applyBackground();
  syncPresetButtons();
  if (!panel.hidden) syncSettingsUI();
});
window.wall.onAddNote(() => addNote(window.innerWidth / 2 - 95, window.innerHeight / 2 - 75));
window.wall.onAddHeader(() => addHeader(window.innerWidth / 2 - 40, 60));

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */
(async function boot() {
  const loaded = await window.wall.load();
  doc = {
    settings: loaded.settings || {},
    notes: Array.isArray(loaded.notes) ? loaded.notes : [],
    headers: Array.isArray(loaded.headers) ? loaded.headers : []
  };
  await applyBackground();
  render();
  await detectActivePreset();

  if (doc.notes.length === 0 && doc.headers.length === 0) {
    const w = document.getElementById('welcome');
    w.hidden = false;
    document.getElementById('welcome-dismiss').addEventListener('click', () => { w.hidden = true; });
  }
})();
