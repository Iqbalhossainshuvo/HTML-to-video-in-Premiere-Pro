#!/usr/bin/env node
/*
 * Runs the app's render pipeline (src/render/renderJob.ts + src/runtime/html.ts)
 * in headless Chrome with phone emulation, using the same WebView bridge
 * (window.ReactNativeWebView.postMessage) the app uses. Writes an MP4.
 *   node test/render-in-chrome.js page.html out.mp4 [WIDTHxHEIGHT|auto] [fps]
 * Needs CHROME_PATH or an installed Chrome, Node 22+.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const esbuild = require('../../node_modules/esbuild');
const CDP = require('../../js/core/cdp');
const chrome = require('../../js/core/chrome');

const [htmlPath, outPath, size = 'auto', fpsArg = '30'] = process.argv.slice(2);
const PR = 2.625; // a typical Android phone

const bundle = path.join(os.tmpdir(), 'h2v-mobile-test.cjs');
esbuild.buildSync({
  stdin: {
    contents: "export * from './src/render/renderJob'; export * from './src/runtime/html';",
    resolveDir: path.join(__dirname, '..'), loader: 'ts'
  },
  bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'warning'
});
const { renderVideo, instrumentHtml, PAGE_RUNTIME_JS, RUNTIME_FILE, ENCODER_HTML, rpcScript, webviewSize } = require(bundle);

(async () => {
  const br = await chrome.launch({ width: 800, height: 800 });
  const cdp = await CDP.connect(br.wsUrl);
  const job = fs.mkdtempSync(path.join(os.tmpdir(), 'h2v-job-'));
  // copy the HTML's folder (assets) into the job folder, like the app does
  fs.cpSync(path.dirname(path.resolve(htmlPath)), job, { recursive: true });
  const main = path.join(job, path.basename(htmlPath));
  const original = fs.readFileSync(main, 'utf8');
  fs.writeFileSync(path.join(job, RUNTIME_FILE), PAGE_RUNTIME_JS);
  fs.writeFileSync(path.join(job, 'encoder.html'), ENCODER_HTML);

  async function webview() {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => cdp.send(m, p, sessionId);
    await s('Page.enable');
    await s('Runtime.enable');
    await s('Runtime.addBinding', { name: '__rn' });
    await s('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.ReactNativeWebView = { postMessage: function (m) { window.__rn(m); } };'
    });
    const w = { s, pending: new Map(), ready: null, id: 0 };
    cdp.on('Runtime.bindingCalled', (ev, sid) => {
      if (sid !== sessionId) return;
      const msg = JSON.parse(ev.payload);
      if (msg.type === 'ready' && w.ready) { w.ready(msg); w.ready = null; }
      else if (msg.type === 'pageError') console.log('  page error:', msg.message);
      else if (msg.id !== undefined && w.pending.has(msg.id)) {
        const p = w.pending.get(msg.id);
        w.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.v); else p.reject(new Error(msg.e));
      }
    });
    w.load = (url) => new Promise((resolve) => { w.ready = resolve; s('Page.navigate', { url }); });
    w.eval = (expr) => new Promise((resolve, reject) => {
      const id = ++w.id;
      w.pending.set(id, { resolve, reject });
      s('Runtime.evaluate', { expression: rpcScript(id, expr) });
    });
    return w;
  }

  const page = await webview();
  const enc = await webview();
  if (process.env.H2V_NO_WEBCODECS) {
    // simulate a phone WebView without WebCodecs: MediaRecorder fallback
    await enc.s('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.VideoEncoder; delete window.AudioEncoder;' });
  }
  let first = true;
  const host = {
    async loadPage(w, h, outW) {
      // same sizing as the app's RenderStage
      const size = webviewSize(w, h, outW, PR);
      fs.writeFileSync(main, instrumentHtml(original, w, h, size.scale));
      await page.s('Emulation.setDeviceMetricsOverride',
        { width: Math.round(size.dpW), height: Math.round(size.dpH), deviceScaleFactor: PR, mobile: true });
      const r = await page.load(pathToFileURL(main).href);
      console.log(`  page ready: viewport ${r.w}×${r.h} CSS px, WebView ${Math.round(size.dpW)}×${Math.round(size.dpH)} dp`);
    },
    evalPage: (e) => page.eval(e),
    async capture() {
      const r = await page.s('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
      return r.data;
    },
    async loadEncoder() { await enc.load(pathToFileURL(path.join(job, 'encoder.html')).href); },
    evalEncoder: (e) => enc.eval(e),
    async readFileBase64(url) {
      try { return fs.readFileSync(fileURLToPath(url)).toString('base64'); } catch (e) { return null; }
    },
    async writeChunks(chunks) {
      // same as the app: each piece at its byte position
      if (first) { fs.writeFileSync(outPath, Buffer.alloc(0)); first = false; }
      const fd = fs.openSync(outPath, 'r+');
      for (const c of chunks) { const b = Buffer.from(c.d, 'base64'); fs.writeSync(fd, b, 0, b.length, c.p); }
      fs.closeSync(fd);
    },
    progress(p) { if (p.stage !== 'render' || /0 \//.test(p.message)) console.log('  ' + p.message); },
    cancelled: () => false
  };
  const sizeOpt = size === 'auto' ? ['auto', 'auto'] : size.split('x').map(Number);
  const t0 = Date.now();
  const r = await renderVideo(host, {
    width: sizeOpt[0], height: sizeOpt[1], fps: Number(fpsArg), duration: 'auto', quality: 'high',
    maxOutput: Number(process.env.MAX_OUTPUT || 1280)
  });
  console.log('RESULT', JSON.stringify(r), 'in', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  void first;
  cdp.close();
  br.kill();
})().catch((e) => { console.error(e); process.exit(1); });
