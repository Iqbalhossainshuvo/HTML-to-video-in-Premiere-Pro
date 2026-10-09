/*
 * Renders an HTML animation to a video, frame by frame, exactly like the
 * desktop app: the page runs on a virtual clock (inject.js), each frame is
 * captured and handed to the encoder page (WebCodecs H.264 → MP4).
 *
 * Platform independent: the app supplies a RenderHost backed by two
 * WebViews; tests supply one backed by headless Chrome.
 */

export type Progress = { stage: string; message: string; fraction?: number; eta?: number };

export interface RenderHost {
  /**
   * (Re)loads the page with a layout viewport of w × h CSS pixels (the
   * page's own size), captured at about outW × outH pixels; resolves when ready.
   */
  loadPage(w: number, h: number, outW: number, outH: number): Promise<void>;
  evalPage<T = unknown>(expr: string, timeoutMs?: number): Promise<T>;
  /** One picture of the page as it looks now (base64 JPEG or PNG). */
  capture(): Promise<string>;
  /** (Re)loads the encoder page; resolves when ready. */
  loadEncoder(): Promise<void>;
  evalEncoder<T = unknown>(expr: string): Promise<T>;
  /** base64 of a local file referenced by the page (sound), or null. */
  readFileBase64(url: string): Promise<string | null>;
  /** Optional: shows a captured frame while rendering. */
  preview?(picture: string, frame: number): void;
  /**
   * Writes finished pieces of the video file: base64 data `d` at byte
   * position `p`. Called while rendering, so long videos never sit in memory.
   */
  writeChunks(chunks: { p: number; d: string }[]): Promise<void>;
  progress(p: Progress): void;
  cancelled(): boolean;
}

export type Quality = 'medium' | 'high' | 'max';

export interface RenderOptions {
  width: number | 'auto';
  height: number | 'auto';
  fps: number;
  duration: number | 'auto';
  quality: Quality;
  captureType?: string; // mime type of host.capture() pictures
  /** Largest output side in pixels (phones: keeps memory use low). */
  maxOutput?: number;
}

export interface RenderResult {
  width: number;
  height: number;
  fps: number;
  frames: number;
  duration: number;
  codec: string;
  audio: string | null;
  mime: string;
  size: number;
}

const even = (n: number) => Math.max(2, Math.round(n) - (Math.round(n) % 2));

