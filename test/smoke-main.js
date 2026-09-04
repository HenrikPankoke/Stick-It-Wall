'use strict';

/*
 * Off-screen integration smoke test.
 * Boots the real renderer in a hidden window, drives it, and verifies the
 * persistence round-trip. Run with:  npx electron test/smoke-main.js
 * Exits 0 on success, 1 on failure. No window is shown.
 */

const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Isolate storage so the test never touches real user data.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'postit-smoke-'));
app.setPath('userData', tmp);

// Load the actual main-process module so the real IPC handlers register.
// It reads app.getPath('userData') lazily inside app.whenReady, so this is safe.
require('../main.js');

const DATA_FILE = path.join(tmp, 'postit-wall.json');
const results = [];
function check(name, cond) {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  // Give main.js's own whenReady (window + tray) a moment to run.
  await sleep(400);

  // Find the window main.js created.
  let win = BrowserWindow.getAllWindows()[0];
  check('main process created a window', !!win);
  if (!win) return finish();

  // Surface renderer errors so failures are diagnosable.
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('  [renderer]', message);
  });

  // Make sure it never shows during the test.
  win.hide();

  // Wait for the renderer boot() to finish rendering.
  await win.webContents.executeJavaScript('new Promise(r=>setTimeout(r,300))');

  let domReport;
  try {
  domReport = await win.webContents.executeJavaScript(`(function(){
    const r = {};
    r.bridge = typeof window.wall === 'object'
      && typeof window.wall.save === 'function'
      && typeof window.wall.setIgnoreMouse === 'function';
    r.patterns = !!(window.BG_PATTERNS && window.BG_PATTERNS.cork && window.BG_PATTERNS.slate);
    r.addFns = typeof window.addNote === 'function' && typeof window.addHeader === 'function';

    // Create a header and a note via the real code paths.
    const h = window.addHeader(120, 60, { title: 'Sprint' });
    const n = window.addNote(200, 200, { title: 'First', description: 'hello', tag: 'todo' });
    r.noteCount = document.querySelectorAll('#wall .note').length;
    r.headerCount = document.querySelectorAll('#wall .header').length;

    // Edit the note title through the DOM (contenteditable + input event).
    const titleEl = document.querySelector('.note[data-id="'+n.id+'"] .note-title');
    titleEl.textContent = 'Edited title';
    titleEl.dispatchEvent(new Event('input', { bubbles: true }));

    // Link the note to the header, then verify a connector line renders.
    n.headerId = h.id;
    window.render();
    r.linkLines = document.querySelectorAll('#links line').length;

    // Background switch to a pattern should mark the body.
    return window.wall.setSettings({ background: { type: 'pattern', value: 'cork', opacity: 1 } })
      .then(function(){ return r; });
  })()`);
  } catch (err) {
    console.error('  drive script threw:', err && err.message ? err.message : err);
    return finish();
  }

  check('context bridge exposed', domReport.bridge);
  check('tileable background patterns loaded', domReport.patterns);
  check('note/header factory functions global', domReport.addFns);
  check('one note rendered', domReport.noteCount === 1);
  check('one header rendered', domReport.headerCount === 1);
  check('link connector line drawn', domReport.linkLines === 1);

  // Force an immediate persist rather than waiting on the debounce.
  await win.webContents.executeJavaScript('window.flushSave()');
  await sleep(400);

  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) {}
  check('data file written', !!saved);
  check('note persisted', !!(saved && saved.notes && saved.notes.length === 1));
  check('header persisted', !!(saved && saved.headers && saved.headers.length === 1));
  check('edited title persisted', !!(saved && saved.notes && saved.notes[0] && saved.notes[0].title === 'Edited title'));
  check('link persisted', !!(saved && saved.notes && saved.notes[0] && saved.headers && saved.headers[0] && saved.headers[0].id === saved.notes[0].headerId));
  check('background setting persisted', !!(saved && saved.settings && saved.settings.background && saved.settings.background.value === 'cork'));

  // ---- Phase 2: reload (simulates restart) restores from disk ----
  win.webContents.reload();
  await win.webContents.executeJavaScript('new Promise(r=>setTimeout(r,500))');
  const restored = await win.webContents.executeJavaScript(
    'JSON.stringify({notes: document.querySelectorAll("#wall .note").length,' +
    ' headers: document.querySelectorAll("#wall .header").length,' +
    ' title: (document.querySelector(".note-title")||{}).textContent,' +
    ' bg: getComputedStyle(document.getElementById("bg-layer")).backgroundImage.slice(0,10)})'
  );
  const rr = JSON.parse(restored);
  check('note restored after reload', rr.notes === 1);
  check('header restored after reload', rr.headers === 1);
  check('note content restored', rr.title === 'Edited title');
  check('background restored (pattern painted)', rr.bg.startsWith('url'));

  // ---- Phase 3: delete round-trip ----
  await win.webContents.executeJavaScript(
    'window.deleteItem(document.querySelector(".note").dataset.id); window.flushSave();'
  );
  await sleep(400);
  let after = null;
  try { after = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) {}
  check('delete removed note from disk', !!(after && after.notes && after.notes.length === 0));
  check('delete kept the header', !!(after && after.headers && after.headers.length === 1));

  finish();
});

function finish() {
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  try { app.removeAllListeners('window-all-closed'); } catch (_) {}
  app.exit(failed.length ? 1 : 0);
}

// Safety timeout.
setTimeout(() => { console.error('Smoke test timed out.'); app.exit(2); }, 15000);
