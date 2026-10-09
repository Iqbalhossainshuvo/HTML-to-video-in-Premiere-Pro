/*
 * HTML to Video – background helper (no window). Starts with Premiere Pro /
 * After Effects and watches for jobs from the desktop app's "Edit in Premiere /
 * After Effects" button: each job is a converted HTML file (manifest.json);
 * the helper builds it as a new sequence / composition and writes a result
 * file the app reads. Jobs live in ~/.html-to-video/jobs (see app/adobe.js).
 */
(function () {
  'use strict';

  var nodeRequire = window.cep_node ? window.cep_node.require : window.require;
  if (!nodeRequire || !window.__adobe_cep__) return;
  var fs = nodeRequire('fs');
  var os = nodeRequire('os');
  var path = nodeRequire('path');

  var host = 'PPRO';
  try { host = JSON.parse(window.__adobe_cep__.getHostEnvironment()).appName || 'PPRO'; } catch (e) { /* PPRO */ }
  var isAE = host === 'AEFT';
  var DIR = path.join(os.homedir(), '.html-to-video', 'jobs');
  var MAX_AGE = 2 * 60 * 60 * 1000; // older jobs are ignored
  var busy = false;

  function evalScript(script) {
    return new Promise(function (resolve) {
      window.__adobe_cep__.evalScript(script, function (r) { resolve(String(r || '')); });
    });
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function answer(job, ok, message) {
    try {
      fs.writeFileSync(path.join(DIR, job.id + '.result.json'),
        JSON.stringify({ ok: ok, message: message, host: host, at: Date.now() }));
    } catch (e) { /* the app will time out */ }
  }

  // Premiere Pro may still be starting or show its Home screen: make sure a
  // project is open, then build (retrying while the program gets ready).
  function build(job, attempt) {
    var prepare = isAE ? Promise.resolve('OK') :
      evalScript('h2v_ensureProject(' + JSON.stringify(path.dirname(job.manifest)) + ')');
    return prepare.then(function () {
      return evalScript((isAE ? 'h2vAE_build(' : 'h2v_build(') + JSON.stringify(job.manifest) + ',"new")');
    }).then(function (r) {
      if (r.indexOf('OK|') === 0) return r;
      if (attempt < 20) return wait(3000).then(function () { return build(job, attempt + 1); });
      return r;
    });
  }

  function take(job) {
    busy = true;
    build(job, 0).then(function (r) {
      if (r.indexOf('OK|') === 0) {
        answer(job, true, r.slice(3));
        try { window.__adobe_cep__.requestOpenExtension('com.iqbalhossain.htmltovideo.panel', ''); } catch (e) { /* optional */ }
      } else {
        answer(job, false, r.replace(/^ERROR\|/, '') || 'The program did not answer.');
      }
    }).catch(function (e) {
      answer(job, false, (e && e.message) || String(e));
    }).then(function () {
      busy = false;
    });
  }

  function poll() {
    if (busy) return;
    var names;
    try { names = fs.readdirSync(DIR); } catch (e) { return; }
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (!/\.json$/.test(name) || /\.result\.json$/.test(name)) continue;
      var file = path.join(DIR, name);
      var job;
      try { job = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { continue; }
      if (!job || job.host !== host) continue;
      if (Date.now() - job.created > MAX_AGE) continue;
      try {
        fs.renameSync(file, file + '.taken'); // only one window may take it
      } catch (e) {
        continue;
      }
      take(job);
      return;
    }
  }

  setInterval(poll, 1500);
  poll();
})();
