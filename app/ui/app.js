/* HTML to Video – desktop app UI */
(function () {
  'use strict';

  var token = document.querySelector('meta[name="h2v-token"]').content;
  var $ = function (id) { return document.getElementById(id); };
  var state = { html: null, video: null, rendering: false, stage: { w: 1920, h: 1080 } };

  function api(route, body) {
    return fetch('/api/' + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Token': token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || r.statusText);
        return j;
      });
    });
  }

  function log(msg, cls) {
    var line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = msg;
    $('log').appendChild(line);
    $('log').scrollTop = $('log').scrollHeight;
  }

  var toastTimer = null;
  function toast(text, actionLabel, action) {
    $('toastText').textContent = text;
    $('toastAction').textContent = actionLabel || '';
    $('toastAction').classList.toggle('hidden', !actionLabel);
    $('toastAction').onclick = action || null;
    $('toast').classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').classList.add('hidden'); }, 7000);
  }

  /* ---------- settings (remembered) ---------- */
  var FIELDS = ['resolution', 'fps', 'duration', 'quality'];
  try {
    var saved = JSON.parse(localStorage.getItem('h2v.app') || '{}');
    FIELDS.forEach(function (k) { if (saved[k]) $(k).value = saved[k]; });
  } catch (e) { /* ignore */ }
  FIELDS.forEach(function (k) {
    $(k).addEventListener('change', function () {
      var s = {};
      FIELDS.forEach(function (f) { s[f] = $(f).value; });
      try { localStorage.setItem('h2v.app', JSON.stringify(s)); } catch (e) { /* ignore */ }
      updateLiveSize();
    });
  });

  /* ---------- file ---------- */
  function setHtml(info) {
    state.html = info;
    $('fileCard').classList.toggle('ready', !!info);
    $('fileName').textContent = info ? info.name : 'No file opened';
    $('filePath').textContent = info ? info.dir : 'Open the .html file of your animation';
    $('renderBtn').disabled = !info || state.rendering;
    if (info) loadLive();
  }

  $('openBtn').addEventListener('click', function () {
    $('openBtn').disabled = true;
    api('open', {}).then(function (r) {
      if (r.picked) {
        setHtml(r.html);
        log('Opened ' + r.html.path);
      }
    }).catch(function (e) { log(e.message, 'err'); }).then(function () { $('openBtn').disabled = false; });
  });

  $('pathForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var p = $('pathInput').value.trim();
    if (!p) return;
    api('open-path', { path: p }).then(function (r) {
      setHtml(r.html);
      $('pathInput').value = '';
      log('Opened ' + r.html.path);
    }).catch(function (err) { log(err.message, 'err'); });
  });

  // A file dropped on the window would replace the app: block it.
  ['dragover', 'drop'].forEach(function (ev) {
    window.addEventListener(ev, function (e) {
      e.preventDefault();
      if (ev === 'drop') toast('Use “Open HTML file” to choose your animation.');
    });
  });

  /* ---------- render ---------- */
  function setRendering(on) {
    state.rendering = on;
    $('renderBtn').classList.toggle('hidden', on);
    $('cancelBtn').classList.toggle('hidden', !on);
    $('openBtn').disabled = on;
    $('renderBtn').disabled = on || !state.html;
    if (on) $('progress').classList.remove('hidden');
  }

  $('renderBtn').addEventListener('click', function () {
    if (!state.html) return;
    var body = {};
    FIELDS.forEach(function (k) { body[k] = $(k).value; });
    setRendering(true);
    setProgress(0, 'Starting…');
    log('Rendering ' + state.html.name + '…');
    api('render', body).catch(function (e) {
      setRendering(false);
      log(e.message, 'err');
    });
  });

  $('cancelBtn').addEventListener('click', function () { api('cancel', {}); });

  function setProgress(fraction, text) {
    if (fraction !== null && fraction !== undefined) {
      $('progressFill').style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
    }
    $('progressText').textContent = text || '';
  }

  var events = new EventSource('/events');
  events.addEventListener('progress', function (e) {
    var p = JSON.parse(e.data);
    if (p.stage === 'render') {
      setProgress(p.fraction, p.message + (p.eta > 0 ? ' · about ' + p.eta + ' s left' : ''));
    } else if (p.stage === 'analyze') {
      setProgress(null, p.message);
    } else {
      setProgress(p.fraction, p.message);
      if (p.stage !== 'start' && p.stage !== 'done') log(p.message, p.stage === 'warn' ? 'warn' : null);
    }
  });
  events.addEventListener('done', function (e) {
    var v = JSON.parse(e.data);
    setRendering(false);
    setProgress(1, 'Done in ' + v.seconds + ' s');
    log('Video ready: ' + v.width + '×' + v.height + ', ' + v.fps + ' fps, ' + v.duration.toFixed(2) + ' s (' +
      v.codecs.video + (v.codecs.audio ? ' + ' + v.codecs.audio : '') + ')', 'ok');
    showVideo(v);
  });
  events.addEventListener('failed', function (e) {
    var f = JSON.parse(e.data);
    setRendering(false);
    setProgress(0, '');
    $('progress').classList.add('hidden');
    log(f.message, 'err');
  });

  /* ---------- player ---------- */
  function mb(bytes) {
    return (bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1) + ' MB';
  }

  function showVideo(v) {
    state.video = v;
    state.stage = { w: v.width, h: v.height };
    $('emptyState').classList.add('hidden');
    $('player').classList.remove('hidden');
    var video = $('video');
    video.src = '/video/' + v.id + '.mp4';
    video.load();
    video.play().catch(function () { /* autoplay may be blocked until a click */ });
    $('videoInfo').textContent = v.width + '×' + v.height + ' · ' + v.fps + ' fps · ' +
      v.duration.toFixed(2) + ' s · ' + mb(v.size);
    selectTab('video');
    updateLiveSize();
  }

  $('downloadBtn').addEventListener('click', function () {
    if (!state.video) return;
    var btn = $('downloadBtn');
    btn.disabled = true;
    api('save', {}).then(function (r) {
      if (!r.saved) return;
      log('Saved ' + r.path, 'ok');
      toast('Saved: ' + r.path, 'Show in folder', function () { api('reveal', { path: r.path }); });
    }).catch(function (e) { log(e.message, 'err'); }).then(function () { btn.disabled = false; });
  });

  /* ---------- tabs / live preview ---------- */
  function selectTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('sel', t.getAttribute('data-tab') === name);
    });
    $('videoView').classList.toggle('hidden', name !== 'video');
    $('liveView').classList.toggle('hidden', name !== 'live');
    if (name === 'live') {
      $('video').pause();
      loadLive();
    } else {
      $('liveFrame').src = 'about:blank'; // stop the live page (and its sound)
    }
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () { selectTab(t.getAttribute('data-tab')); });
  });

  function liveSize() {
    if (state.video) return state.stage;
    var r = $('resolution').value;
    if (r === 'auto') return { w: 1920, h: 1080 };
    var p = r.split('x');
    return { w: Number(p[0]), h: Number(p[1]) };
  }

  function updateLiveSize() {
    var size = liveSize();
    var box = $('liveBox');
    var view = $('liveView');
    var scale = Math.min(view.clientWidth / size.w, view.clientHeight / size.h) || 1;
    box.style.width = size.w + 'px';
    box.style.height = size.h + 'px';
    box.style.transform = 'scale(' + scale + ') translate(-50%, -50%)';
  }
  window.addEventListener('resize', updateLiveSize);

  function loadLive() {
    if (!state.html || $('liveView').classList.contains('hidden')) return;
    updateLiveSize();
    $('liveFrame').src = '/src/' + encodeURIComponent(state.html.name) + '?t=' + Date.now();
  }
  $('replayBtn').addEventListener('click', loadLive);

  $('editBtn').addEventListener('click', function () { $('editDialog').showModal(); });

  /* ---------- start ---------- */
  api('state').then(function (s) {
    if (s.version) $('foot').textContent = 'HTML to Video ' + s.version + ' · works offline';
    if (!s.browser) log('Google Chrome or Microsoft Edge is needed to render. Please install one of them.', 'err');
    if (s.html) setHtml(s.html);
    if (s.video) showVideo(s.video);
    if (s.rendering) setRendering(true);
  }).catch(function (e) { log(e.message, 'err'); });
})();
