/*
 * Text helpers for the two WebViews (no React Native imports, so they can be
 * tested on a computer as well):
 *  - the page WebView shows the user's HTML with our virtual clock
 *    (inject.js) loaded before any of the page's own scripts
 *  - the encoder WebView turns captured frames into an MP4
 */
import { ENCODER_PAGE_JS, INJECT_JS, MP4_MUXER_JS } from './generated';

export const RUNTIME_FILE = '__h2v_runtime.js';

// Talks back to React Native: page ready, errors, RPC answers.
const BOOT_JS = `
(function () {
  function post(m) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) { /* not in a WebView */ }
  }
  window.__h2vPost = post;
  window.addEventListener('error', function (e) { post({ type: 'pageError', message: String(e.message) }); });
  window.addEventListener('load', function () {
    (async function () {
      try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        await Promise.all(Array.prototype.filter.call(document.images, function (i) { return !i.complete; })
          .map(function (i) { return new Promise(function (r) { i.onload = i.onerror = r; }); }));
      } catch (e) { /* ignore */ }
      post({ type: 'ready', w: window.innerWidth, h: window.innerHeight });
    })();
  });
})();
`;

/** Contents of __h2v_runtime.js, written next to the user's HTML. */
export const PAGE_RUNTIME_JS = INJECT_JS + '\n' + BOOT_JS;

/**
 * The user's HTML with a fixed viewport of `width` × `height` CSS pixels
 * (the video size) shown at `scale`, and our runtime as the very first
 * script, before any of the page's own code.
 */
export function instrumentHtml(html: string, width: number, height: number, scale: number): string {
  const s = Number(scale.toFixed(6));
  const head =
    `<meta name="viewport" content="width=${width}, height=${height}, initial-scale=${s}, ` +
    `minimum-scale=${s}, maximum-scale=${s}, user-scalable=no">` +
    `<script src="${RUNTIME_FILE}"></script>`;
  // the page's own viewport tag would override ours
  const cleaned = html.replace(/<meta[^>]+name\s*=\s*["']?viewport["']?[^>]*>/gi, '');
  if (/<head[^>]*>/i.test(cleaned)) return cleaned.replace(/<head[^>]*>/i, (m) => m + head);
  if (/<html[^>]*>/i.test(cleaned)) return cleaned.replace(/<html[^>]*>/i, (m) => m + '<head>' + head + '</head>');
  if (/<!doctype[^>]*>/i.test(cleaned)) return cleaned.replace(/<!doctype[^>]*>/i, (m) => m + head);
  return head + cleaned;
}

function inlineScript(js: string): string {
  return '<script>' + js.replace(/<\/script/gi, '<\\/script') + '</script>';
}

/** The encoder page (load it with an https baseUrl: WebCodecs needs a secure context). */
export const ENCODER_HTML =
  '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
  inlineScript(MP4_MUXER_JS) +
  inlineScript(ENCODER_PAGE_JS) +
  inlineScript(BOOT_JS) +
  '</body></html>';

/**
 * JavaScript to inject for one call: evaluates `expr` (may return a
 * promise) and posts { id, ok, v } or { id, ok: false, e } back.
 */
export function rpcScript(id: number, expr: string): string {
  return (
    '(async function () { var r;' +
    ' try { r = { id: ' + id + ', ok: true, v: await (' + expr + ') }; }' +
    ' catch (e) { r = { id: ' + id + ', ok: false, e: String((e && (e.message || e)) || e) }; }' +
    ' window.ReactNativeWebView.postMessage(JSON.stringify(r)); })(); true;'
  );
}

/**
 * Size of the page WebView (in dp) for a page laid out at w × h CSS px and
 * captured at about outW × outH pixels on a screen with `pixelRatio`.
 * Android WebView does not zoom out below 0.25, so the WebView is never
 * smaller than 26% of the page; the encoder scales the picture to outW × outH.
 */
export function webviewSize(w: number, h: number, outW: number, pixelRatio: number) {
  const dpW = Math.max(outW / pixelRatio, w * 0.26);
  return { dpW, dpH: (dpW * h) / w, scale: dpW / w };
}