export async function renderVideo(host: RenderHost, opts: RenderOptions): Promise<RenderResult> {
  const check = () => {
    if (host.cancelled()) throw new Error('Cancelled');
  };
  const auto = opts.width === 'auto' || opts.height === 'auto';
  let W = auto ? 1920 : even(Number(opts.width));
  let H = auto ? 1080 : even(Number(opts.height));
  // output size: the page's size, scaled down to fit maxOutput
  let OW = W;
  let OH = H;
  const fitOutput = () => {
    const k = Math.min(1, (opts.maxOutput || Infinity) / Math.max(W, H));
    OW = even(W * k);
    OH = even(H * k);
  };
  fitOutput();
  const load = () => host.loadPage(W, H, OW, OH);

  host.progress({ stage: 'load', message: 'Loading the page…', fraction: 0 });
  await load();

  if (auto) {
    const st = await host.evalPage<{ w: number; h: number } | null>('__h2v.findStage()');
    if (st && (st.w !== W || st.h !== H)) {
      W = even(st.w);
      H = even(st.h);
      fitOutput();
      await load();
    }
    host.progress({ stage: 'info', message: (st ? `Stage found: ${W}×${H}` : `Using ${W}×${H}`) + ` → video ${OW}×${OH}` });
  }
  check();

  let duration = Number(opts.duration);
  if (!(duration > 0)) {
    host.progress({ stage: 'probe', message: 'Measuring animation length…' });
    // up to 5 minutes of animation are measured; longer: type the length
    const m = await host.evalPage<{ duration: number; how: string; probed?: boolean }>(
      '__h2v.measure(300000, 100)', 20 * 60 * 1000);
    duration = Math.min(m.duration, 3600);
    const secs = duration.toFixed(duration % 1 ? 1 : 0) + ' s';
    host.progress({
      stage: 'info',
      message: 'Length: ' + secs + (m.how === 'loop' ? ' (one cycle of an endless animation)' : m.how === 'declared' ? ' (set by the page)' : '')
    });
    if (m.probed) await load(); // start again at t = 0
  }
  check();

  const fps = opts.fps;
  const frames = Math.max(1, Math.round(duration * fps));
  const bpp = { medium: 0.08, high: 0.14, max: 0.25 }[opts.quality] ?? 0.14;
  const bitrate = Math.round(Math.min(40e6, Math.max(1.5e6, OW * OH * fps * bpp)));

  // every piece of the file goes through here (tracks the file size)
  let fileSize = 0;
  const write = async (chunks: { p: number; d: string }[]) => {
    for (const c of chunks) {
      const pad = c.d.endsWith('==') ? 2 : c.d.endsWith('=') ? 1 : 0;
      fileSize = Math.max(fileSize, c.p + (c.d.length / 4) * 3 - pad);
    }
    if (chunks.length) await host.writeChunks(chunks);
  };

  await host.loadEncoder();
  let codecs: { video: string; audio: string | null; mime: string } | null = null;
  const started = Date.now();

  for (let f = 0; f < frames; f++) {
    check();
    await host.evalPage(`__h2v.setTime(${(f * 1000) / fps})`);
    if (!codecs) {
      // sounds are known once the page has started (data-start / autoplay)
      const list = await host.evalPage<{ src: string; start: number; volume: number }[]>('__h2v.audioList()');
      const audio: { data: string; start: number; volume: number }[] = [];
      for (const a of list) {
        const data = await host.readFileBase64(a.src);
        if (data) audio.push({ data, start: a.start, volume: a.volume });
        else host.progress({ stage: 'warn', message: 'Sound not found: ' + a.src });
      }
      codecs = await host.evalEncoder(`__enc.init(${JSON.stringify({
        width: OW, height: OH, fps, bitrate, frames, audio
      })})`);
      host.progress({ stage: 'info', message: 'Encoding ' + codecs!.video + (codecs!.audio ? ' + ' + codecs!.audio : '') });
    }
    const picture = await host.capture();
    if (host.preview && (f % 3 === 0 || f === frames - 1)) host.preview(picture, f);
    const done = await host.evalEncoder<{ p: number; d: string }[]>(
      `__enc.frame(${JSON.stringify(picture)}, ${f}, ${JSON.stringify(opts.captureType || 'image/jpeg')})`);
    await write(done);
    const elapsed = (Date.now() - started) / 1000;
    host.progress({
      stage: 'render',
      message: `Frame ${f + 1} / ${frames}`,
      fraction: ((f + 1) / frames) * 0.95,
      eta: Math.round((elapsed / (f + 1)) * (frames - f - 1))
    });
  }

  host.progress({ stage: 'finish', message: 'Finishing the video file…', fraction: 0.96 });
  const out = await host.evalEncoder<{ p: number; d: string }[] | { size: number; pieces: number }>('__enc.finish()');
  if (Array.isArray(out)) {
    await write(out);
  } else {
    // MediaRecorder fallback: the file is made at the end, read it in pieces
    const PIECE = 3 * 256 * 1024;
    for (let i = 0; i < out.pieces; i++) {
      const piece = await host.evalEncoder<string>(`__enc.piece(${i})`);
      await write([{ p: i * PIECE, d: piece }]);
    }
  }
  host.progress({ stage: 'done', message: `Video ready: ${frames} frames, ${OW}×${OH} @ ${fps} fps`, fraction: 1 });
  return {
    width: OW, height: OH, fps, frames, duration: frames / fps,
    codec: codecs!.video, audio: codecs!.audio, mime: codecs!.mime, size: fileSize
  };
}
