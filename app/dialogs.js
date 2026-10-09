/*
 * Native "open file" / "choose folder" dialogs without any dependencies:
 * PowerShell on Windows, AppleScript on macOS, zenity/kdialog on Linux.
 * Each resolves with the chosen path, or null when cancelled.
 */
'use strict';

const { execFile } = require('child_process');

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      const out = String(stdout || '').trim();
      resolve(err || !out ? null : out.split(/\r?\n/).pop().trim());
    });
  });
}

function powershell(script) {
  // -STA is required by Windows Forms dialogs; the owner form keeps the
  // dialog in front of the app window.
  const full = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;' +
    'Add-Type -AssemblyName System.Windows.Forms;' +
    '$o = New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false};' +
    script;
  return run('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', full]);
}

function psString(s) {
  return "'" + String(s || '').replace(/'/g, "''") + "'";
}

function openHtml(startDir) {
  if (process.platform === 'win32') {
    return powershell('$d = New-Object System.Windows.Forms.OpenFileDialog;' +
      "$d.Filter = 'HTML files (*.html;*.htm)|*.html;*.htm|All files (*.*)|*.*';" +
      "$d.Title = 'Open an HTML file';" +
      (startDir ? '$d.InitialDirectory = ' + psString(startDir) + ';' : '') +
      "if ($d.ShowDialog($o) -eq 'OK') { $d.FileName }");
  }
  if (process.platform === 'darwin') {
    return run('osascript', ['-e',
      'POSIX path of (choose file with prompt "Open an HTML file" of type {"html", "htm", "public.html"})']);
  }
  return run('zenity', ['--file-selection', '--title=Open an HTML file', '--file-filter=HTML | *.html *.htm'])
    .then((p) => p || run('kdialog', ['--getopenfilename', '.', '*.html *.htm']));
}

function chooseFolder(startDir) {
  if (process.platform === 'win32') {
    return powershell('$d = New-Object System.Windows.Forms.FolderBrowserDialog;' +
      "$d.Description = 'Choose where to save the video';" +
      '$d.ShowNewFolderButton = $true;' +
      (startDir ? '$d.SelectedPath = ' + psString(startDir) + ';' : '') +
      "if ($d.ShowDialog($o) -eq 'OK') { $d.SelectedPath }");
  }
  if (process.platform === 'darwin') {
    return run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose where to save the video")']);
  }
  return run('zenity', ['--file-selection', '--directory', '--title=Choose where to save the video'])
    .then((p) => p || run('kdialog', ['--getexistingdirectory', '.']));
}

function reveal(file) {
  if (process.platform === 'win32') return run('explorer.exe', ['/select,', file]);
  if (process.platform === 'darwin') return run('open', ['-R', file]);
  return run('xdg-open', [require('path').dirname(file)]);
}

module.exports = { openHtml, chooseFolder, reveal };
