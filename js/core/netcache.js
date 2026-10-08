/*
 * Offline support. Every http(s) file the page loads (libraries from a CDN,
 * Google Fonts, pictures...) goes through here:
 *   1. already in the local cache  -> served from disk (works offline)
 *   2. a file with the same name next to the HTML (or in assets/, libs/,
 *      js/, css/, fonts/)          -> served from disk
 *   3. otherwise it is downloaded (if there is internet) and saved to the
 *      cache, so the next conversion works without internet.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = {
  '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.html': 'text/html', '.txt': 'text/plain'
};
const LOCAL_DIRS = ['', 'assets', 'libs', 'lib', 'js', 'css', 'fonts', 'vendor'];

class NetCache {
  constructor(cacheDir, htmlDir, log) {
    this.dir = cacheDir;
    this.htmlDir = htmlDir;
    this.log = log || (() => {});
    this.failed = new Set();
    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (e) { /* read-only: no caching */ }
  }

  key(url) {
    return crypto.createHash('sha1').update(url).digest('hex');
  }

  readCached(url) {
    const base = path.join(this.dir, this.key(url));
    try {
      const meta = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
      return { meta, body: fs.readFileSync(base + '.bin') };
    } catch (e) {
      return null;
    }
  }

  writeCached(url, status, headers, body) {
    const base = path.join(this.dir, this.key(url));
    try {
      fs.writeFileSync(base + '.bin', body);
      fs.writeFileSync(base + '.json', JSON.stringify({ url, status, headers }));
    } catch (e) { /* ignore */ }
  }

  findLocal(url) {
    let name;
    try { name = decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch (e) { return null; }
    if (!name || !/\.[a-z0-9]+$/i.test(name)) return null;
    for (const d of LOCAL_DIRS) {
      const p = path.join(this.htmlDir, d, name);
      try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* next */ }
    }
    return null;
  }

  static headers(contentType, extra) {
    const h = [{ name: 'Access-Control-Allow-Origin', value: '*' }];
    if (contentType) h.push({ name: 'Content-Type', value: contentType });
    return h.concat(extra || []);
  }

  // Wire into a CDP page session.
  async attach(cdp, sessionId) {
    const send = (m, p) => cdp.send(m, p, sessionId).catch(() => {});
    cdp.on('Fetch.requestPaused', async (ev, sid) => {
      if (sid !== sessionId) return;
      const url = ev.request.url;
      try {
        if (ev.responseStatusCode === undefined && !ev.responseErrorReason) {
          // request stage
          const hit = this.readCached(url);
          if (hit) {
            // the body is stored decoded, so only the content type is kept
            const keep = (hit.meta.headers || []).filter((h) => /^content-type$/i.test(h.name));
            return send('Fetch.fulfillRequest', {
              requestId: ev.requestId, responseCode: hit.meta.status || 200,
              responseHeaders: NetCache.headers(null, keep), body: hit.body.toString('base64')
            });
          }
          const local = this.findLocal(url);
          if (local) {
            const type = TYPES[path.extname(local).toLowerCase()] || 'application/octet-stream';
            return send('Fetch.fulfillRequest', {
              requestId: ev.requestId, responseCode: 200,
              responseHeaders: NetCache.headers(type), body: fs.readFileSync(local).toString('base64')
            });
          }
          return send('Fetch.continueRequest', { requestId: ev.requestId });
        }
        // response stage: save successful downloads for next time (offline)
        if (ev.responseStatusCode >= 200 && ev.responseStatusCode < 300) {
          const r = await cdp.send('Fetch.getResponseBody', { requestId: ev.requestId }, sessionId);
          const body = Buffer.from(r.body, r.base64Encoded ? 'base64' : 'utf8');
          this.writeCached(url, ev.responseStatusCode, ev.responseHeaders || [], body);
        } else if (ev.responseErrorReason) {
          this.miss(url);
        }
        return send('Fetch.continueRequest', { requestId: ev.requestId });
      } catch (e) {
        return send('Fetch.continueRequest', { requestId: ev.requestId });
      }
    });
    cdp.on('Network.loadingFailed', (ev, sid) => {
      if (sid === sessionId && ev.errorText && !/ERR_ABORTED/.test(ev.errorText)) this.miss(ev.requestId);
    });
    cdp.on('Network.requestWillBeSent', (ev, sid) => {
      if (sid === sessionId) this.urls = (this.urls || new Map()).set(ev.requestId, ev.request.url);
    });
    await cdp.send('Network.enable', {}, sessionId);
    await cdp.send('Fetch.enable', {
      patterns: [
        { urlPattern: 'http*', requestStage: 'Request' },
        { urlPattern: 'http*', requestStage: 'Response' }
      ]
    }, sessionId);
  }

  miss(urlOrId) {
    const url = (this.urls && this.urls.get(urlOrId)) || urlOrId;
    if (!/^https?:/.test(url) || this.failed.has(url)) return;
    this.failed.add(url);
    this.log('Could not load (offline and not cached yet): ' + url);
  }
}

module.exports = NetCache;
