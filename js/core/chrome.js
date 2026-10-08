/*
 * Finds and launches a headless Chromium-based browser (Chrome, Edge,
 * Brave or Chromium) that is already installed on the computer, so the
 * plugin itself stays small.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function candidates() {
  const list = [];
  if (process.env.CHROME_PATH) list.push(process.env.CHROME_PATH);
  if (process.platform === 'win32') {
    const roots = [
      process.env['PROGRAMFILES'],
      process.env['PROGRAMFILES(X86)'],
      process.env['LOCALAPPDATA']
    ].filter(Boolean);
    for (const r of roots) {
      list.push(path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      list.push(path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      list.push(path.join(r, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
      list.push(path.join(r, 'Chromium', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    const apps = [
      'Google Chrome.app/Contents/MacOS/Google Chrome',
      'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'Brave Browser.app/Contents/MacOS/Brave Browser',
      'Chromium.app/Contents/MacOS/Chromium',
      'Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
    ];
    for (const a of apps) {
      list.push(path.join('/Applications', a));
      list.push(path.join(os.homedir(), 'Applications', a));
    }
  } else {
    list.push(
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium', '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge'
    );
  }
  return list;
}

function findChrome(preferred) {
  const list = preferred ? [preferred].concat(candidates()) : candidates();
  for (const p of list) {
    try {
      if (p && fs.statSync(p).isFile()) return p;
    } catch (e) { /* not here */ }
  }
  return null;
}

function rmrf(dir) {
  try {
    if (fs.rmSync) fs.rmSync(dir, { recursive: true, force: true });
    else fs.rmdirSync(dir, { recursive: true });
  } catch (e) { /* best effort */ }
}

/**
 * Launches the browser and resolves with { wsUrl, kill() }.
 */
function launch(opts) {
  const exe = findChrome(opts && opts.chromePath);
  if (!exe) {
    return Promise.reject(new Error(
      'No Chrome, Edge, Brave or Chromium browser was found. Install Google Chrome ' +
      'or set the browser path in the plugin settings.'));
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'h2v-profile-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-lcd-text',
    '--hide-scrollbars',
    '--mute-audio',
    '--allow-file-access-from-files',
    '--autoplay-policy=no-user-gesture-required',
    '--force-device-scale-factor=1',
    '--window-size=' + (opts.width || 1920) + ',' + (opts.height || 1080),
    'about:blank'
  ];
  if (process.platform === 'linux' && process.getuid && process.getuid() === 0) {
    args.unshift('--no-sandbox');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    let settled = false;

    const kill = () => {
      try { child.kill(); } catch (e) { /* ignore */ }
      setTimeout(() => rmrf(profile), 500);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      kill();
      reject(new Error('The browser did not start in time.\n' + stderr.slice(-800)));
    }, 30000);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rmrf(profile);
      reject(err);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rmrf(profile);
      reject(new Error('The browser exited (code ' + code + ').\n' + stderr.slice(-800)));
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ wsUrl: m[1], executable: exe, kill });
      }
    });
  });
}

module.exports = { findChrome, launch };
