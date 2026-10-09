/*
 * "Edit in Premiere Pro / After Effects" for the desktop app:
 *  - installs (or updates) the HTML to Video plugin, which is built into the app
 *  - finds Premiere Pro and After Effects on the computer
 *  - hands a converted HTML file (every object as its own layer) to the
 *    plugin's background helper (agent.html) through a job file, then starts
 *    the program or brings it to the front. The helper builds the sequence /
 *    composition and writes a result file next to the job.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const assets = require('../js/core/assets');

// Files of the plugin (paths relative to the repository root)
const PLUGIN_FILES = [
  'CSXS/manifest.xml', 'index.html', 'agent.html', 'css/style.css', 'LICENSE',
  'js/main.js', 'js/agent.js',
  'js/core/assets.js', 'js/core/cdp.js', 'js/core/chrome.js', 'js/core/encoder.js',
  'js/core/encoder-page.js', 'js/core/inject.js', 'js/core/motion.js', 'js/core/netcache.js',
  'js/core/png.js', 'js/core/renderer.js',
  'js/vendor/mp4-muxer.js', 'js/vendor/mp4-muxer.LICENSE',
  'jsx/host.jsx'
];

const HOSTS = {
  PPRO: { name: 'Premiere Pro', process: 'Adobe Premiere Pro.exe', mac: 'Adobe Premiere Pro' },
  AEFT: { name: 'After Effects', process: 'AfterFX.exe', mac: 'Adobe After Effects' }
};

const HOME = path.join(os.homedir(), '.html-to-video');
const JOBS = path.join(HOME, 'jobs'); // also read by js/agent.js

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

function pluginDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Adobe', 'CEP', 'extensions', 'HTMLtoVideo');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', 'HTMLtoVideo');
  }
  return path.join(os.homedir(), '.config', 'Adobe', 'CEP', 'extensions', 'HTMLtoVideo');
}

/** Is the plugin in place and the same as the one in this app? */
function pluginStatus() {
  const dir = pluginDir();
  let installed = false;
  let current = true;
  for (const f of PLUGIN_FILES) {
    let have = null;
    try { have = fs.readFileSync(path.join(dir, f)); } catch (e) { /* missing */ }
    if (f === 'CSXS/manifest.xml') installed = !!have;
    if (!have || !have.equals(assets.binary(f))) current = false;
  }
  return { installed, current, dir };
}

/** Copies the plugin into Adobe's extensions folder. Returns true when something changed. */
async function installPlugin() {
  const st = pluginStatus();
  if (!st.current) {
    for (const f of PLUGIN_FILES) {
      const dest = path.join(st.dir, f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, assets.binary(f));
    }
  }
  // the plugin is not signed: allow it (Adobe's "debug mode" switch)
  if (process.platform === 'win32') {
    for (let v = 9; v <= 14; v++) {
      await run('reg.exe', ['add', 'HKCU\\Software\\Adobe\\CSXS.' + v, '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f']);
    }
  } else if (process.platform === 'darwin') {
    for (let v = 9; v <= 14; v++) await run('defaults', ['write', 'com.adobe.CSXS.' + v, 'PlayerDebugMode', '1']);
  }
  return !st.current;
}

function yearOf(name) {
  const m = /(\d{4})/.exec(name);
  const beta = /beta/i.test(name) ? -0.5 : 0;
  return (m ? Number(m[1]) : 0) + beta;
}

