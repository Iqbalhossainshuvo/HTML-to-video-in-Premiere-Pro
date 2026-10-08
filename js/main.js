/*
 * HTML to Video – Premiere Pro panel.
 * Upload an HTML file, render it frame by frame (js/core/renderer.js), then
 * build a sequence in Premiere Pro with one track per object (jsx/host.jsx).
 */
(function () {
  'use strict';

  var nodeRequire = window.cep_node ? window.cep_node.require : window.require;
  if (!nodeRequire) {
    document.body.innerHTML = '<p style="padding:12px">Node.js is not enabled for this panel. ' +
      'Please reinstall the extension.</p>';
    return;
  }
  var path = nodeRequire('path');
  var os = nodeRequire('os');
  var fs = nodeRequire('fs');
  var childProcess = nodeRequire('child_process');

  function extensionRoot() {
    var p = decodeURIComponent(window.location.pathname);
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // Windows: /C:/...
    return path.dirname(p);
  }
  var renderer = nodeRequire(path.join(extensionRoot(), 'js', 'core', 'renderer.js'));

  function evalScript(script) {
    return new Promise(function (resolve) {
      window.__adobe_cep__.evalScript(script, resolve);
    });
  }

  var $ = function (id) { return document.getElementById(id); };
  var ui = {
    fileCard: $('fileCard'), fileName: $('fileName'), filePath: $('filePath'),
    upload: $('uploadBtn'), convert: $('convertBtn'), cancel: $('cancelBtn'),
    progressBox: $('progressBox'), progressFill: $('progressFill'), progressText: $('progressText'),
    log: $('log'), openFolder: $('openFolderBtn'),
    resolution: $('resolution'), customSize: $('customSize'), width: $('width'), height: $('height'),
    fps: $('fps'), duration: $('duration'), mode: $('mode'), maxLayers: $('maxLayers'),
    chromePath: $('chromePath'), outRoot: $('outRoot')
  };

  var state = { file: null, busy: false, cancel: false, lastOut: null };

  /* ---------- settings persistence ---------- */
  var SETTINGS = ['resolution', 'width', 'height', 'fps', 'duration', 'mode', 'maxLayers', 'chromePath', 'outRoot'];
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('h2v.settings') || '{}');
      SETTINGS.forEach(function (k) { if (s[k] !== undefined) ui[k].value = s[k]; });
    } catch (e) { /* ignore */ }
    ui.customSize.classList.toggle('hidden', ui.resolution.value !== 'custom');
  }
  function saveSettings() {
    var s = {};
    SETTINGS.forEach(function (k) { s[k] = ui[k].value; });
    try { localStorage.setItem('h2v.settings', JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  SETTINGS.forEach(function (k) { ui[k].addEventListener('change', saveSettings); });
  ui.resolution.addEventListener('change', function () {
    ui.customSize.classList.toggle('hidden', ui.resolution.value !== 'custom');
  });

  /* ---------- log / progress ---------- */
  function log(msg, cls) {
    var line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = msg;
    ui.log.appendChild(line);
    ui.log.scrollTop = ui.log.scrollHeight;
  }
  function setProgress(fraction, text) {
    ui.progressBox.classList.remove('hidden');
    ui.progressFill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
    ui.progressText.textContent = text || '';
  }
  function setBusy(busy) {
    state.busy = busy;
    ui.upload.disabled = busy;
    ui.convert.classList.toggle('hidden', busy);
    ui.cancel.classList.toggle('hidden', !busy);
    ui.convert.disabled = busy || !state.file;
  }

  /* ---------- upload ---------- */
  function setFile(p) {
    state.file = p;
    ui.fileName.textContent = path.basename(p);
    ui.filePath.textContent = path.dirname(p);
    ui.fileCard.classList.add('ready');
    ui.convert.disabled = false;
    log('Selected ' + p);
  }

  function pickFile() {
    var picked = null;
    try {
      if (window.cep && window.cep.fs && window.cep.fs.showOpenDialogEx) {
        var r = window.cep.fs.showOpenDialogEx(false, false, 'Select an HTML file', '', ['html', 'htm']);
        if (r && r.err === 0 && r.data && r.data.length) picked = r.data[0];
        if (r && r.err === 0) return Promise.resolve(picked);
      }
    } catch (e) { /* fall back to ExtendScript */ }
    return evalScript('h2v_pickFile()').then(function (p) { return p || null; });
  }

  ui.upload.addEventListener('click', function () {
    pickFile().then(function (p) { if (p) setFile(p); });
  });

  /* ---------- convert ---------- */
  function stamp() {
    var d = new Date();
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' +
      two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
  }

  function readOptions() {
    var w, h;
    if (ui.resolution.value === 'custom') {
      w = parseInt(ui.width.value, 10);
      h = parseInt(ui.height.value, 10);
    } else {
      var parts = ui.resolution.value.split('x');
      w = parseInt(parts[0], 10);
      h = parseInt(parts[1], 10);
    }
    if (!(w >= 16 && h >= 16)) throw new Error('Please enter a valid width and height.');
    // Premiere and most codecs prefer even frame sizes
    w -= w % 2;
    h -= h % 2;
    var dur = String(ui.duration.value).trim().toLowerCase();
    var duration = dur === '' || dur === 'auto' ? 'auto' : parseFloat(dur);
    if (duration !== 'auto' && !(duration > 0)) throw new Error('Duration must be "auto" or a number of seconds.');
    var root = ui.outRoot.value.trim() || path.join(os.homedir(), 'Documents', 'HTML to Video');
    var base = path.basename(state.file).replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
    return {
      htmlPath: state.file,
      outDir: path.join(root, base + '_' + stamp()),
      width: w,
      height: h,
      fps: parseInt(ui.fps.value, 10),
      duration: duration,
      mode: ui.mode.value,
      maxLayers: Math.max(1, parseInt(ui.maxLayers.value, 10) || 60),
      chromePath: ui.chromePath.value.trim() || undefined
    };
  }

  ui.convert.addEventListener('click', function () {
    if (!state.file || state.busy) return;
    var opts;
    try {
      opts = readOptions();
    } catch (e) {
      log(e.message, 'err');
      return;
    }
    if (!fs.existsSync(state.file)) {
      log('The file no longer exists: ' + state.file, 'err');
      return;
    }
    state.cancel = false;
    setBusy(true);
    ui.openFolder.classList.add('hidden');
    log('Rendering ' + opts.width + '×' + opts.height + ' @ ' + opts.fps + ' fps…');
    setProgress(0, 'Starting…');

    opts.WebSocket = window.WebSocket;
    opts.isCancelled = function () { return state.cancel; };
    opts.onProgress = function (p) {
      if (p.stage === 'render') {
        var eta = p.eta > 0 ? ' · ~' + p.eta + 's left' : '';
        setProgress(p.frame / p.frames * 0.9, p.message + eta);
      } else {
        setProgress(p.stage === 'done' ? 0.9 : 0.02, p.message);
        log(p.message);
      }
    };

    state.lastOut = opts.outDir;
    renderer.render(opts).then(function (manifest) {
      setProgress(0.93, 'Building Premiere Pro sequence…');
      log('Importing into Premiere Pro…');
      return evalScript('h2v_build(' + JSON.stringify(manifest.manifestPath) + ')');
    }).then(function (result) {
      result = String(result || '');
      if (result.indexOf('OK|') === 0) {
        setProgress(1, 'Done');
        log(result.slice(3), 'ok');
      } else {
        throw new Error(result.replace(/^ERROR\|/, '') || 'Premiere Pro did not respond.');
      }
    }).catch(function (e) {
      setProgress(0, '');
      log((e && e.message) || String(e), 'err');
    }).then(function () {
      setBusy(false);
      if (state.lastOut && fs.existsSync(state.lastOut)) ui.openFolder.classList.remove('hidden');
    });
  });

  ui.cancel.addEventListener('click', function () {
    state.cancel = true;
    log('Cancelling…');
  });

  ui.openFolder.addEventListener('click', function () {
    if (!state.lastOut) return;
    var cmd = os.platform() === 'win32' ? 'explorer' : 'open';
    childProcess.spawn(cmd, [state.lastOut], { detached: true, stdio: 'ignore' }).unref();
  });

  loadSettings();
  var browser = renderer.findChrome(ui.chromePath.value.trim() || undefined);
  log(browser ? 'Browser: ' + browser : 'No Chrome/Edge found – set "Browser" in Settings.', browser ? null : 'err');
})();
