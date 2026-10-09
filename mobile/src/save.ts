/*
 * Saving the finished video to a folder the user picked once (Android's
 * folder picker, no storage permission needed). The folder is remembered,
 * so the download button saves instantly; the copy is native and checked
 * byte-for-byte by size.
 */
import { Directory, File, FileMode, Paths } from 'expo-file-system';

export interface SaveFolder {
  uri: string;
  name: string;
}

const PREF = () => new File(Paths.document, 'save-folder.json');

/** Readable name for a picked folder, e.g. "Movies" or "Download/Videos". */
export function folderName(uri: string, fallback?: string): string {
  try {
    const tree = decodeURIComponent(uri.split('/tree/')[1] || '');
    const path = tree.replace(/^[^:]*:/, '').replace(/\/document\/.*$/, '');
    if (path) return path;
  } catch { /* use fallback */ }
  return fallback || 'Chosen folder';
}

export function loadSaveFolder(): SaveFolder | null {
  try {
    const f = PREF();
    if (!f.exists) return null;
    const v = JSON.parse(f.textSync());
    return v && v.uri ? v : null;
  } catch {
    return null;
  }
}

function storeSaveFolder(folder: SaveFolder | null) {
  const f = PREF();
  if (!folder) {
    if (f.exists) f.delete();
    return;
  }
  f.create({ overwrite: true });
  f.write(JSON.stringify(folder));
}

/** Opens the folder picker; null when cancelled. */
export async function chooseSaveFolder(): Promise<SaveFolder | null> {
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch (e: any) {
    if (/cancel/i.test(String(e?.message || e) + String(e?.code || ''))) return null;
    throw e;
  }
  const folder = { uri: dir.uri, name: folderName(dir.uri, dir.name) };
  storeSaveFolder(folder);
  return folder;
}

export function forgetSaveFolder() {
  storeSaveFolder(null);
}

/** Copies the video into the folder. Returns the saved file's name and size. */
export async function saveVideo(srcUri: string, fileName: string, mime: string, folder: SaveFolder) {
  const src = new File(srcUri);
  const total = src.size;
  const dir = new Directory(folder.uri);
  const dest = dir.createFile(fileName, mime); // an existing name gets " (1)" added
  try {
    await src.copy(dest, { overwrite: true });
  } catch {
    // fallback: stream it over in 4 MB pieces (never the whole video in memory)
    const input = src.open(FileMode.ReadOnly);
    const output = dest.open(FileMode.WriteOnly);
    try {
      for (;;) {
        const bytes = input.readBytes(4 * 1024 * 1024);
        if (!bytes.length) break;
        output.writeBytes(bytes);
      }
    } finally {
      input.close();
      output.close();
    }
  }
  const saved = new File(dest.uri);
  const size = saved.size;
  if (size && total && size !== total) {
    throw new Error(`The saved file is incomplete (${size} of ${total} bytes). Please try again.`);
  }
  return { name: saved.name || fileName, size: size || total };
}
