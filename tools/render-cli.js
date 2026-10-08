#!/usr/bin/env node
/*
 * Command-line version of the renderer (handy for testing outside Premiere).
 *   node tools/render-cli.js page.html out-folder [--fps 30] [--duration 5]
 *        [--width 1920] [--height 1080] [--mode objects|sections|flat] [--max-layers 60]
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
  width: Number(opt.width) || 1920,
  height: Number(opt.height) || 1080,
  mode: opt.mode || 'objects',
  maxLayers: Number(opt['max-layers']) || 60,
  chromePath: opt.chrome,
  onProgress: (p) => process.stdout.write('\r' + p.message.padEnd(70))
}).then((m) => {
  console.log('\nManifest:', m.manifestPath);
  console.log('Layers (bottom to top):');
  console.log('  ' + m.background.name + '  frames ' + m.background.frames);
  for (const L of m.layers) console.log('  ' + L.name + '  starts at frame ' + L.startFrame + ', ' + L.frames + ' frames');
}).catch((e) => {
  console.error('\n' + (e.stack || e));
  process.exit(1);
});
