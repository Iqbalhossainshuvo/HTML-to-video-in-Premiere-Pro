/*
 * Native "open file" / "choose folder" dialogs without any dependencies:
 * PowerShell on Windows, AppleScript on macOS, zenity/kdialog on Linux.
 * Each resolves with the chosen path, or null when cancelled.
 *
 * On Windows one PowerShell process is started in advance and kept
 * running, so a dialog opens at once; each dialog is brought to the front
 * of the app window.
 */
'use strict';

const path = require('path');
const { execFile, spawn } = require('child_process');

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      const out = String(stdout || '').trim();
      resolve(err || !out ? null : out.split(/\r?\n/).pop().trim());
    });
  });
}

/* ---------- Windows: one PowerShell helper ---------- */

// Reads one JSON command per line, answers "@@<id>@@<result>".
const PS_HELPER = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace H2V -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid);
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
'@
[System.Windows.Forms.Application]::EnableVisualStyles()

function Front([IntPtr]$h) {
  $fg = [H2V.Win]::GetForegroundWindow()
  $other = [H2V.Win]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
  $me = [H2V.Win]::GetCurrentThreadId()
  if ($other -ne $me) { [void][H2V.Win]::AttachThreadInput($me, $other, $true) }
  [void][H2V.Win]::BringWindowToTop($h)
  [void][H2V.Win]::SetForegroundWindow($h)
  if ($other -ne $me) { [void][H2V.Win]::AttachThreadInput($me, $other, $false) }
}

