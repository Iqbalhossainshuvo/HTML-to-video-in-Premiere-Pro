/*
 * Prepares a picked file for rendering: copies it (or unpacks a .zip with
 * the HTML and its assets) into a fresh folder in the app's cache, and
 * writes our runtime next to the HTML.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { strFromU8, unzipSync } from 'fflate';
import { PAGE_RUNTIME_JS, RUNTIME_FILE, instrumentHtml } from '../runtime/html';

export interface Job {
  dir: Directory;        // job folder (WebView read access)
  main: File;            // the HTML file the WebView loads
  html: string;          // original HTML text
  title: string;
}

const isHtml = (name: string) => /\.html?$/i.test(name);

export async function prepareJob(uri: string, name: string): Promise<Job> {
  const dir = new Directory(Paths.cache, 'h2v-job-' + Date.now());
  dir.create({ intermediates: true });
  const picked = new File(uri);

  let mainPath: string;
  if (/\.zip$/i.test(name)) {
    const entries = unzipSync(await picked.bytes());
    const htmls: string[] = [];
    for (const [path, data] of Object.entries(entries)) {
      if (path.endsWith('/') || path.startsWith('__MACOSX/') || path.includes('..')) continue;
      const f = new File(dir, path);
      f.create({ intermediates: true, overwrite: true });
      f.write(data);
      if (isHtml(path)) htmls.push(path);
    }
    if (!htmls.length) throw new Error('The ZIP file has no .html file in it.');
    // index.html closest to the top, else the first HTML closest to the top
    const depth = (p: string) => p.split('/').length;
    htmls.sort((a, b) => depth(a) - depth(b) ||
      Number(!/(^|\/)index\.html?$/i.test(a)) - Number(!/(^|\/)index\.html?$/i.test(b)) || a.localeCompare(b));
    mainPath = htmls[0];
  } else if (isHtml(name)) {
    mainPath = name.replace(/[\\/]/g, '_');
    picked.copySync(new File(dir, mainPath));
  } else {
    throw new Error('Please choose an .html file, or a .zip with your HTML and its assets.');
  }

  const main = new File(dir, mainPath);
  const html = /\.zip$/i.test(name) ? strFromU8(await main.bytes()) : await main.text();
  const runtime = new File(main.parentDirectory, RUNTIME_FILE);
  runtime.create({ overwrite: true });
  runtime.write(PAGE_RUNTIME_JS);
  return { dir, main, html, title: mainPath.split('/').pop()!.replace(/\.[^.]+$/, '') };
}

/** Rewrites the HTML for a viewport of w × h CSS px shown at `scale`. */
export function writeMain(job: Job, w: number, h: number, scale: number) {
  job.main.write(instrumentHtml(job.html, w, h, scale));
}

export function removeJob(job: Job | null) {
  try { if (job && job.dir.exists) job.dir.delete(); } catch { /* ignore */ }
}

/** Where finished videos are kept (inside the app). */
export function outputFile(title: string, ext: string): File {
  const dir = new Directory(Paths.document, 'videos');
  if (!dir.exists) dir.create({ intermediates: true });
  const safe = title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'video';
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return new File(dir, `${safe}-${stamp}.${ext}`);
}
