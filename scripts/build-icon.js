'use strict';

// Generates build/icon.png, the source electron-builder converts into a real
// .ico (Windows) / .icns (macOS) for the packaged app, taskbar, and
// Start-with-Windows entry. Run automatically before `npm run dist`.

const fs = require('fs');
const path = require('path');
const { noteIconPNG } = require('../icon');

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), noteIconPNG(1024));
console.log('Wrote build/icon.png');
