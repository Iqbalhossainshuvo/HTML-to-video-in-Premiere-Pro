#!/usr/bin/env node
/*
 * Builds the desktop app as ONE executable (Node.js "single executable
 * application"): dist/HTMLtoVideo.exe for Windows (default), or for the
 * current platform with --target current.
 *
 *   npm install          (once: esbuild, postject, resedit)
 *   npm run build:exe    (= node tools/build-exe.js)
 *
 * The .exe contains Node.js, the app and its UI. It renders with the
 * Chrome or Edge already installed on the computer.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(DIST, 'build');
const VERSION = require('../package.json').version;
const ASSETS = [
  'app/ui/index.html', 'app/ui/app.css', 'app/ui/app.js', 'app/ui/icon.svg',
  'js/core/inject.js', 'js/core/encoder-page.js', 'js/vendor/mp4-muxer.js'
];
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const target = (process.argv.find((a) => a.startsWith('--target=')) || '--target=win-x64').split('=')[1];
const isWin = target === 'win-x64' || (target === 'current' && process.platform === 'win32');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error('Download failed ' + res.statusCode + ': ' + url));
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); resolve(); }));
      out.on('error', reject);
      return undefined;
    }).on('error', reject);
  });
}

async function nodeBinary() {
  if (target === 'current') return process.execPath;
  if (target !== 'win-x64') throw new Error('Unknown target ' + target + ' (use win-x64 or current)');
  if (process.platform === 'win32' && process.arch === 'x64') return process.execPath;
  // The blob must come from the same Node.js version as the binary.
  const cache = path.join(DIST, 'cache', 'node-' + process.version + '-win-x64.exe');
  if (!fs.existsSync(cache)) {
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    console.log('Downloading Node.js ' + process.version + ' for Windows…');
    await download('https://nodejs.org/dist/' + process.version + '/win-x64/node.exe', cache);
  }
  return cache;
}

// Icon + file version info shown by Windows Explorer.
function brandWindowsExe(file) {
  const ResEdit = require('resedit');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(file), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(ROOT, 'app', 'icon.ico')));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, 1, 1033, icon.icons.map((i) => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [a, b, c] = VERSION.split('.').map(Number);
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'HTML to Video',
    ProductName: 'HTML to Video',
    CompanyName: 'HTML to Video',
    OriginalFilename: 'HTMLtoVideo.exe',
    InternalName: 'HTMLtoVideo',
    LegalCopyright: 'MIT License'
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(file, Buffer.from(exe.generate()));
}

// Windows GUI app: no black console window when it starts.
function setGuiSubsystem(file) {
  const buf = fs.readFileSync(file);
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('Not a PE file');
  buf.writeUInt16LE(2, pe + 24 + 68); // IMAGE_SUBSYSTEM_WINDOWS_GUI
  fs.writeFileSync(file, buf);
}

async function main() {
  fs.mkdirSync(BUILD, { recursive: true });

  console.log('Bundling…');
  require('esbuild').buildSync({
    entryPoints: [path.join(ROOT, 'app', 'main.js')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: path.join(BUILD, 'app.cjs'),
    logLevel: 'warning'
  });

  const config = {
    main: path.join(BUILD, 'app.cjs'),
    output: path.join(BUILD, 'app.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: {}
  };
  for (const a of ASSETS) config.assets[a] = path.join(ROOT, a);
  fs.writeFileSync(path.join(BUILD, 'sea-config.json'), JSON.stringify(config, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', path.join(BUILD, 'sea-config.json')], { stdio: 'inherit' });

  const out = path.join(DIST, isWin ? 'HTMLtoVideo.exe' : 'HTMLtoVideo');
  fs.copyFileSync(await nodeBinary(), out);
  fs.chmodSync(out, 0o755);

  console.log('Injecting the app…');
  const { inject } = require('postject');
  await inject(out, 'NODE_SEA_BLOB', fs.readFileSync(config.output), {
    sentinelFuse: FUSE,
    machoSegmentName: process.platform === 'darwin' && target === 'current' ? 'NODE_SEA' : undefined
  });
  if (isWin) {
    brandWindowsExe(out); // after injecting: resedit keeps the app's resource
    setGuiSubsystem(out);
  }
  if (process.platform === 'darwin' && target === 'current') {
    try { execFileSync('codesign', ['--sign', '-', '--force', out]); } catch (e) { /* unsigned is fine locally */ }
  }
  console.log('Built ' + path.relative(ROOT, out) + ' (' + (fs.statSync(out).size / 1048576).toFixed(1) + ' MB)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
