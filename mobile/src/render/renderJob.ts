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
  evalPage<T = unknown>(expr: string): Promise<T>;
  /** One picture of the page as it looks now (base64 JPEG or PNG). */
  capture(): Promise<string>;
  /** (Re)loads the encoder page; resolves when ready. */
  loadEncoder(): Promise<void>;
  evalEncoder<T = unknown>(expr: string): Promise<T>;
  /** base64 of a local file referenced by the page (sound), or null. */
  readFileBase64(url: string): Promise<string | null>;
  /** Optional: shows a captured frame while rendering. */
  preview?(picture: string, frame: number): void;
  /** Writes the next piece of the output file (base64). */
  appendOutput(b64: string, first: boolean): Promise<void>;
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

const DECLARED_DURATION = `(function () {
  function g(n) { try { return (0, eval)(n); } catch (e) { return undefined; } }
  var v;
  if ((v = Number(window.H2V_DURATION)) > 0) return v;
  var m = document.querySelector('meta[name="h2v-duration"]');
  if (m && (v = Number(m.content)) > 0) return v;
  if ((v = Number(g('DURATION_MS'))) > 0 || (v = Number(g('TOTAL_MS'))) > 0) return v / 1000;
  if ((v = Number(g('DURATION'))) > 0 || (v = Number(g('TOTAL'))) > 0) return v > 600 ? v / 1000 : v;
  return 0;
})()`;

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
    const declared = await host.evalPage<number>(DECLARED_DURATION);
    if (declared > 0) {
      duration = declared;
    } else {
      const p = await host.evalPage<{ lastActivity: number; minCycle: number; looping: boolean }>(
        '__h2v.probe(20000, 50)');
      if (p.looping) duration = p.minCycle > 0 ? p.minCycle / 1000 : 10;
      else duration = Math.max(p.lastActivity + 1000, p.minCycle, 1000) / 1000;
      duration = Math.min(duration, 60);
      await load(); // start again at t = 0
    }
  }
  check();

  const fps = opts.fps;
  const frames = Math.max(1, Math.round(duration * fps));
  const bpp = { medium: 0.08, high: 0.14, max: 0.25 }[opts.quality] ?? 0.14;
  const bitrate = Math.round(Math.min(40e6, Math.max(1.5e6, OW * OH * fps * bpp)));

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
        width: OW, height: OH, fps, bitrate, frames, audio, collect: true
      })})`);
      host.progress({ stage: 'info', message: 'Encoding ' + codecs!.video + (codecs!.audio ? ' + ' + codecs!.audio : '') });
    }
    const picture = await host.capture();
    if (host.preview && (f % 3 === 0 || f === frames - 1)) host.preview(picture, f);
    await host.evalEncoder(`__enc.frame(${JSON.stringify(picture)}, ${f}, ${JSON.stringify(opts.captureType || 'image/jpeg')})`);
    const elapsed = (Date.now() - started) / 1000;
    host.progress({
      stage: 'render',
      message: `Frame ${f + 1} / ${frames}`,
      fraction: ((f + 1) / frames) * 0.95,
      eta: Math.round((elapsed / (f + 1)) * (frames - f - 1))
    });
  }

  host.progress({ stage: 'finish', message: 'Finishing the video file…', fraction: 0.96 });
  const out = await host.evalEncoder<{ size: number; pieces: number }>('__enc.finish()');
  for (let i = 0; i < out.pieces; i++) {
    const piece = await host.evalEncoder<string>(`__enc.piece(${i})`);
    await host.appendOutput(piece, i === 0);
  }
  host.progress({ stage: 'done', message: `Video ready: ${frames} frames, ${OW}×${OH} @ ${fps} fps`, fraction: 1 });
  return {
    width: OW, height: OH, fps, frames, duration: frames / fps,
    codec: codecs!.video, audio: codecs!.audio, mime: codecs!.mime, size: out.size
  };
}
