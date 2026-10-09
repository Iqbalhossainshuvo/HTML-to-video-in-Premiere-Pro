#!/usr/bin/env node
/*
 * End-to-end test of the desktop app (source or built executable):
 * starts it without a window, opens examples/demo.html through the API,
 * renders a short MP4 and checks the file.
 *   node tools/smoke-app.js dist/HTMLtoVideo.exe
 *   node tools/smoke-app.js            (runs app/main.js from source)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 47000 + Math.floor(Math.random() * 1000);
const exe = process.argv[2];
const args = ['--no-window', '--port=' + PORT];
// a throw-away home folder for settings and saved videos (not on Windows:
// Chrome refuses remote debugging when USERPROFILE is changed; CI machines
// are thrown away anyway)
const WIN = process.platform === 'win32';
const HOME = WIN ? os.homedir() : fs.mkdtempSync(path.join(os.tmpdir(), 'h2v-smoke-home-'));
const env = WIN ? process.env : Object.assign({}, process.env, { HOME });
const child = exe
  ? spawn(path.resolve(exe), args, { stdio: 'inherit', env })
  : spawn(process.execPath, [path.join(ROOT, 'app', 'main.js')].concat(args), { stdio: 'inherit', env });

function request(method, route, body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: route, method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function fail(msg) {
  console.error('SMOKE TEST FAILED: ' + msg);
  child.kill();
  process.exit(1);
}

async function main() {
  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    try { page = await request('GET', '/'); } catch (e) { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!page || page.status !== 200) fail('app did not start');
  const token = /name="h2v-token" content="([0-9a-f]+)"/.exec(page.body.toString())[1];
  const H = { 'X-Token': token };
  const state = JSON.parse((await request('GET', '/api/state', null, H)).body);
  console.log('browser:', state.browser);
  if (!state.browser) fail('no Chrome/Edge found');

  const opened = await request('POST', '/api/open-path', { path: path.join(ROOT, 'examples', 'demo.html') }, H);
  if (opened.status !== 200) fail('open-path: ' + opened.body);

  const done = new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/events' }, (res) => {
      let buf = '';
      res.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /event: (\w+)/.exec(block);
          const data = /data: (.*)/.exec(block);
          if (!ev || !data) continue;
          const d2 = JSON.parse(data[1]);
          if (ev[1] === 'progress' && d2.stage !== 'render') console.log('  ' + d2.message);
          if (ev[1] === 'done' || ev[1] === 'failed') { res.destroy(); resolve({ type: ev[1], data: d2 }); }
        }
      });
    });
  });
  await new Promise((r) => setTimeout(r, 300));
  const r = await request('POST', '/api/render', { resolution: '1280x720', fps: 30, duration: 2, quality: 'high' }, H);
  if (r.status !== 200) fail('render: ' + r.body);
  const result = await Promise.race([done, new Promise((res) => setTimeout(() => res({ type: 'timeout' }), 300000))]);
  if (result.type !== 'done') fail('render ' + result.type + ': ' + JSON.stringify(result.data));
  const v = result.data;
  console.log('video:', JSON.stringify(v));
  if (v.frames !== 60 || v.width !== 1280 || v.height !== 720) fail('unexpected video size/frames');

  const head = await request('GET', '/video/' + v.id + '.mp4', null, { Range: 'bytes=0-4095' });
  if (head.status !== 206) fail('range request status ' + head.status);
  if (head.body.toString('latin1', 4, 8) !== 'ftyp') fail('not an MP4');
  const full = await request('GET', '/video/' + v.id + '.mp4');
  const text = full.body.toString('latin1');
  for (const box of ['moov', 'mdat', 'trak']) if (text.indexOf(box) < 0) fail('missing ' + box);
  console.log('MP4 OK: ' + full.body.length + ' bytes, codec ' + v.codecs.video);

  // the download button: saves straight into the folder shown under the player
  const st2 = JSON.parse((await request('GET', '/api/state', null, H)).body);
  if (!st2.saveDir || !st2.saveDir.startsWith(HOME)) fail('unexpected save folder ' + st2.saveDir);
  const saved = await request('POST', '/api/save', {}, H);
  if (saved.status !== 200) fail('save: ' + saved.body);
  const sv = JSON.parse(saved.body);
  if (fs.statSync(sv.path).size !== full.body.length) fail('saved file has the wrong size');
  console.log('Saved OK: ' + sv.path);

  const ad = await request('GET', '/api/adobe', null, H);
  if (ad.status !== 200) fail('adobe status: ' + ad.body);
  console.log('Adobe:', ad.body.toString());
  child.kill();
  console.log('SMOKE TEST PASSED');
  process.exit(0);
}

main().catch((e) => fail(e.stack || String(e)));
