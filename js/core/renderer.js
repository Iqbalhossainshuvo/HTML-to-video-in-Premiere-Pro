/*
 * HTML to Video – renderer.
 *
 * Plays an HTML file in a headless browser on a virtual clock and captures
 * it frame by frame:
 *   - one PNG sequence for the background (everything that isn't an object)
 *   - one transparent PNG sequence per object (text, image, icon, svg ...)
 * and writes manifest.json describing where each layer starts on the
 * timeline. jsx/host.jsx turns that into a Premiere Pro sequence.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const CDP = require('./cdp');
const chrome = require('./chrome');

const INJECT = fs.readFileSync(path.join(__dirname, 'inject.js'), 'utf8');
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };

function pad(n) {
  return String(n).padStart(5, '0');
}

function safeName(s) {
  return String(s).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'layer';
}

function sortLayers(a, b) {
  return (a.z[0] - b.z[0]) || (a.z[1] - b.z[1]) || (a.order - b.order) || (a.id - b.id);
}

class LayerWriter {
  constructor(dir, prefix) {
    this.dir = dir;
    this.prefix = prefix;
    this.startFrame = null;
    this.count = 0;
    this.pendingBlanks = 0;
    fs.mkdirSync(dir, { recursive: true });
  }
  file(i) {
    return path.join(this.dir, this.prefix + '_' + pad(i) + '.png');
  }
  frame(frameIndex, png, blank) {
    if (this.startFrame === null) this.startFrame = frameIndex;
    for (; this.pendingBlanks > 0; this.pendingBlanks--) fs.writeFileSync(this.file(this.count++), blank);
    fs.writeFileSync(this.file(this.count++), png);
  }
  skip() {
    if (this.startFrame !== null) this.pendingBlanks++;
  }
  finish(blank) {
    // Premiere needs at least 2 numbered stills to import a sequence.
    if (this.count === 1) fs.writeFileSync(this.file(this.count++), blank);
  }
}

/**
 * @param {object} o
 *   htmlPath, outDir, width, height, fps,
 *   duration: seconds or 'auto', mode: 'objects' | 'sections' | 'flat',
 *   maxLayers, chromePath, WebSocket, onProgress(info), isCancelled()
 * @returns {Promise<object>} manifest
 */
