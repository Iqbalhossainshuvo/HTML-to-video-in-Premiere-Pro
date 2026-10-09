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

  // Premiere Pro (PPRO) or After Effects (AEFT)
  var hostApp = 'PPRO';
  try { hostApp = JSON.parse(window.__adobe_cep__.getHostEnvironment()).appName || 'PPRO'; } catch (e) { /* PPRO */ }
  var isAE = hostApp === 'AEFT';

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
    chromePath: $('chromePath'), outRoot: $('outRoot'), keyframes: $('keyframes'),
    clear: $('clearBtn'), target: $('target'), stats: $('stats')
  };

  var state = { file: null, busy: false, cancel: false, lastOut: null, target: 'new' };

  /* ---------- build into: new / active sequence ---------- */
  function selectTarget(v) {
    state.target = v === 'active' ? 'active' : 'new';
    Array.prototype.forEach.call(ui.target.children, function (b) {
      b.classList.toggle('sel', b.getAttribute('data-value') === state.target);
    });
  }

  /* ---------- settings persistence ---------- */
  var SETTINGS = ['resolution', 'width', 'height', 'fps', 'duration', 'mode', 'maxLayers', 'chromePath', 'outRoot', 'keyframes'];
  function field(k, v) {
    if (ui[k].type === 'checkbox') {
      if (v !== undefined) ui[k].checked = !!v;
      return ui[k].checked;
    }
    if (v !== undefined) ui[k].value = v;
    return ui[k].value;
  }
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('h2v.settings') || '{}');
      SETTINGS.forEach(function (k) { if (s[k] !== undefined) field(k, s[k]); });
      if (s.target) selectTarget(s.target);
    } catch (e) { /* ignore */ }
    ui.customSize.classList.toggle('hidden', ui.resolution.value !== 'custom');
  }
  function saveSettings() {
    var s = {};
    SETTINGS.forEach(function (k) { s[k] = field(k); });
    s.target = state.target;
    try { localStorage.setItem('h2v.settings', JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  SETTINGS.forEach(function (k) { ui[k].addEventListener('change', saveSettings); });
  ui.target.addEventListener('click', function (e) {
    var v = e.target && e.target.getAttribute('data-value');
    if (!v || state.busy) return;
    selectTarget(v);
    saveSettings();
  });
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
    ui.clear.disabled = busy;
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
    ui.clear.classList.remove('hidden');
    ui.convert.disabled = false;
    ui.stats.classList.add('hidden');
    log('Selected ' + p);
  }

  function clearFile() {
    state.file = null;
    ui.fileName.textContent = 'No file selected';
    ui.filePath.textContent = 'Upload or drop an .html file here';
    ui.fileCard.classList.remove('ready');
    ui.clear.classList.add('hidden');
    ui.convert.disabled = true;
    ui.stats.classList.add('hidden');
    ui.progressBox.classList.add('hidden');
  }
  ui.clear.addEventListener('click', clearFile);

  // Drag & drop an HTML file onto the panel
  function droppedPath(e) {
    var dt = e.dataTransfer;
    if (!dt) return null;
    if (dt.files && dt.files.length && dt.files[0].path) return dt.files[0].path;
    var uri = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split(/\r?\n/)[0].trim();
    if (/^file:/i.test(uri)) {
      try { return nodeRequire('url').fileURLToPath(uri); } catch (err) { return null; }
    }
    return null;
  }
  document.addEventListener('dragover', function (e) {
    e.preventDefault();
    ui.fileCard.classList.add('drag');
  });
  document.addEventListener('dragleave', function () { ui.fileCard.classList.remove('drag'); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    ui.fileCard.classList.remove('drag');
    if (state.busy) return;
    var p = droppedPath(e);
    if (p && /\.html?$/i.test(p)) setFile(p);
    else log('Drop an .html file (or use Upload your file).', 'err');
  });

  function showStats(m) {
    var keyed = m.layers.filter(function (L) { return L.kind === 'motion'; }).length;
    $('statFrames').textContent = m.frames;
    $('statObjects').textContent = m.layers.length;
    $('statKeys').textContent = keyed;
    $('statLength').textContent = (Math.round(m.duration * 10) / 10) + 's';
    ui.stats.classList.remove('hidden');
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
    if (ui.resolution.value === 'auto') {
      w = h = 'auto';
    } else if (ui.resolution.value === 'custom') {
      w = parseInt(ui.width.value, 10);
      h = parseInt(ui.height.value, 10);
    } else {
      var parts = ui.resolution.value.split('x');
      w = parseInt(parts[0], 10);
      h = parseInt(parts[1], 10);
    }
    if (w !== 'auto') {
      if (!(w >= 16 && h >= 16)) throw new Error('Please enter a valid width and height.');
      // Premiere and most codecs prefer even frame sizes
      w -= w % 2;
      h -= h % 2;
    }
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
      keyframes: ui.keyframes.checked,
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
    log('Converting ' + (opts.width === 'auto' ? '(auto size)' : opts.width + '×' + opts.height) +
      ' @ ' + opts.fps + ' fps…');
    setProgress(0, 'Starting…');

    opts.WebSocket = window.WebSocket;
    opts.isCancelled = function () { return state.cancel; };
    opts.onProgress = function (p) {
      if (p.stage === 'analyze') {
        setProgress(p.frame / p.frames * 0.2, p.message);
      } else if (p.stage === 'render') {
        var eta = p.eta > 0 ? ' · ~' + p.eta + 's left' : '';
        setProgress(0.2 + p.frame / p.frames * 0.7, p.message + eta);
      } else if (p.stage === 'warn') {
        log(p.message, 'warn');
      } else {
        setProgress(p.stage === 'done' ? 0.9 : 0.02, p.message);
        log(p.message);
      }
    };

    state.lastOut = opts.outDir;
    renderer.render(opts).then(function (manifest) {
      showStats(manifest);
      setProgress(0.93, 'Building in ' + (isAE ? 'After Effects' : 'Premiere Pro') + '…');
      log('Importing into ' + (isAE ? 'After Effects' : 'Premiere Pro') + '…');
      return evalScript((isAE ? 'h2vAE_build(' : 'h2v_build(') + JSON.stringify(manifest.manifestPath) + ',' +
        JSON.stringify(state.target) + ')');
    }).then(function (result) {
      result = String(result || '');
      if (result.indexOf('OK|') === 0) {
        setProgress(1, 'Done');
        log(result.slice(3), 'ok');
      } else {
        throw new Error(result.replace(/^ERROR\|/, '') || (isAE ? 'After Effects' : 'Premiere Pro') + ' did not respond.');
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

  if (isAE) {
    ui.target.children[0].textContent = 'New composition';
    ui.target.children[1].textContent = 'Active composition';
  }
  loadSettings();
  var browser = renderer.findChrome(ui.chromePath.value.trim() || undefined);
  log(browser ? 'Browser: ' + browser : 'No Chrome/Edge found – set "Browser" in Settings.', browser ? null : 'err');
})();
