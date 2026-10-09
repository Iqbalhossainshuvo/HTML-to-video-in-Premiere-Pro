/*
 * HTML to Video – renderer.
 *
 * Plays an HTML file in a headless browser on a virtual clock and captures
 * it frame by frame. Works fully offline (see netcache.js).
 *
 * Output (described by manifest.json, built into Premiere by jsx/host.jsx):
 *   - background: PNG sequence of the page without its objects
 *   - every object (text, image, icon, svg, shape...) as its own layer:
 *       "motion" layer: the object only moves / scales / rotates / fades ->
 *                       ONE still picture + editable Premiere keyframes
 *       "frames" layer: its look changes (text changes, canvas, video...) ->
 *                       a transparent PNG sequence
 *   - <audio> files with their start time
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const CDP = require('./cdp');
const chrome = require('./chrome');
const NetCache = require('./netcache');
const png = require('./png');
const motion = require('./motion');
const assets = require('./assets');
const Mp4Encoder = require('./encoder');

const INJECT = assets.text('js/core/inject.js');
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

function defaultCacheDir() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'HTML to Video', 'cache');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'HTML to Video', 'cache');
  }
  return path.join(os.homedir(), '.cache', 'html-to-video');
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
  frame(frameIndex, img, blank) {
    if (this.startFrame === null) this.startFrame = frameIndex;
    for (; this.pendingBlanks > 0; this.pendingBlanks--) fs.writeFileSync(this.file(this.count++), blank);
    fs.writeFileSync(this.file(this.count++), img);
  }
  skip() {
    if (this.startFrame !== null) this.pendingBlanks++;
  }
  finish(blank) {
    // Premiere needs at least 2 numbered stills to import a sequence.
    if (this.count === 1) fs.writeFileSync(this.file(this.count++), blank);
  }
  // The same picture for `frames` frames. Hard links take no extra disk space.
  still(img, frames) {
    const first = this.file(0);
    fs.writeFileSync(first, img);
    const n = Math.max(2, frames);
    for (let i = 1; i < n; i++) {
      try { fs.linkSync(first, this.file(i)); } catch (e) { fs.copyFileSync(first, this.file(i)); }
    }
    this.count = n;
  }
}

/**
 * @param {object} o
 *   htmlPath, outDir,
 *   width, height: numbers, or width 'auto' to use the page's own stage size
 *   fps, duration: seconds or 'auto', mode: 'objects' | 'sections' | 'flat',
 *   keyframes: true = objects that only move become stills + keyframes,
 *   maxLayers, chromePath, cacheDir, WebSocket, onProgress(info), isCancelled()
 *   video: path of an .mp4 to write instead of layers (quality: medium|high|max)
 * @returns {Promise<object>} manifest (or { video, ... } when `video` is set)
 */
function lengthMessage(m, seconds) {
  const s = seconds.toFixed(seconds % 1 ? 1 : 0) + ' s';
  if (m.how === 'declared') return 'Length: ' + s + ' (set by the page)';
  if (m.how === 'loop') return 'Length: ' + s + ' (one cycle: this page animates forever; type a Length to make it longer)';
  return 'Length: ' + s + ' (measured: the page stops changing there; type a Length to change it)';
}

