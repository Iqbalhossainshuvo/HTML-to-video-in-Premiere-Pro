/*
 * HTML to Video desktop app – local web server (127.0.0.1 only).
 * Serves the app's UI, runs renders with the shared renderer, streams the
 * finished MP4 to the player (with seeking) and saves it where the user wants.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const assets = require('../js/core/assets');
const renderer = require('../js/core/renderer');
const dialogs = require('./dialogs');
const adobe = require('./adobe');

const SETTINGS = path.join(os.homedir(), '.html-to-video', 'settings.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) || {}; } catch (e) { return {}; }
}

function storeSettings(s) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
    fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
  } catch (e) { /* not remembered */ }
}

// Videos (Windows) / Movies (macOS) › HTML to Video
function defaultSaveDir() {
  const videos = path.join(os.homedir(), process.platform === 'darwin' ? 'Movies' : 'Videos');
  return path.join(videos, 'HTML to Video');
}

function stamp() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
}

const UI = {
  '/': ['app/ui/index.html', 'text/html; charset=utf-8'],
  '/app.css': ['app/ui/app.css', 'text/css; charset=utf-8'],
  '/app.js': ['app/ui/app.js', 'application/javascript; charset=utf-8'],
  '/icon.svg': ['app/ui/icon.svg', 'image/svg+xml']
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css',
  '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4'
};