/** Installed Premiere Pro / After Effects: { PPRO: {path, name} | null, AEFT: ... } */
function findApps() {
  const found = { PPRO: null, AEFT: null };
  const consider = (key, file, label) => {
    if (!fs.existsSync(file)) return;
    if (!found[key] || yearOf(label) > yearOf(found[key].label)) found[key] = { path: file, label };
  };
  if (process.platform === 'win32') {
    const roots = [...new Set([process.env.ProgramW6432, process.env.ProgramFiles, 'C:\\Program Files']
      .filter(Boolean).map((r) => path.join(r, 'Adobe')))];
    for (const root of roots) {
      let dirs = [];
      try { dirs = fs.readdirSync(root); } catch (e) { continue; }
      for (const d of dirs) {
        if (/^Adobe Premiere Pro/i.test(d)) consider('PPRO', path.join(root, d, 'Adobe Premiere Pro.exe'), d);
        if (/^Adobe After Effects/i.test(d)) consider('AEFT', path.join(root, d, 'Support Files', 'AfterFX.exe'), d);
      }
    }
  } else if (process.platform === 'darwin') {
    let dirs = [];
    try { dirs = fs.readdirSync('/Applications'); } catch (e) { /* none */ }
    for (const d of dirs) {
      const key = /^Adobe Premiere Pro/i.test(d) ? 'PPRO' : /^Adobe After Effects/i.test(d) ? 'AEFT' : null;
      if (!key) continue;
      let inner = [];
      try { inner = fs.readdirSync(path.join('/Applications', d)); } catch (e) { continue; }
      const app = inner.find((f) => /\.app$/i.test(f) && f.startsWith(HOSTS[key].mac));
      if (app) consider(key, path.join('/Applications', d, app), d);
    }
  }
  return found;
}

/** Process id of the running program, or 0. */
async function runningPid(key) {
  if (process.platform === 'win32') {
    const out = await run('tasklist.exe', ['/FI', 'IMAGENAME eq ' + HOSTS[key].process, '/FO', 'CSV', '/NH']);
    const m = /^"[^"]+","(\d+)"/m.exec(out);
    return m ? Number(m[1]) : 0;
  }
  if (process.platform === 'darwin') {
    const out = await run('pgrep', ['-f', HOSTS[key].mac + '.*/Contents/MacOS/']);
    return Number(out.trim().split(/\s+/)[0]) || 0;
  }
  return 0;
}

async function status() {
  const apps = findApps();
  const out = { plugin: pluginStatus(), apps: {} };
  for (const key of Object.keys(HOSTS)) {
    out.apps[key] = {
      name: HOSTS[key].name,
      found: !!apps[key],
      label: apps[key] ? apps[key].label : null,
      running: apps[key] ? (await runningPid(key)) > 0 : false
    };
  }
  return out;
}

/** Leaves the job for the plugin's helper inside the program. */
function queueJob(key, manifestPath) {
  fs.mkdirSync(JOBS, { recursive: true });
  // older jobs for this program are no longer wanted
  for (const f of fs.readdirSync(JOBS)) {
    const full = path.join(JOBS, f);
    try {
      if (/\.json$/.test(f) && !/\.result\.json$/.test(f) && JSON.parse(fs.readFileSync(full, 'utf8')).host === key) fs.unlinkSync(full);
      else if (Date.now() - fs.statSync(full).mtimeMs > 7 * 86400000) fs.unlinkSync(full);
    } catch (e) { /* ignore */ }
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const job = { id, host: key, manifest: manifestPath, created: Date.now() };
  const file = path.join(JOBS, id + '.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(job));
  fs.renameSync(file + '.tmp', file); // the helper never sees a half-written file
  return job;
}

/** The helper's answer for a job, or null while it has not answered. */
function jobResult(job) {
  try { return JSON.parse(fs.readFileSync(path.join(JOBS, job.id + '.result.json'), 'utf8')); } catch (e) { return null; }
}

/** Has the helper picked the job up? */
function jobTaken(job) {
  return !fs.existsSync(path.join(JOBS, job.id + '.json'));
}

/** Starts the program, or brings it to the front when it is running. */
async function openApp(key, activate) {
  const app = findApps()[key];
  if (!app) throw new Error(HOSTS[key].name + ' was not found on this computer.');
  const pid = await runningPid(key);
  if (process.platform === 'darwin') {
    await run('open', ['-a', app.path]);
    return { started: !pid };
  }
  if (pid) {
    if (activate) await activate(pid);
    return { started: false };
  }
  const child = spawn(app.path, [], { detached: true, stdio: 'ignore', cwd: path.dirname(app.path) });
  child.on('error', () => { /* reported by the caller's timeout */ });
  child.unref();
  return { started: true };
}

module.exports = { PLUGIN_FILES, HOSTS, JOBS, pluginDir, pluginStatus, installPlugin, findApps, runningPid, status, queueJob, jobResult, jobTaken, openApp };
