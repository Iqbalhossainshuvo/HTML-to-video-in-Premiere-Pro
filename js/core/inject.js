/*
 * HTML to Video – in-page runtime.
 *
 * Injected into the page before any of its own scripts run. It does two jobs:
 *
 *  1. Virtual clock. Date, performance.now, setTimeout/setInterval,
 *     requestAnimationFrame, CSS animations/transitions, Web Animations and
 *     <video> elements are all driven by a clock that only moves when the
 *     renderer calls __h2v.setTime(ms). Every frame is therefore rendered at
 *     an exact moment, so the page plays the same way it does in a browser,
 *     however long each screenshot takes.
 *
 *  2. Object layers. Every visual object on the page (text block, image,
 *     icon, svg, button, shape...) becomes its own layer. For each frame the
 *     renderer can show a single layer on its own (__h2v.isolate(id)) or the
 *     page without any layers (the background), so every object ends up on
 *     its own track in Premiere Pro. Nothing is cut out: anything that isn't
 *     a layer stays in the background.
 */
(function () {
  'use strict';
  if (window.__h2v) return;

  var RealDate = Date;
  var EPOCH = RealDate.now();
  var now = 0; // virtual time in ms since the page started
  var realRAF = window.requestAnimationFrame.bind(window);
  var realSetTimeout = window.setTimeout.bind(window);
  var slice = Array.prototype.slice;

  /* ------------------------------------------------------------------ */
  /* Virtual clock                                                       */
  /* ------------------------------------------------------------------ */

  function VDate() {
    if (!(this instanceof VDate)) return new RealDate(EPOCH + now).toString();
    if (arguments.length === 0) return new RealDate(EPOCH + now);
    var args = [null].concat(slice.call(arguments));
    return new (Function.prototype.bind.apply(RealDate, args))();
  }
  VDate.prototype = RealDate.prototype;
  VDate.now = function () { return EPOCH + Math.floor(now); };
  VDate.parse = RealDate.parse;
  VDate.UTC = RealDate.UTC;
  window.Date = VDate;

  try {
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: function () { return now; }
    });
  } catch (e) { /* ignore */ }

  // The same moment always looks the same: Math.random gets a fixed seed.
  var seed = 0x2f6b3a1d;
  Math.random = function () {
    seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  var timers = {};
  var timerSeq = 1;
  var timerOrder = 1;

  function addTimer(fn, delay, args, repeat) {
    if (typeof fn !== 'function') {
      var code = String(fn);
      fn = function () { (0, eval)(code); };
    }
    delay = Math.max(0, Number(delay) || 0);
    var id = timerSeq++;
    timers[id] = {
      fn: fn,
      at: now + delay,
      args: args,
      repeat: repeat ? Math.max(delay, 4) : 0,
      order: timerOrder++
    };
    return id;
  }
  window.setTimeout = function (fn, delay) {
    return addTimer(fn, delay, slice.call(arguments, 2), false);
  };
  window.setInterval = function (fn, delay) {
    return addTimer(fn, delay, slice.call(arguments, 2), true);
  };
  window.clearTimeout = window.clearInterval = function (id) { delete timers[id]; };

  var rafCbs = {};
  var rafSeq = 1;
  window.requestAnimationFrame = function (cb) {
    var id = rafSeq++;
    rafCbs[id] = cb;
    return id;
  };
  window.cancelAnimationFrame = function (id) { delete rafCbs[id]; };

  // Web Animations / CSS animations / CSS transitions
  var births = new WeakMap();
  var userPaused = new WeakSet();
  var AP = window.Animation && Animation.prototype;
  var origPause = AP && AP.pause;
  var origPlay = AP && AP.play;

  if (AP) {
    AP.pause = function () {
      userPaused.add(this);
      return origPause.call(this);
    };
    AP.play = function () {
      userPaused.delete(this);
      origPlay.call(this);
      var rate = this.playbackRate || 1;
      births.set(this, now - (Number(this.currentTime) || 0) / rate);
      origPause.call(this);
    };
  }
  if (Element.prototype.animate) {
    var origAnimate = Element.prototype.animate;
    Element.prototype.animate = function () {
      var a = origAnimate.apply(this, arguments);
      births.set(a, now);
      try { origPause.call(a); } catch (e) { /* ignore */ }
      return a;
    };
  }

  function controlled(a) {
    return a.timeline === document.timeline;
  }

  function registerAnimations() {
    var list = document.getAnimations ? document.getAnimations() : [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!controlled(a) || births.has(a)) continue;
      births.set(a, now);
      try { origPause.call(a); } catch (e) { /* ignore */ }
    }
    return list;
  }

  function syncAnimations() {
    var list = registerAnimations();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!controlled(a) || userPaused.has(a)) continue;
      var t = Math.max(0, now - births.get(a)) * (a.playbackRate || 1);
      try {
        var end = a.effect ? a.effect.getComputedTiming().endTime : Infinity;
        if (isFinite(end) && t >= end && a.playState !== 'finished') {
          a.finish(); // resolves .finished and fires animationend
        } else {
          a.currentTime = t;
        }
      } catch (e) { /* ignore */ }
    }
  }

  // <video>/<audio>
  var media = new WeakMap();
  var MP = HTMLMediaElement.prototype;
  var origMediaPlay = MP.play;
  var origMediaPause = MP.pause;

  function mediaState(el) {
    var st = media.get(el);
    if (!st) {
      st = { playing: !!el.autoplay, birth: now };
      media.set(el, st);
      origMediaPause.call(el);
    }
    return st;
  }
  MP.play = function () {
    var st = mediaState(this);
    if (!st.playing) {
      st.playing = true;
      st.birth = now - (this.currentTime || 0) * 1000;
    }
    origMediaPause.call(this);
    return Promise.resolve();
  };
  MP.pause = function () {
    mediaState(this).playing = false;
    return origMediaPause.call(this);
  };

  function waitEvent(el, name, ms) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        el.removeEventListener(name, finish);
        resolve();
      }
      el.addEventListener(name, finish);
      realSetTimeout(finish, ms);
    });
  }

  async function syncMedia() {
    var vids = document.querySelectorAll('video');
    for (var i = 0; i < vids.length; i++) {
      var el = vids[i];
      var st = mediaState(el);
      if (!el.paused) origMediaPause.call(el);
      if (!st.playing) continue;
      if (el.readyState < 1) await waitEvent(el, 'loadedmetadata', 3000);
      var target = (now - st.birth) / 1000;
      var d = el.duration;
      if (isFinite(d) && d > 0) target = el.loop ? target % d : Math.min(target, d);
      if (Math.abs(el.currentTime - target) > 0.0005) {
        var seeked = waitEvent(el, 'seeked', 3000);
        el.currentTime = target;
        await seeked;
      }
    }
  }

  function nextDueTimer(limit) {
    var bestId = null;
    var best = null;
    for (var k in timers) {
      var tm = timers[k];
      if (tm.at > limit) continue;
      if (!best || tm.at < best.at || (tm.at === best.at && tm.order < best.order)) {
        best = tm;
        bestId = k;
      }
    }
    return bestId;
  }

  var activity = 0; // last virtual time something happened (used by probe)

  async function runTimers(limit) {
    for (var guard = 0; guard < 100000; guard++) {
      var id = nextDueTimer(limit);
      if (id === null) return;
      var tm = timers[id];
      now = Math.max(now, tm.at);
      if (tm.repeat) {
        tm.at += tm.repeat;
        tm.order = timerOrder++;
      } else {
        delete timers[id];
      }
      try { tm.fn.apply(window, tm.args); } catch (e) { console.error(e); }
      activity = now;
      await Promise.resolve();
      registerAnimations();
    }
  }

  function nextRealFrame() {
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (!done) { done = true; resolve(); } }
      realRAF(finish);
      realSetTimeout(finish, 100);
    });
  }

  // SVG <animate>/<animateTransform>/<set> (SMIL)
  function syncSvg() {
    var svgs = document.getElementsByTagName('svg');
    for (var i = 0; i < svgs.length; i++) {
      var svg = svgs[i];
      if (svg.ownerSVGElement || !svg.setCurrentTime) continue;
      try {
        svg.pauseAnimations();
        svg.setCurrentTime(now / 1000);
      } catch (e) { /* ignore */ }
    }
  }

  async function setTime(t, fast) {
    t = Math.max(t, now);
    await runTimers(t);
    now = t;
    var cbs = rafCbs;
    rafCbs = {};
    for (var k in cbs) {
      try { cbs[k](now); } catch (e) { console.error(e); }
    }
    await Promise.resolve();
    syncAnimations();
    syncSvg();
    if (!fast) {
      await syncMedia();
      await nextRealFrame();
    }
    return now;
  }

  /* ------------------------------------------------------------------ */
  /* Duration probe                                                      */
  /* ------------------------------------------------------------------ */

  // Runs the page forward on the virtual clock (without capturing) to see
  // when it stops changing. The renderer reloads the page afterwards.
  async function probe(maxMs, stepMs) {
    var lastMutation = 0;
    var mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var attr = records[i].attributeName;
        if (attr && attr.indexOf('data-h2v') === 0) continue;
        lastMutation = now;
        return;
      }
    });
    mo.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, characterData: true
    });
    var minCycle = 0;
    var hasCanvas = false;
    var looping = false;
    var t = 0;
    for (; t <= maxMs; t += stepMs) {
      var hadRaf = Object.keys(rafCbs).length > 0;
      await setTime(t, true);
      hasCanvas = hasCanvas || !!document.querySelector('canvas');
      var busy = hadRaf && hasCanvas;
      var list = document.getAnimations ? document.getAnimations() : [];
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (!controlled(a) || !a.effect) continue;
        var ct = a.effect.getComputedTiming();
        if (isFinite(ct.endTime)) {
          if (a.playState !== 'finished' && (Number(a.currentTime) || 0) < ct.endTime) busy = true;
        } else {
          minCycle = Math.max(minCycle, (ct.delay || 0) + (Number(ct.duration) || 0));
        }
      }
      var vids = document.querySelectorAll('video');
      for (var j = 0; j < vids.length; j++) {
        var st = media.get(vids[j]);
        if (st && st.playing && (vids[j].loop || !isFinite(vids[j].duration) ||
            (now - st.birth) / 1000 < vids[j].duration)) busy = true;
      }
      for (var k in timers) {
        if (!timers[k].repeat) { busy = true; break; }
      }
      if (busy) activity = now;
      var last = Math.max(activity, lastMutation);
      if (t - last >= 1500) break;
    }
    mo.disconnect();
    var lastAct = Math.max(activity, lastMutation);
    if (t > maxMs) looping = true;
    return { lastActivity: lastAct, minCycle: minCycle, looping: looping };
  }

  /* ------------------------------------------------------------------ */
  /* Object layers                                                       */
  /* ------------------------------------------------------------------ */

  var SKIP = {
    script: 1, style: 1, link: 1, meta: 1, title: 1, head: 1, template: 1,
    noscript: 1, br: 1, wbr: 1, source: 1, track: 1, param: 1, base: 1
  };
  var ATOMIC = {
    img: 1, svg: 1, video: 1, canvas: 1, iframe: 1, picture: 1, input: 1,
    button: 1, select: 1, textarea: 1, object: 1, embed: 1, i: 1,
    progress: 1, meter: 1, hr: 1, math: 1, audio: 1
  };
  var ICON_CLASS = /(^|\s)(icon|fa|fas|far|fab|fal|fad|bi|glyphicon|material-icons[\w-]*|material-symbols[\w-]*|lucide)(\s|$)|(^|\s)(fa|bi|icon|ri|ti|mdi|ion|feather|lucide)-[\w-]+/i;

  var layers = [];               // { id, el, name, z, order }
  var layerOf = new WeakMap();   // element -> layer
  var cfg = { mode: 'objects', maxLayers: 60 };
  var scanOrder = 0;

  function hasOwnText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true;
    }
    return false;
  }

  function elementKids(el) {
    var out = [];
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (!SKIP[c.localName]) out.push(c);
    }
    return out;
  }

  function hasOwnPaint(el) {
    var cs = getComputedStyle(el);
    if (cs.display === 'none') return false;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    if (!/rgba\(.*,\s*0\)$|transparent/.test(cs.backgroundColor)) return true;
    if (cs.boxShadow && cs.boxShadow !== 'none') return true;
    if ((parseFloat(cs.borderTopWidth) || parseFloat(cs.borderLeftWidth)) &&
        cs.borderTopStyle !== 'none') return true;
    if (cs.maskImage && cs.maskImage !== 'none') return true;
    var b = getComputedStyle(el, '::before').content;
    var a = getComputedStyle(el, '::after').content;
    return (b && b !== 'none' && b !== 'normal') || (a && a !== 'none' && a !== 'normal');
  }

  function isAtomic(el) {
    if (ATOMIC[el.localName]) return true;
    if (el.shadowRoot || el.localName.indexOf('-') > 0) return true;
    var cls = typeof el.className === 'string' ? el.className : '';
    return !!(cls && ICON_CLASS.test(cls) && !el.firstElementChild);
  }

  function zKey(el) {
    var z = 0;
    var positioned = 0;
    for (var e = el; e && e !== document.documentElement; e = e.parentElement) {
      var cs = getComputedStyle(e);
      if (cs.position !== 'static') positioned = 1;
      if (cs.zIndex !== 'auto') { z = parseInt(cs.zIndex, 10) || 0; break; }
    }
    return [z, positioned];
  }

  function label(el) {
    var base = el.localName;
    if (el.id) base += '-' + el.id;
    else if (el.getAttribute('alt')) base += '-' + el.getAttribute('alt');
    else if (hasOwnText(el)) base += '-' + el.textContent.trim().slice(0, 18);
    else if (typeof el.className === 'string' && el.className.trim()) {
      base += '-' + el.className.trim().split(/\s+/)[0];
    }
    return base.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'object';
  }

  function addLayer(el) {
    if (layers.length >= cfg.maxLayers) return;
    var layer = { id: layers.length + 1, el: el, name: label(el), z: zKey(el), order: scanOrder };
    layers.push(layer);
    layerOf.set(el, layer);
    el.setAttribute('data-h2v-id', String(layer.id));
  }

  function visit(el) {
    if (SKIP[el.localName]) return;
    scanOrder++;
    if (layerOf.has(el)) return;
    if (isAtomic(el) || hasOwnText(el)) { addLayer(el); return; }
    var kids = elementKids(el);
    if (!kids.length) {
      if (hasOwnPaint(el)) addLayer(el);
      return;
    }
    for (var i = 0; i < kids.length; i++) visit(kids[i]);
  }

  function scan() {
    if (cfg.mode === 'flat' || !document.body) return;
    scanOrder = 0;
    if (cfg.mode === 'sections') {
      var root = document.body;
      var kids = elementKids(root);
      while (kids.length === 1 && !hasOwnText(root) && elementKids(kids[0]).length && !layerOf.has(kids[0])) {
        root = kids[0];
        kids = elementKids(root);
      }
      for (var i = 0; i < kids.length; i++) {
        scanOrder++;
        if (!layerOf.has(kids[i])) addLayer(kids[i]);
      }
      return;
    }
    var top = elementKids(document.body);
    for (var j = 0; j < top.length; j++) visit(top[j]);
  }

  function effectiveOpacity(el) {
    var o = 1;
    for (var e = el; e && o > 0; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
    return o;
  }

  // Elements that should be shown when a layer is isolated: the layer's
  // subtree (minus nested layers), only where the page itself shows them.
  function collectShow(layer) {
    var out = [];
    (function walk(el) {
      if (el !== layer.el && layerOf.has(el)) return;
      if (getComputedStyle(el).visibility === 'visible') out.push(el);
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) walk(c);
    })(layer.el);
    return out;
  }

  var visibleNow = [];

  // Called once per frame (after setTime): finds new objects and returns
  // which layers are visible in this frame.
  function prepare() {
    clearMarks();
    var before = layers.length;
    scan();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    visibleNow = [];
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      L.show = null;
      if (!L.el.isConnected) continue;
      var r = L.el.getBoundingClientRect();
      var cs = getComputedStyle(L.el);
      if (cs.display === 'contents') r = { width: 1, height: 1, right: 1, bottom: 1, left: 0, top: 0 };
      if (r.width <= 0 && r.height <= 0) continue;
      if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
      if (cs.visibility !== 'visible' && !L.el.firstElementChild) continue;
      if (effectiveOpacity(L.el) <= 0.001) continue;
      L.show = collectShow(L);
      if (!L.show.length) continue;
      visibleNow.push(L);
    }
    return {
      added: layers.slice(before).map(function (L) {
        return { id: L.id, name: L.name, z: L.z, order: L.order };
      }),
      visible: visibleNow.map(function (L) { return L.id; })
    };
  }

  var STYLE_ID = '__h2v_style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      'html.h2v-iso,html.h2v-iso body{background:transparent!important}' +
      'html.h2v-iso *{visibility:hidden!important}' +
      'html.h2v-iso [data-h2v-show]{visibility:visible!important}' +
      'html.h2v-bg [data-h2v-hide],html.h2v-bg [data-h2v-hide] *{visibility:hidden!important}';
    (document.head || document.documentElement).appendChild(s);
  }

  // Our visibility toggles must not start CSS transitions (e.g. on elements
  // with `transition: all`), so any transition we just caused is cancelled.
  function cancelOwnTransitions() {
    if (!document.getAnimations || typeof CSSTransition === 'undefined') return;
    for (var pass = 0; pass < 5; pass++) {
      var list = document.getAnimations();
      var found = 0;
      for (var i = 0; i < list.length; i++) {
        if (list[i] instanceof CSSTransition && !births.has(list[i])) {
          list[i].cancel();
          found++;
        }
      }
      if (!found) return;
    }
  }

  var marked = [];
  function clearMarks() {
    var html = document.documentElement;
    if (!marked.length && !html.classList.contains('h2v-iso') && !html.classList.contains('h2v-bg')) return;
    for (var i = 0; i < marked.length; i++) {
      marked[i].removeAttribute('data-h2v-show');
      marked[i].removeAttribute('data-h2v-hide');
    }
    marked = [];
    html.classList.remove('h2v-iso', 'h2v-bg');
    cancelOwnTransitions();
  }

  // id: a layer id, 'bg' (everything except the layers) or 'none' (blank)
  function isolate(id) {
    ensureStyle();
    clearMarks();
    var html = document.documentElement;
    if (id === 'bg') {
      for (var i = 0; i < visibleNow.length; i++) {
        visibleNow[i].el.setAttribute('data-h2v-hide', '');
        marked.push(visibleNow[i].el);
      }
      html.classList.add('h2v-bg');
    } else {
      if (id !== 'none') {
        var L = layers[id - 1];
        var show = (L && L.show) || [];
        for (var j = 0; j < show.length; j++) {
          show[j].setAttribute('data-h2v-show', '');
          marked.push(show[j]);
        }
      }
      html.classList.add('h2v-iso');
    }
    cancelOwnTransitions();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Stage detection                                                     */
  /* ------------------------------------------------------------------ */

  var COMMON = ['1920x1080', '1080x1920', '1080x1080', '1280x720', '720x1280', '3840x2160',
    '2160x3840', '1080x1350', '1200x628', '1080x1440', '2560x1440', '1440x2560', '1600x900'];

  // Finds the fixed-size "stage" the page draws its video in (often scaled
  // to fit the window) and returns its real size and position.
  function findStage() {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var best = null;
    var all = document.body ? document.body.getElementsByTagName('*') : [];
    for (var i = 0; i < all.length && i < 5000; i++) {
      var el = all[i];
      if (!(el instanceof HTMLElement) || SKIP[el.localName]) continue;
      var lw = el.offsetWidth;
      var lh = el.offsetHeight;
      if (lw < 200 || lh < 200) continue;
      if (Math.abs(lw - vw) < 1 && Math.abs(lh - vh) < 1) continue; // just fills the window
      var r = el.getBoundingClientRect();
      var sx = r.width / lw;
      var sy = r.height / lh;
      var common = COMMON.indexOf(lw + 'x' + lh) >= 0;
      var scaled = Math.abs(sx - sy) < 0.01 && Math.abs(sx - 1) > 0.01;
      if (!common && !scaled) continue;
      var score = (common ? 1e9 : 0) + lw * lh;
      if (!best || score > best.score) {
        best = { score: score, w: lw, h: lh, x: r.left, y: r.top, scale: sx };
      }
    }
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* Object analysis (for editable motion keyframes)                     */
  /* ------------------------------------------------------------------ */

  var FP_PROPS = ['color', 'backgroundColor', 'backgroundImage', 'backgroundPosition', 'backgroundSize',
    'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'borderTopWidth',
    'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopLeftRadius',
    'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius', 'boxShadow', 'filter',
    'backdropFilter', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
    'wordSpacing', 'lineHeight', 'textShadow', 'textDecorationLine', 'webkitTextStrokeWidth',
    'webkitTextStrokeColor', 'fill', 'fillOpacity', 'stroke', 'strokeWidth', 'strokeOpacity',
    'strokeDasharray', 'strokeDashoffset', 'stopColor', 'clipPath', 'maskImage', 'visibility',
    'display', 'outlineColor', 'outlineWidth', 'outlineStyle', 'objectPosition', 'mixBlendMode',
    'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height'];
  var FP_MOVE = ['transform', 'opacity', 'translate', 'rotate', 'scale'];
  var PSEUDO_PROPS = ['content', 'transform', 'opacity', 'color', 'backgroundColor', 'width', 'height', 'left', 'top'];
  var NOT_STILL = { video: 1, canvas: 1, iframe: 1, embed: 1, object: 1, animate: 1,
    animatetransform: 1, animatemotion: 1, set: 1 };

  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36) + ':' + str.length;
  }

  function styleBits(cs, props) {
    var out = '';
    for (var i = 0; i < props.length; i++) out += cs[props[i]] + '|';
    return out;
  }

  // Describes everything about how the object looks, except its own
  // position/scale/rotation/opacity. If this never changes, the object can
  // be one still picture moved by keyframes.
  function fingerprint(L) {
    var parts = [];
    var still = true;
    (function walk(el, isRoot) {
      if (!isRoot && layerOf.has(el)) return;
      var name = el.localName.toLowerCase();
      if (NOT_STILL[name]) still = false;
      var cs = getComputedStyle(el);
      var bits = name + '{' + styleBits(cs, FP_PROPS);
      if (!isRoot) bits += styleBits(cs, FP_MOVE);
      if (el.offsetWidth !== undefined) bits += el.offsetWidth + 'x' + el.offsetHeight;
      if (el.currentSrc) bits += el.currentSrc;
      if (el.namespaceURI === 'http://www.w3.org/2000/svg') {
        var attrs = ['d', 'points', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry',
          'x1', 'y1', 'x2', 'y2', 'transform', 'offset', 'href', 'viewBox'];
        for (var a = 0; a < attrs.length; a++) bits += el.getAttribute(attrs[a]) + ',';
      }
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) bits += '"' + n.nodeValue + '"';
      }
      bits += styleBits(getComputedStyle(el, '::before'), PSEUDO_PROPS);
      bits += styleBits(getComputedStyle(el, '::after'), PSEUDO_PROPS);
      parts.push(bits + '}');
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) walk(c, false);
    })(L.el, true);

    // ancestors: effects that change the look but are not keyframable
    var r = L.el.getBoundingClientRect();
    for (var e = L.el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      var acs = getComputedStyle(e);
      parts.push(acs.filter + acs.mixBlendMode + acs.maskImage + acs.clipPath + acs.perspective);
      if (acs.mixBlendMode !== 'normal' || acs.perspective !== 'none') still = false;
      if (acs.overflowX !== 'visible' || acs.overflowY !== 'visible' || acs.clipPath !== 'none' ||
          acs.maskImage !== 'none') {
        var cr = e.getBoundingClientRect();
        var fr = cfg.frame || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
        var coversFrame = cr.left <= fr.x + 1 && cr.top <= fr.y + 1 &&
          cr.right >= fr.x + fr.width - 1 && cr.bottom >= fr.y + fr.height - 1;
        // clipping at the edge of the video frame is fine: the frame crops anyway
        if (!coversFrame && (r.left < cr.left - 1 || r.top < cr.top - 1 || r.right > cr.right + 1 || r.bottom > cr.bottom + 1)) {
          still = false; // the object is being clipped (a wipe / reveal)
        }
      }
    }
    var own = getComputedStyle(L.el);
    if (own.mixBlendMode !== 'normal' || L.el === document.body) still = false;
    return { fp: hash(parts.join('\n')), still: still };
  }

  // Per visible object: how it looks (fingerprint) and its total opacity.
  function analyze() {
    var out = [];
    for (var i = 0; i < visibleNow.length; i++) {
      var L = visibleNow[i];
      var f = fingerprint(L);
      out.push({ id: L.id, fp: f.fp, still: f.still, op: effectiveOpacity(L.el) });
    }
    return out;
  }

  function layerElement(id) {
    var L = layers[id - 1];
    return L ? L.el : null;
  }

  // Rest pose: show the object without any transform or opacity (its own
  // or its parents'), moved to (x, y) of the viewport, so it can be
  // captured once as a still picture. Uses Web Animations, which never start
  // CSS transitions and are removed again by rest(null).
  var restAnims = [];
  var NEUTRAL = { transform: 'none', opacity: 1, translate: 'none', rotate: 'none', scale: 'none' };

  function overlay(el, extra) {
    var k = {};
    for (var p in NEUTRAL) k[p] = NEUTRAL[p];
    for (var q in extra) k[q] = extra[q];
    var a = origAnimate.call(el, [k, k], { duration: 1e9, fill: 'both' });
    origPause.call(a);
    return a;
  }

  function rest(id, x, y) {
    for (var i = 0; i < restAnims.length; i++) restAnims[i].cancel();
    restAnims = [];
    if (id === null) return null;
    var el = layerElement(id);
    restAnims.push(overlay(el, {}));
    for (var e = el.parentElement; e && e.nodeType === 1; e = e.parentElement) {
      // parents must not clip the object once it is moved to the capture spot
      restAnims.push(overlay(e, { overflow: 'visible', clipPath: 'none', contain: 'none' }));
    }
    var r = el.getBoundingClientRect();
    if (x !== undefined && x !== null) {
      restAnims[0].cancel();
      restAnims[0] = overlay(el, { transform: 'translate(' + (x - r.left) + 'px,' + (y - r.top) + 'px)' });
      r = el.getBoundingClientRect(); // inline elements ignore transforms and stay put
    }
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  // <audio> that should go on the timeline: data-start="seconds" or autoplay
  function audioList() {
    var out = [];
    var list = document.querySelectorAll('audio');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var src = el.currentSrc || el.src || (el.querySelector('source') || {}).src;
      if (!src) continue;
      var start = parseFloat(el.getAttribute('data-start'));
      if (!(start >= 0)) {
        var st = media.get(el);
        if (st && st.playing) start = st.birth / 1000;
        else if (el.autoplay) start = 0;
        else continue;
      }
      out.push({ src: src, start: start, volume: el.muted ? 0 : el.volume });
    }
    return out;
  }

  function configure(opts) {
    for (var k in opts) cfg[k] = opts[k];
    ensureStyle();
  }

  window.__h2v = {
    setTime: setTime,
    probe: probe,
    configure: configure,
    prepare: prepare,
    isolate: isolate,
    restore: clearMarks,
    findStage: findStage,
    analyze: analyze,
    layerElement: layerElement,
    rest: rest,
    audioList: audioList,
    now: function () { return now; }
  };
})();
