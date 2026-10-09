/*
 * Reads the text files the renderer and the desktop app need (in-page
 * scripts, UI). From the source folder normally, or from the files
 * embedded in the single .exe when running as a packaged app.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let sea = null;
try {
  sea = require('node:sea');
  if (!sea.isSea()) sea = null;
} catch (e) {
  sea = null;
}

// name: path relative to the repository root, e.g. 'js/core/inject.js'
function text(name) {
  if (sea) return sea.getAsset(name, 'utf8');
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

function binary(name) {
  if (sea) return Buffer.from(sea.getAsset(name));
  return fs.readFileSync(path.join(ROOT, name));
}

module.exports = { text, binary, packaged: !!sea };
