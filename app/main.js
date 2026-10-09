/*
 * HTML to Video – desktop app (HTMLtoVideo.exe).
 * Starts a private local server and opens the app in its own Chrome / Edge
 * window ("app mode": no tabs or address bar). Closing the window quits.
 *
 *   HTMLtoVideo.exe [file.html]     (dropping an .html file on the exe opens it)
 *   node app/main.js [file.html]    (same, from source)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { createServer } = require('./server');
const { findChrome } = require('../js/core/chrome');

const VERSION = require('../package.json').version;
const logFile = path.join(os.tmpdir(), 'html-to-video-app.log');

function log(msg) {
  try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n'); } catch (e) { /* ignore */ }
}

function alert(msg) {
  log('ALERT ' + msg);
  if (process.platform === 'win32') {
    execFile('powershell.exe', ['-NoProfile', '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show(' +
      "'" + msg.replace(/'/g, "''") + "', 'HTML to Video') | Out-Null"], { windowsHide: true });
  } else if (process.platform === 'darwin') {
    execFile('osascript', ['-e', 'display alert "HTML to Video" message ' + JSON.stringify(msg)]);
  } else {
    console.error(msg);
  }
}

process.on('uncaughtException', (e) => alert('Unexpected error: ' + (e && e.stack || e)));

function openWindow(url, browser) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'h2v-app-'));
  const args = [
    '--app=' + url,
    '--user-data-dir=' + profile,
    '--window-size=1280,820',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-features=Translate,MediaRouter',
    '--autoplay-policy=no-user-gesture-required'
  ];
  if (process.platform === 'linux' && process.getuid && process.getuid() === 0) args.push('--no-sandbox');
  const child = spawn(browser, args, { stdio: 'ignore', windowsHide: false });
  child.profile = profile;
  return child;
}

async function main() {
  const arg = process.argv.slice(2).find((a) => /\.html?$/i.test(a) && fs.existsSync(a));
  const browser = findChrome(process.env.CHROME_PATH);
  if (!browser) {
    alert('HTML to Video needs Google Chrome or Microsoft Edge. Please install one of them and start the app again.');
    process.exit(1);
  }
  const portArg = process.argv.find((a) => a.startsWith('--port='));
  const server = await createServer({
    initialFile: arg ? path.resolve(arg) : null,
    version: VERSION,
    port: portArg ? Number(portArg.split('=')[1]) : 0
  });
  log('listening ' + server.url);

  if (process.argv.includes('--no-window')) {
    // server only (used by tests); the .exe has no console, so this may print nowhere
    try { console.log('HTML to Video running at ' + server.url); } catch (e) { /* no console */ }
    return;
  }

  const win = openWindow(server.url, browser);
  const quit = () => {
    server.close();
    setTimeout(() => {
      try { fs.rmSync(win.profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
      process.exit(0);
    }, 300);
  };
  win.on('exit', quit);
  win.on('error', (e) => {
    alert('Could not open the app window: ' + e.message);
    quit();
  });
  process.on('SIGINT', () => { try { win.kill(); } catch (e) { /* ignore */ } quit(); });
}

main().catch((e) => {
  alert('HTML to Video could not start: ' + (e && e.message || e));
  process.exit(1);
});