# An invisible, always-on-top owner in the middle of the screen: the dialog
# opens above every other window, including the app's own window.
function Owner {
  $o = New-Object System.Windows.Forms.Form
  $o.TopMost = $true
  $o.ShowInTaskbar = $false
  $o.FormBorderStyle = 'None'
  $o.Opacity = 0
  $o.StartPosition = 'CenterScreen'
  $o.Size = New-Object System.Drawing.Size(1, 1)
  $o.Show()
  Front $o.Handle
  $o.Activate()
  return $o
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $r = ''
  $c = $null
  try {
    $c = $line | ConvertFrom-Json
    switch ($c.op) {
      'open' {
        $o = Owner
        $d = New-Object System.Windows.Forms.OpenFileDialog
        $d.Filter = 'HTML files (*.html;*.htm)|*.html;*.htm|All files (*.*)|*.*'
        $d.Title = 'Open an HTML file'
        if ($c.dir) { $d.InitialDirectory = $c.dir }
        if ($d.ShowDialog($o) -eq 'OK') { $r = $d.FileName }
        $o.Close()
      }
      'folder' {
        $o = Owner
        $d = New-Object System.Windows.Forms.FolderBrowserDialog
        $d.Description = 'Choose where to save the videos'
        $d.ShowNewFolderButton = $true
        if ($c.dir) { $d.SelectedPath = $c.dir }
        if ($d.ShowDialog($o) -eq 'OK') { $r = $d.SelectedPath }
        $o.Close()
      }
      'activate' {
        # bring another program's main window to the front
        $p = Get-Process -Id $c.pid -ErrorAction SilentlyContinue
        if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) {
          if ([H2V.Win]::IsIconic($p.MainWindowHandle)) { [void][H2V.Win]::ShowWindow($p.MainWindowHandle, 9) }
          Front $p.MainWindowHandle
          $r = 'ok'
        }
      }
      'ping' { $r = 'pong' }
    }
  } catch { $r = '' }
  $id = if ($c) { $c.id } else { 0 }
  [Console]::Out.WriteLine('@@' + $id + '@@' + $r)
  [Console]::Out.Flush()
}
`;

let helper = null;

function startHelper() {
  if (helper && !helper.dead) return helper;
  const encoded = Buffer.from(PS_HELPER, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const h = { child, dead: false, waiting: new Map(), next: 1, buf: '' };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    h.buf += d;
    let i;
    while ((i = h.buf.indexOf('\n')) >= 0) {
      const line = h.buf.slice(0, i).replace(/\r$/, '');
      h.buf = h.buf.slice(i + 1);
      const m = /^@@(\d+)@@(.*)$/.exec(line);
      if (m && h.waiting.has(Number(m[1]))) {
        const done = h.waiting.get(Number(m[1]));
        h.waiting.delete(Number(m[1]));
        done(m[2].trim() || null);
      }
    }
  });
  const fail = () => {
    h.dead = true;
    for (const done of h.waiting.values()) done(undefined);
    h.waiting.clear();
  };
  child.on('exit', fail);
  child.on('error', fail);
  child.stdin.on('error', () => { /* helper gone */ });
  helper = h;
  return h;
}

// Sends a command; undefined when the helper is not working.
function ask(cmd) {
  const h = startHelper();
  if (h.dead) return Promise.resolve(undefined);
  const id = h.next++;
  // plain ASCII on the pipe: non-ASCII characters (paths) as \\u escapes
  const json = JSON.stringify(Object.assign({ id }, cmd)).replace(/[\u007f-￿]/g,
    (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
  return new Promise((resolve) => {
    h.waiting.set(id, resolve);
    h.child.stdin.write(json + '\n');
  });
}

/** Starts the Windows helper early, so the first dialog opens at once. */
function warmUp() {
  if (process.platform === 'win32') ask({ op: 'ping' });
}

function psString(s) {
  return "'" + String(s || '').replace(/'/g, "''") + "'";
}

// Fallback: a separate PowerShell for one dialog.
function powershellOnce(script) {
  const full = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;' +
    'Add-Type -AssemblyName System.Windows.Forms;' +
    '$o = New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false; Opacity=0; StartPosition=\'CenterScreen\'};' +
    '$o.Show(); $o.Activate();' + script;
  return run('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', full]);
}

/* ---------- macOS ---------- */

// Asked through System Events so the dialog comes to the front.
function appleScriptChoose(expr) {
  return run('osascript', ['-e', 'tell application "System Events"', '-e', 'activate',
    '-e', 'set p to POSIX path of (' + expr + ')', '-e', 'end tell', '-e', 'return p']);
}

/* ---------- dialogs ---------- */

async function openHtml(startDir) {
  if (process.platform === 'win32') {
    const r = await ask({ op: 'open', dir: startDir || '' });
    if (r !== undefined) return r;
    return powershellOnce('$d = New-Object System.Windows.Forms.OpenFileDialog;' +
      "$d.Filter = 'HTML files (*.html;*.htm)|*.html;*.htm|All files (*.*)|*.*';" +
      (startDir ? '$d.InitialDirectory = ' + psString(startDir) + ';' : '') +
      "if ($d.ShowDialog($o) -eq 'OK') { $d.FileName }");
  }
  if (process.platform === 'darwin') {
    return appleScriptChoose('choose file with prompt "Open an HTML file" of type {"html", "htm", "public.html"}');
  }
  return run('zenity', ['--file-selection', '--title=Open an HTML file', '--file-filter=HTML | *.html *.htm'])
    .then((p) => p || run('kdialog', ['--getopenfilename', '.', '*.html *.htm']));
}

async function chooseFolder(startDir) {
  if (process.platform === 'win32') {
    const r = await ask({ op: 'folder', dir: startDir || '' });
    if (r !== undefined) return r;
    return powershellOnce('$d = New-Object System.Windows.Forms.FolderBrowserDialog;' +
      (startDir ? '$d.SelectedPath = ' + psString(startDir) + ';' : '') +
      "if ($d.ShowDialog($o) -eq 'OK') { $d.SelectedPath }");
  }
  if (process.platform === 'darwin') {
    return appleScriptChoose('choose folder with prompt "Choose where to save the videos"');
  }
  return run('zenity', ['--file-selection', '--directory', '--title=Choose where to save the videos'])
    .then((p) => p || run('kdialog', ['--getexistingdirectory', '.']));
}

/** Brings a running program (by process id) to the front. Windows only. */
function activate(pid) {
  if (process.platform === 'win32') return ask({ op: 'activate', pid: Number(pid) });
  return Promise.resolve(null);
}

function reveal(file) {
  if (process.platform === 'win32') return run('explorer.exe', ['/select,', file]);
  if (process.platform === 'darwin') return run('open', ['-R', file]);
  return run('xdg-open', [path.dirname(file)]);
}

/** Checks that the Windows helper works (used by the build's tests). */
function ping() {
  return ask({ op: 'ping' });
}

function stop() {
  if (helper && !helper.dead) {
    try { helper.child.stdin.end(); helper.child.kill(); } catch (e) { /* ignore */ }
  }
}

module.exports = { openHtml, chooseFolder, reveal, activate, warmUp, ping, stop };