async function render(o) {
  const opts = Object.assign({
    width: 1920, height: 1080, fps: 30, duration: 'auto',
    mode: 'objects', maxLayers: 60, keyframes: true
  }, o);
  const progress = opts.onProgress || (() => {});
  const cancelled = opts.isCancelled || (() => false);
  const htmlPath = path.resolve(opts.htmlPath);
  if (!fs.existsSync(htmlPath)) throw new Error('File not found: ' + htmlPath);

  const title = safeName(path.basename(htmlPath).replace(/\.[^.]+$/, ''));
  const videoOut = opts.video ? path.resolve(opts.video) : null;
  const outDir = videoOut ? null : path.resolve(opts.outDir);
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const autoSize = opts.width === 'auto' || opts.height === 'auto';
  let W = autoSize ? 1920 : Number(opts.width);
  let H = autoSize ? 1080 : Number(opts.height);
  if (videoOut) {
    // video encoders need even sizes; layers are not needed for a plain video
    W -= W % 2;
    H -= H % 2;
    opts.mode = 'flat';
    opts.keyframes = false;
  }

  progress({ stage: 'launch', message: 'Starting browser...' });
  const browser = await chrome.launch({ chromePath: opts.chromePath, width: W, height: H });
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
    let viewW = W;
    let viewH = H;
    const setViewport = (w, h) => {
      viewW = w;
      viewH = h;
      return send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    };
    // the video frame inside the viewport
    const stage = { x: 0, y: 0, width: W, height: H };
    const shot = async (clip) => {
      const params = { format: 'png', fromSurface: true };
      if (clip) params.clip = clip;
      else if (stage.x || stage.y || viewW !== W || viewH !== H) {
        params.clip = { x: stage.x, y: stage.y, width: W, height: H, scale: 1 };
      }
      const r = await send('Page.captureScreenshot', params);
      return Buffer.from(r.data, 'base64');
    };

    const cache = new NetCache(opts.cacheDir || defaultCacheDir(), path.dirname(htmlPath),
      (msg) => progress({ stage: 'warn', message: msg }));
    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');
    await cache.attach(cdp, sessionId);
    await setViewport(W, H);
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

    // ---- size: the page's own fixed-size stage ----
    if (autoSize) {
      const st = await evaluate('__h2v.findStage()');
      if (st) {
        W = st.w - (st.w % 2);
        H = st.h - (st.h % 2);
        stage.width = W;
        stage.height = H;
        await setViewport(W, H);
        await load();
        const again = await evaluate('__h2v.findStage()');
        if (again && Math.abs(again.scale - 1) < 0.01 && (again.x > 0.5 || again.y > 0.5)) {
          // a stage with a margin around it (not scaled to fit): make room
          await setViewport(Math.ceil(W + again.x), Math.ceil(H + again.y));
          await load();
          const s3 = await evaluate('__h2v.findStage()');
          if (s3 && Math.abs(s3.scale - 1) < 0.01) {
            stage.x = s3.x;
            stage.y = s3.y;
          } else {
            await setViewport(W, H);
            await load();
          }
        }
        progress({ stage: 'info', message: `Stage found: ${W}×${H}` });
      } else {
        progress({ stage: 'info', message: 'No fixed-size stage found, using 1920×1080' });
      }
    }

    // ---- duration ----
    let duration = Number(opts.duration);
    let needReload = false;
    if (!(duration > 0)) {
      progress({ stage: 'probe', message: 'Measuring animation length...' });
      // up to 5 minutes of animation are measured; longer: type the length
      const m = await evaluate('__h2v.measure(300000, 100)');
      duration = Math.min(m.duration, 3600);
      needReload = !!m.probed;
      progress({ stage: 'info', message: lengthMessage(m, duration) });
    }
    const fps = opts.fps;
    const frames = Math.max(1, Math.round(duration * fps));
    const configure = () => evaluate(`__h2v.configure(${JSON.stringify({
      mode: opts.mode, maxLayers: opts.maxLayers, frame: { x: stage.x, y: stage.y, width: W, height: H }
    })})`);

    // ---- pass 1: analysis (no pictures) ----
    // Records, for every object and frame, its on-screen box and how it
    // looks, to find the objects that can be a still picture + keyframes.
    const analysis = new Map(); // id -> { name, samples: [] }
    const useKeys = opts.keyframes && opts.mode !== 'flat';
    if (useKeys) {
      if (needReload) await load();
      needReload = true;
      await configure();
      const objectIds = new Map();
      for (let f = 0; f < frames; f++) {
        if (cancelled()) throw new Error('Cancelled');
        await evaluate(`__h2v.setTime(${(f * 1000) / fps}, true)`);
        const info = await evaluate('__h2v.prepare()');
        for (const L of info.added) analysis.set(L.id, { name: L.name, samples: [] });
        const data = await evaluate('__h2v.analyze()');
        for (const d of data) {
          if (!objectIds.has(d.id)) {
            const r = await send('Runtime.evaluate', { expression: `__h2v.layerElement(${d.id})` });
            objectIds.set(d.id, r.result.objectId);
          }
          let m = null;
          try {
            const { model } = await send('DOM.getBoxModel', { objectId: objectIds.get(d.id) });
            m = motion.quadToMatrix(model.border, model.width, model.height);
          } catch (e) { /* no box */ }
          analysis.get(d.id).samples.push({ frame: f, m, op: d.op, fp: d.fp, still: d.still });
        }
        if (f % 5 === 0) {
          progress({ stage: 'analyze', frame: f + 1, frames, message: `Reading frame ${f + 1}/${frames}` });
        }
      }
    }
    const rigid = new Set();
    for (const [id, a] of analysis) {
      const why = motion.whyNotRigid(a.samples);
      if (!why) rigid.add(id);
      else if (opts.debug) progress({ stage: 'info', message: `${a.name}: picture sequence (${why})` });
    }

    // The object alone, without transform/opacity, as one sharp picture.
    const captureRest = async (id, samples) => {
      let maxScale = 1;
      for (const s of samples) {
        const d = motion.decompose(s.m);
        maxScale = Math.max(maxScale, d.sx, d.sy);
      }
      const scale = Math.min(4, Math.max(1, Math.ceil(maxScale * 4 - 0.01) / 4));
      let box = await evaluate(`__h2v.rest(${id})`);
      // Move the object into an empty corner with a margin around it (an
      // object as big as the frame, or an inline one, stays where it is).
      const P = Math.floor(Math.min(256, (viewW - box.w) / 2, (viewH - box.h) / 2));
      if (P >= 2) box = await evaluate(`__h2v.rest(${id}, ${P}, ${P})`);
      const M = 256;
      const x0 = Math.max(0, Math.floor(box.x - M));
      const y0 = Math.max(0, Math.floor(box.y - M));
      const area = {
        x: x0, y: y0, scale: 1,
        width: Math.min(viewW, Math.ceil(box.x + box.w + M)) - x0,
        height: Math.min(viewH, Math.ceil(box.y + box.h + M)) - y0
      };
      let result = null;
      const b = area.width > 0 && area.height > 0 ? png.alphaBounds(await shot(area)) : null;
      // the picture must not touch the edge of the captured area (it would be cut)
      if (b && b.x > 0 && b.y > 0 && b.x + b.width < area.width && b.y + b.height < area.height) {
        const ix = area.x + b.x;
        const iy = area.y + b.y;
        const img = await shot({ x: ix, y: iy, width: b.width, height: b.height, scale });
        result = { img, dx: ix - box.x, dy: iy - box.y, cw: b.width, ch: b.height, scale };
      }
      await evaluate('__h2v.rest(null)');
      return result;
    };

    const resolveAudio = (list) => {
      const found = [];
      for (const a of list) {
        let file = null;
        try {
          file = a.src.startsWith('file:') ? fileURLToPath(a.src) : cache.findLocal(a.src);
        } catch (e) { /* ignore */ }
        if (file && fs.existsSync(file)) found.push({ file, start: a.start, volume: a.volume });
        else progress({ stage: 'warn', message: 'Sound not found on disk: ' + a.src });
      }
      return found;
    };

    // ---- pass 2: capture ----
    if (needReload) await load();
    await configure();

    if (videoOut) {
      // Plain MP4: every frame goes straight into the browser's video encoder.
      let enc = null;
      const started = Date.now();
      try {
        for (let f = 0; f < frames; f++) {
          if (cancelled()) throw new Error('Cancelled');
          await evaluate(`__h2v.setTime(${(f * 1000) / fps})`);
          if (!enc) {
            const sound = resolveAudio(await evaluate('__h2v.audioList()'));
            enc = await Mp4Encoder.open(cdp, {
              outPath: videoOut, width: W, height: H, fps, frames, quality: opts.quality, audio: sound
            });
            progress({ stage: 'info', message: 'Encoding ' + enc.codecs.video + (enc.codecs.audio ? ' + ' + enc.codecs.audio : '') });
          }
          await enc.addFrame(f, await shot());
          const elapsed = (Date.now() - started) / 1000;
          progress({
            stage: 'render', frame: f + 1, frames,
            eta: Math.round((elapsed / (f + 1)) * (frames - f - 1)),
            message: `Frame ${f + 1}/${frames}`
          });
        }
        await enc.finish();
      } catch (e) {
        if (enc) enc.close();
        try { fs.unlinkSync(videoOut); } catch (e2) { /* ignore */ }
        throw e;
      }
      progress({ stage: 'done', message: `Video ready: ${frames} frames, ${W}×${H} @ ${fps} fps.` });
      return { video: videoOut, title, width: W, height: H, fps, frames, duration: frames / fps, codecs: enc.codecs };
    }
    const bgName = '00_background';
    const bg = new LayerWriter(path.join(outDir, bgName), bgName);
    const layers = new Map(); // id -> { meta, writer, motion, rest }
    let blank = null;
    const started = Date.now();

    for (let f = 0; f < frames; f++) {
      if (cancelled()) throw new Error('Cancelled');
      const t = (f * 1000) / fps;
      await evaluate(`__h2v.setTime(${t})`);
      const info = await evaluate('__h2v.prepare()');

      for (const L of info.added) {
        const name = String(L.id).padStart(2, '0') + '_' + safeName(L.name);
        const a = analysis.get(L.id);
        const isMotion = rigid.has(L.id) && !!a && a.name === L.name;
        layers.set(L.id, { meta: Object.assign({}, L, { name }), writer: null, motion: isMotion, rest: null });
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
        if (L.motion && !L.rest) {
          L.rest = await captureRest(id, analysis.get(id).samples);
          if (!L.rest) L.motion = false; // no clean still possible: use frames
        }
        if (L.motion) continue;
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
      if (L.motion && L.rest) {
        const samples = analysis.get(L.meta.id).samples;
        const startFrame = samples[0].frame;
        const endFrame = samples[samples.length - 1].frame;
        const writer = new LayerWriter(path.join(outDir, L.meta.name), L.meta.name);
        writer.still(L.rest.img, endFrame - startFrame + 1);
        out.push(Object.assign({}, L.meta, {
          kind: 'motion',
          first: writer.file(0),
          startFrame,
          frames: writer.count,
          imageWidth: Math.round(L.rest.cw * L.rest.scale),
          imageHeight: Math.round(L.rest.ch * L.rest.scale),
          keys: motion.buildKeys(samples, startFrame, endFrame, L.rest, stage)
        }));
        continue;
      }
      if (!L.writer) continue; // never visible
      L.writer.finish(blank);
      out.push(Object.assign({}, L.meta, {
        kind: 'frames',
        first: L.writer.file(0),
        startFrame: L.writer.startFrame,
        frames: L.writer.count
      }));
    }
    out.sort(sortLayers);

    // ---- sound ----
    const audio = resolveAudio(await evaluate('__h2v.audioList()'));

    const manifest = {
      version: 2,
      title,
      source: htmlPath,
      width: W,
      height: H,
      fps,
      frames,
      duration: frames / fps,
      mode: opts.mode,
      background: { name: bgName, kind: 'frames', first: bg.file(0), startFrame: 0, frames: bg.count },
      layers: out.map((L) => {
        const m = { name: L.name, kind: L.kind, first: L.first, startFrame: L.startFrame, frames: L.frames };
        if (L.kind === 'motion') {
          m.imageWidth = L.imageWidth;
          m.imageHeight = L.imageHeight;
          m.keys = L.keys;
        }
        return m;
      }),
      audio
    };
    const manifestPath = path.join(outDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    manifest.manifestPath = manifestPath;
    const nMotion = out.filter((L) => L.kind === 'motion').length;
    progress({
      stage: 'done',
      message: `Rendered ${frames} frames: ${out.length} object layer(s), ${nMotion} with editable keyframes` +
        (audio.length ? `, ${audio.length} sound(s)` : '') + '.'
    });
    return manifest;
  } finally {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch (e) { /* ignore */ }
      cdp.close();
    }
    browser.kill();
  }
}

module.exports = { render, findChrome: chrome.findChrome, defaultCacheDir };