function createServer(options) {
  const opts = options || {};
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'html-to-video-'));
  const settings = loadSettings();
  const state = {
    html: opts.initialFile || null, job: null, video: null, clients: new Set(),
    saveDir: settings.saveDir || defaultSaveDir()
  };
  const token = crypto.randomBytes(16).toString('hex'); // only our own window may call the API

  function send(res, code, body, type, extra) {
    res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' }, extra));
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }

  function broadcast(event, data) {
    const msg = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
    for (const c of state.clients) c.write(msg);
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let raw = '';
      req.on('data', (d) => { raw += d; if (raw.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); }
      });
    });
  }

  function fileInfo(p) {
    return { path: p, name: path.basename(p), dir: path.dirname(p) };
  }

  function sendFile(req, res, file, type) {
    let stat;
    try { stat = fs.statSync(file); } catch (e) { return send(res, 404, { error: 'not found' }); }
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      let start = range[1] === '' ? stat.size - Number(range[2]) : Number(range[1]);
      let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : stat.size - 1;
      start = Math.max(0, start);
      end = Math.min(end, stat.size - 1);
      if (start > end) return send(res, 416, '', 'text/plain', { 'Content-Range': 'bytes */' + stat.size });
      res.writeHead(206, {
        'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
        'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size, 'Cache-Control': 'no-store'
      });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  }

  function uniquePath(dir, name) {
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    let p = path.join(dir, name);
    for (let i = 1; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
    return p;
  }

  async function startRender(body) {
    if (!state.html || !fs.existsSync(state.html)) throw new Error('Open an HTML file first.');
    if (state.job) throw new Error('A video is already being rendered.');
    const id = Date.now().toString(36);
    const out = path.join(tmp, id + '.mp4');
    const job = { id, cancel: false, started: Date.now(), html: state.html };
    state.job = job;
    const [w, h] = parseSize(body.resolution);
    broadcast('progress', { stage: 'start', message: 'Starting…', fraction: 0 });
    renderer.render({
      htmlPath: state.html,
      video: out,
      width: w,
      height: h,
      fps: Number(body.fps) || 30,
      duration: body.duration && body.duration !== 'auto' ? Number(body.duration) : 'auto',
      quality: body.quality || 'high',
      chromePath: opts.chromePath,
      isCancelled: () => job.cancel,
      onProgress: (p) => {
        const fraction = p.stage === 'render' ? p.frame / p.frames : null;
        broadcast('progress', Object.assign({ fraction }, p));
      }
    }).then((r) => {
      const old = state.video;
      state.video = {
        id, file: out, html: job.html, name: path.basename(state.html).replace(/\.[^.]+$/, '') + '.mp4',
        width: r.width, height: r.height, fps: r.fps, frames: r.frames, duration: r.duration,
        codecs: r.codecs, seconds: Math.round((Date.now() - job.started) / 100) / 10,
        size: fs.statSync(out).size
      };
      if (old && old.file !== out) fs.unlink(old.file, () => {});
      broadcast('done', state.video);
    }).catch((e) => {
      broadcast('failed', { message: job.cancel ? 'Cancelled.' : (e && e.message) || String(e) });
    }).then(() => {
      state.job = null;
    });
    return { id };
  }

  function parseSize(resolution) {
    const size = String(resolution || 'auto');
    return size === 'auto' ? ['auto', 'auto'] : size.split('x').map(Number);
  }

  // "Edit in Premiere Pro / After Effects": install the plugin, convert the
  // HTML into layers, then hand it to the program (see app/adobe.js).
  async function startEdit(body) {
    const key = body.host;
    const host = adobe.HOSTS[key];
    if (!host) throw new Error('Unknown program.');
    if (!state.html || !fs.existsSync(state.html)) throw new Error('Open an HTML file first.');
    if (state.job) throw new Error('Please wait: a video is being rendered.');
    if (!adobe.findApps()[key]) throw new Error(host.name + ' was not found on this computer.');
    const job = { id: 'edit', cancel: false, started: Date.now(), html: state.html };
    state.job = job;
    const step = (message, fraction) => broadcast('progress', { stage: 'edit', message, fraction });
    (async () => {
      step('Installing the plugin…', 0);
      const changed = await adobe.installPlugin();
      const wasRunning = (await adobe.runningPid(key)) > 0;

      const [w, h] = parseSize(body.resolution);
      let duration = body.duration && body.duration !== 'auto' ? Number(body.duration) : 'auto';
      // the same length as the video already rendered from this file
      if (duration === 'auto' && state.video && state.video.html === state.html) duration = state.video.duration;
      const base = path.basename(state.html).replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
      const outDir = path.join(os.homedir(), 'Documents', 'HTML to Video', base + '_' + stamp());
      const manifest = await renderer.render({
        htmlPath: state.html,
        outDir,
        width: w,
        height: h,
        fps: Number(body.fps) || 30,
        duration,
        mode: 'objects',
        keyframes: true,
        maxLayers: 60,
        chromePath: opts.chromePath,
        isCancelled: () => job.cancel,
        onProgress: (p) => {
          if (p.stage === 'analyze') step(p.message, 0.05 + (p.frame / p.frames) * 0.25);
          else if (p.stage === 'render') step(p.message + (p.eta > 0 ? ' · about ' + p.eta + ' s left' : ''), 0.3 + (p.frame / p.frames) * 0.65);
          else broadcast('progress', Object.assign({ fraction: null }, p));
        }
      });
      if (job.cancel) throw new Error('Cancelled.');
      const queued = adobe.queueJob(key, manifest.manifestPath);
      step('Layers ready: ' + manifest.layers.length + ' objects', 0.97);

      if (wasRunning && changed) {
        broadcast('edit-wait', {
          host: key,
          restart: true,
          message: 'The plugin was just installed. Close ' + host.name + ' and open it again: your video then opens in it by itself.'
        });
      } else {
        step((wasRunning ? 'Switching to ' : 'Starting ') + host.name + '…', 0.98);
        await adobe.openApp(key, dialogs.activate);
        broadcast('edit-wait', {
          host: key,
          message: wasRunning ? 'Building in ' + host.name + '…' : host.name + ' is starting. The video opens in it as soon as it is ready.'
        });
      }
      watchJob(queued, host.name, outDir);
    })().catch((e) => {
      broadcast('failed', { message: job.cancel ? 'Cancelled.' : (e && e.message) || String(e) });
    }).then(() => {
      if (state.job === job) state.job = null;
    });
    return { ok: true };
  }

  // Waits (up to 2 hours) for the plugin's answer.
  function watchJob(queued, name, outDir) {
    let taken = false;
    const timer = setInterval(() => {
      const r = adobe.jobResult(queued);
      if (r) {
        clearInterval(timer);
        broadcast('edit-done', { ok: !!r.ok, host: queued.host, folder: outDir,
          message: r.ok ? 'Opened in ' + name + ': ' + r.message : name + ': ' + r.message });
      } else if (!taken && adobe.jobTaken(queued)) {
        taken = true;
        broadcast('edit-wait', { host: queued.host, message: 'Building in ' + name + '…' });
      } else if (Date.now() - queued.created > 2 * 3600 * 1000) {
        clearInterval(timer);
      }
    }, 1000);
    timer.unref();
  }

  async function api(req, res, route) {
    if (req.headers['x-token'] !== token) return send(res, 403, { error: 'forbidden' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    switch (route) {
      case 'state':
        return send(res, 200, {
          html: state.html ? fileInfo(state.html) : null,
          video: state.video,
          rendering: !!state.job,
          saveDir: state.saveDir,
          browser: renderer.findChrome(opts.chromePath),
          version: opts.version
        });
      case 'open': {
        const p = await dialogs.openHtml(state.html ? path.dirname(state.html) : undefined);
        if (p) state.html = p;
        return send(res, 200, { html: state.html ? fileInfo(state.html) : null, picked: !!p });
      }
      case 'open-path': {
        const p = String(body.path || '').trim().replace(/^"|"$/g, '');
        if (!/\.html?$/i.test(p) || !fs.existsSync(p)) return send(res, 400, { error: 'Not an HTML file: ' + p });
        state.html = path.resolve(p);
        return send(res, 200, { html: fileInfo(state.html) });
      }
      case 'render':
        try {
          return send(res, 200, await startRender(body));
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      case 'cancel':
        if (state.job) state.job.cancel = true;
        return send(res, 200, { ok: true });
      case 'save': {
        // straight into the chosen folder (shown under the player)
        if (!state.video || !fs.existsSync(state.video.file)) return send(res, 400, { error: 'Render a video first.' });
        try {
          fs.mkdirSync(state.saveDir, { recursive: true });
          const dest = uniquePath(state.saveDir, state.video.name);
          await fs.promises.copyFile(state.video.file, dest);
          if (fs.statSync(dest).size !== fs.statSync(state.video.file).size) throw new Error('The copy is incomplete.');
          return send(res, 200, { saved: true, path: dest, dir: state.saveDir });
        } catch (e) {
          return send(res, 400, { error: 'Could not save to ' + state.saveDir + ': ' + e.message + ' Click “Change” to pick another folder.' });
        }
      }
      case 'save-folder': {
        const dir = await dialogs.chooseFolder(fs.existsSync(state.saveDir) ? state.saveDir : path.dirname(state.saveDir));
        if (dir) {
          state.saveDir = dir;
          settings.saveDir = dir;
          storeSettings(settings);
        }
        return send(res, 200, { saveDir: state.saveDir, changed: !!dir });
      }
      case 'adobe':
        return send(res, 200, await adobe.status());
      case 'edit':
        try {
          return send(res, 200, await startEdit(body));
        } catch (e) {
          return send(res, 400, { error: e.message });
        }
      case 'reveal':
        if (body.path && fs.existsSync(body.path)) dialogs.reveal(body.path);
        return send(res, 200, { ok: true });
      default:
        return send(res, 404, { error: 'unknown' });
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = decodeURIComponent(url.pathname);
    try {
      if (route === '/') {
        const html = assets.text(UI['/'][0]).replace('%%TOKEN%%', token);
        return send(res, 200, html, UI['/'][1]);
      }
      if (UI[route]) return send(res, 200, assets.text(UI[route][0]), UI[route][1]);
      if (route === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write('retry: 1000\n\n');
        state.clients.add(res);
        req.on('close', () => state.clients.delete(res));
        return undefined;
      }
      if (route.startsWith('/video/')) {
        if (!state.video || route !== '/video/' + state.video.id + '.mp4') return send(res, 404, { error: 'no video' });
        return sendFile(req, res, state.video.file, 'video/mp4');
      }
      if (route.startsWith('/src/')) {
        // the opened HTML's folder, for the live preview
        if (!state.html) return send(res, 404, { error: 'no file' });
        const root = path.dirname(state.html);
        const file = path.resolve(root, '.' + route.slice(4));
        if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, { error: 'forbidden' });
        return sendFile(req, res, file, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      }
      if (route.startsWith('/api/')) {
        return api(req, res, route.slice(5)).catch((e) => send(res, 500, { error: e.message }));
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  });

  return new Promise((resolve) => {
    server.listen(opts.port || 0, '127.0.0.1', () => {
      resolve({
        url: 'http://127.0.0.1:' + server.address().port + '/',
        close() {
          server.close();
          dialogs.stop();
          if (state.job) state.job.cancel = true;
          try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        }
      });
    });
  });
}

module.exports = { createServer };