async function render(o) {
  const opts = Object.assign({
    width: 1920, height: 1080, fps: 30, duration: 'auto',
    mode: 'objects', maxLayers: 60
  }, o);
  const progress = opts.onProgress || (() => {});
  const cancelled = opts.isCancelled || (() => false);
  const htmlPath = path.resolve(opts.htmlPath);
  if (!fs.existsSync(htmlPath)) throw new Error('File not found: ' + htmlPath);

  const title = safeName(path.basename(htmlPath).replace(/\.[^.]+$/, ''));
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  progress({ stage: 'launch', message: 'Starting browser...' });
  const browser = await chrome.launch(opts);
  let cdp;
  try {
    cdp = await CDP.connect(browser.wsUrl, opts.WebSocket);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (m, p) => cdp.send(m, p, sessionId);
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error((d.exception && d.exception.description) || d.text);
      }
      return r.result.value;
    };
    const setBackground = (color) =>
      send('Emulation.setDefaultBackgroundColorOverride', color ? { color } : {});
    const shot = async () => {
      const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      return Buffer.from(r.data, 'base64');
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: false
    });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });

    const url = pathToFileURL(htmlPath).href;
    const load = async () => {
      const loaded = cdp.waitFor('Page.loadEventFired', sessionId, 60000);
      const nav = await send('Page.navigate', { url });
      if (nav.errorText) throw new Error('Could not open ' + url + ': ' + nav.errorText);
      await loaded;
      await evaluate(`(async () => {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        await Promise.all(Array.from(document.images).filter(i => !i.complete)
          .map(i => new Promise(r => { i.onload = i.onerror = r; })));
        return true;
      })()`);
    };

    progress({ stage: 'load', message: 'Loading ' + path.basename(htmlPath) + '...' });
    await load();

    // ---- duration ----
    let duration = Number(opts.duration);
    if (!(duration > 0)) {
      progress({ stage: 'probe', message: 'Measuring animation length...' });
      const declared = await evaluate(`(function () {
        if (window.H2V_DURATION) return Number(window.H2V_DURATION);
        var m = document.querySelector('meta[name="h2v-duration"]');
        return m ? Number(m.content) : 0;
      })()`);
      if (declared > 0) {
        duration = declared;
      } else {
        const p = await evaluate('__h2v.probe(30000, 50)');
        duration = p.looping ? 10 : Math.max(p.lastActivity + 500, p.minCycle, 1000) / 1000;
        duration = Math.min(duration, 60);
      }
      await load(); // start again from a fresh page at t = 0
    }
    const fps = opts.fps;
    const frames = Math.max(1, Math.round(duration * fps));

    await evaluate(`__h2v.configure(${JSON.stringify({ mode: opts.mode, maxLayers: opts.maxLayers })})`);

    // ---- capture ----
    const bgName = '00_background';
    const bg = new LayerWriter(path.join(outDir, bgName), bgName);
    const layers = new Map(); // id -> { meta, writer }
    let blank = null;
    const started = Date.now();

    for (let f = 0; f < frames; f++) {
      if (cancelled()) throw new Error('Cancelled');
      const t = (f * 1000) / fps;
      await evaluate(`__h2v.setTime(${t})`);
      const info = await evaluate('__h2v.prepare()');

      for (const L of info.added) {
        const name = String(L.id).padStart(2, '0') + '_' + safeName(L.name);
        layers.set(L.id, { meta: Object.assign({}, L, { name }), writer: null });
      }

      if (!blank) {
        await evaluate(`__h2v.isolate('none')`);
        await setBackground(TRANSPARENT);
        blank = await shot();
      }

      // background (page without its objects)
      await setBackground(null);
      await evaluate(`__h2v.isolate('bg')`);
      bg.frame(f, await shot(), blank);

      // each visible object on its own, on a transparent background
      const visible = new Set(info.visible);
      if (visible.size) await setBackground(TRANSPARENT);
      for (const [id, L] of layers) {
        if (!visible.has(id)) {
          if (L.writer) L.writer.skip();
          continue;
        }
        await evaluate(`__h2v.isolate(${id})`);
        if (!L.writer) L.writer = new LayerWriter(path.join(outDir, L.meta.name), L.meta.name);
        L.writer.frame(f, await shot(), blank);
      }
      await evaluate('__h2v.restore()');

      const elapsed = (Date.now() - started) / 1000;
      progress({
        stage: 'render',
        frame: f + 1,
        frames,
        layers: layers.size,
        eta: Math.round((elapsed / (f + 1)) * (frames - f - 1)),
        message: `Frame ${f + 1}/${frames} · ${visible.size} object(s) on screen`
      });
    }

    bg.finish(blank);
    const out = [];
    for (const L of layers.values()) {
      if (!L.writer) continue; // never visible
      L.writer.finish(blank);
      out.push(Object.assign({}, L.meta, {
        dir: L.writer.dir,
        first: L.writer.file(0),
        startFrame: L.writer.startFrame,
        frames: L.writer.count
      }));
    }
    out.sort(sortLayers);

    const manifest = {
      version: 1,
      title,
      source: htmlPath,
      width: opts.width,
      height: opts.height,
      fps,
      frames,
      duration: frames / fps,
      mode: opts.mode,
      background: { name: bgName, dir: bg.dir, first: bg.file(0), startFrame: 0, frames: bg.count },
      layers: out.map((L) => ({
        name: L.name, dir: L.dir, first: L.first, startFrame: L.startFrame, frames: L.frames
      }))
    };
    const manifestPath = path.join(outDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    manifest.manifestPath = manifestPath;
    progress({ stage: 'done', message: `Rendered ${frames} frames, ${out.length} object layer(s).` });
    return manifest;
  } finally {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch (e) { /* ignore */ }
      cdp.close();
    }
    browser.kill();
  }
}

module.exports = { render, findChrome: chrome.findChrome };
