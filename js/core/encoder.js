/*
 * Node side of the MP4 encoder: opens js/core/encoder-page.js in a tab of
 * the same headless browser, sends it the frames and writes the MP4 file.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const assets = require('./assets');

class Mp4Encoder {
  /**
   * cdp: connected CDP client (browser level)
   * o: { outPath, width, height, fps, frames, quality: 'medium'|'high'|'max',
   *      audio: [{ file, start, volume }] }
   */
  static async open(cdp, o) {
    const enc = new Mp4Encoder();
    enc.cdp = cdp;
    enc.outPath = o.outPath;
    // The encoder page must be a secure context (file:// is), so it lives in a temp file.
    enc.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h2v-enc-'));
    const page = path.join(enc.dir, 'encoder.html');
    fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><script>' +
      assets.text('js/vendor/mp4-muxer.js') + '</script><script>' +
      assets.text('js/core/encoder-page.js') + '</script>');

    // its own background window, so the page being rendered stays the
    // visible (and therefore painting) tab
    const { targetId } = await cdp.send('Target.createTarget',
      { url: 'about:blank', newWindow: true, background: true });
    enc.targetId = targetId;
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    enc.sessionId = sessionId;
    await cdp.send('Page.enable', {}, sessionId);
    const loaded = cdp.waitFor('Page.loadEventFired', sessionId, 30000);
    await cdp.send('Page.navigate', { url: pathToFileURL(page).href }, sessionId);
    await loaded;

    const bpp = { medium: 0.08, high: 0.14, max: 0.25 }[o.quality || 'high'] || 0.14;
    const bitrate = Math.round(Math.min(80e6, Math.max(2e6, o.width * o.height * o.fps * bpp)));
    const audio = (o.audio || []).map((a) => ({
      data: fs.readFileSync(a.file).toString('base64'), start: a.start, volume: a.volume
    }));
    fs.mkdirSync(path.dirname(o.outPath), { recursive: true });
    enc.fd = fs.openSync(o.outPath, 'w');
    enc.codecs = await enc.call('__enc.init', {
      width: o.width, height: o.height, fps: o.fps, bitrate, frames: o.frames, audio
    });
    return enc;
  }

  async call(fn, ...args) {
    const expression = fn + '(' + args.map((a) => JSON.stringify(a)).join(',') + ')';
    const r = await this.cdp.send('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true }, this.sessionId);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('Encoder: ' + ((d.exception && d.exception.description) || d.text));
    }
    return r.result.value;
  }

  write(pieces) {
    for (const p of pieces || []) {
      const buf = Buffer.from(p.d, 'base64');
      fs.writeSync(this.fd, buf, 0, buf.length, p.p);
    }
  }

  async addFrame(index, image, type) {
    this.write(await this.call('__enc.frame', image.toString('base64'), index, type || 'image/png'));
  }

  async finish() {
    try {
      this.write(await this.call('__enc.finish'));
    } finally {
      this.close();
    }
  }

  close() {
    if (this.fd !== undefined) {
      try { fs.closeSync(this.fd); } catch (e) { /* ignore */ }
      this.fd = undefined;
    }
    this.cdp.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

module.exports = Mp4Encoder;
