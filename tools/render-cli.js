#!/usr/bin/env node
/*
 * Command-line version of the renderer (handy for testing outside Premiere).
 *   node tools/render-cli.js page.html out-folder [--fps 30] [--duration 5]
 *        [--width 1920|auto] [--height 1080] [--mode objects|sections|flat] [--max-layers 60]
 *        [--keyframes on|off]
 * Needs Node 22+ (built-in WebSocket).
 */
'use strict';
const { render } = require('../js/core/renderer');

const argv = process.argv.slice(2);
const pos = [];
const opt = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
  else pos.push(argv[i]);
}
if (pos.length < 2) {
  console.error('Usage: node tools/render-cli.js page.html out-folder [options]');
  process.exit(1);
}

render({
  htmlPath: pos[0],
  outDir: pos[1],
  fps: Number(opt.fps) || 30,
  duration: opt.duration || 'auto',
  width: opt.width === 'auto' ? 'auto' : Number(opt.width) || 1920,
  height: opt.width === 'auto' ? 'auto' : Number(opt.height) || 1080,
  keyframes: opt.keyframes !== 'off',
  debug: 'debug' in opt,
  mode: opt.mode || 'objects',
  maxLayers: Number(opt['max-layers']) || 60,
  chromePath: opt.chrome,
  cacheDir: opt.cache,
  onProgress: (p) => {
    if (p.stage === 'render' || p.stage === 'analyze') process.stdout.write('\r' + p.message.padEnd(70));
    else console.log('\n' + p.message);
  }
}).then((m) => {
  console.log('\nManifest:', m.manifestPath);
  console.log('Layers (bottom to top):');
  console.log('  ' + m.background.name + '  frames ' + m.background.frames);
  for (const L of m.layers) {
    const k = L.kind === 'motion'
      ? 'still + keyframes (' + Object.values(L.keys).filter(Array.isArray).reduce((n, a) => n + a.length, 0) + ' keys)'
      : 'PNG sequence';
    console.log('  ' + L.name + '  starts at frame ' + L.startFrame + ', ' + L.frames + ' frames, ' + k);
  }
  for (const a of m.audio) console.log('  sound ' + a.file + ' at ' + a.start + 's');
}).catch((e) => {
  console.error('\n' + (e.stack || e));
  process.exit(1);
});
