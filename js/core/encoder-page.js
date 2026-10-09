/*
 * HTML to Video – MP4 encoder page.
 * Runs in a (headless) Chrome/Edge tab next to the page being rendered and
 * turns the captured frames into an MP4 with the browser's own encoders
 * (WebCodecs: H.264 + AAC, falling back to VP9/AV1 + Opus) and mp4-muxer.
 * Finished pieces of the file are handed back to Node by drain().
 *
 * Mobile app (collect: true): the whole MP4 is kept here and read back in
 * base64 pieces with piece(i). Without WebCodecs (older phones) it falls
 * back to MediaRecorder on a canvas (MP4 where supported, else WebM).
 */
(function () {
  'use strict';

  var muxer = null;
  var venc = null;
  var cfg = null;
  var chunks = [];
  var failure = null;
  var mem = null;       // collect mode: growing file buffer
  var memSize = 0;
  var result = null;    // collect mode: finished file
  var rec = null;       // MediaRecorder fallback
  var PIECE = 3 * 256 * 1024; // multiple of 3, so base64 pieces can be joined
  var fitCanvas = null;
  var fitCtx = null;

  function toB64(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function fromB64(b64) {
    var bin = atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  function store(data, position) {
    var end = position + data.length;
    if (!mem || end > mem.length) {
      var grown = new Uint8Array(Math.max(end, mem ? mem.length * 2 : 8 * 1024 * 1024));
      if (mem) grown.set(mem.subarray(0, memSize));
      mem = grown;
    }
    mem.set(data, position);
    memSize = Math.max(memSize, end);
  }

  function drain() {
    if (failure) throw failure;
    var out = chunks;
    chunks = [];
    return out;
  }

  // H.264 level for this size and frame rate (macroblocks per second)
  function avcCodecs(w, h, fps) {
    var mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
    var levels = [[31, 3600, 108000], [40, 8192, 245760], [42, 8704, 522240], [50, 22080, 589824],
      [51, 36864, 983040], [52, 36864, 2073600], [60, 139264, 4177920], [62, 139264, 16711680]];
    var out = [];
    for (var i = 0; i < levels.length; i++) {
      if (mbs <= levels[i][1] && mbs * fps <= levels[i][2]) {
        var hex = levels[i][0].toString(16).padStart(2, '0');
        out.push('avc1.6400' + hex, 'avc1.4d00' + hex, 'avc1.4200' + hex);
      }
    }
    return out;
  }

  async function pickVideo(w, h, fps, bitrate) {
    var options = avcCodecs(w, h, fps).map(function (c) { return ['avc', c]; })
      .concat([['vp9', 'vp09.00.40.08'], ['vp9', 'vp09.00.50.08'], ['av1', 'av01.0.08M.08'], ['av1', 'av01.0.12M.08']]);
    for (var i = 0; i < options.length; i++) {
      var config = {
        codec: options[i][1], width: w, height: h, bitrate: bitrate, framerate: fps,
        latencyMode: 'quality'
      };
      if (options[i][0] === 'avc') config.avc = { format: 'avc' };
      try {
        var r = await VideoEncoder.isConfigSupported(config);
        if (r.supported) return { muxCodec: options[i][0], config: config };
      } catch (e) { /* try next */ }
    }
    throw new Error('This browser cannot encode video (no H.264/VP9/AV1 encoder).');
  }

  async function pickAudio(sampleRate, channels) {
    var options = [['aac', 'mp4a.40.2'], ['opus', 'opus']];
    for (var i = 0; i < options.length; i++) {
      var config = { codec: options[i][1], sampleRate: sampleRate, numberOfChannels: channels, bitrate: 192000 };
      try {
        var r = await AudioEncoder.isConfigSupported(config);
        if (r.supported) return { muxCodec: options[i][0], config: config };
      } catch (e) { /* try next */ }
    }
    return null;
  }

  // Mix every <audio> (file bytes + start second) into one stereo track.
  async function mixAudio(list, seconds, rate) {
    var length = Math.max(1, Math.ceil(seconds * rate));
    var ctx = new OfflineAudioContext(2, length, rate);
    var used = 0;
    for (var i = 0; i < list.length; i++) {
      try {
        var buf = await ctx.decodeAudioData(fromB64(list[i].data).buffer);
        var src = ctx.createBufferSource();
        src.buffer = buf;
        var gain = ctx.createGain();
        gain.gain.value = list[i].volume === undefined ? 1 : list[i].volume;
        src.connect(gain).connect(ctx.destination);
        src.start(Math.max(0, list[i].start));
        used++;
      } catch (e) { /* undecodable file: skip */ }
    }
    return used ? ctx.startRendering() : null;
  }

  async function encodeAudio(rendered, audio) {
    var aenc = new AudioEncoder({
      output: function (chunk, meta) { muxer.addAudioChunk(chunk, meta); },
      error: function (e) { failure = e; }
    });
    aenc.configure(audio.config);
    var rate = rendered.sampleRate;
    var block = 1024;
    var left = rendered.getChannelData(0);
    var right = rendered.getChannelData(1);
    for (var pos = 0; pos < rendered.length; pos += block) {
      var n = Math.min(block, rendered.length - pos);
      var planar = new Float32Array(n * 2);
      planar.set(left.subarray(pos, pos + n), 0);
      planar.set(right.subarray(pos, pos + n), n);
      var data = new AudioData({
        format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: 2,
        timestamp: Math.round((pos / rate) * 1e6), data: planar
      });
      aenc.encode(data);
      data.close();
    }
    await aenc.flush();
    aenc.close();
  }

  /**
   * o: { width, height, fps, bitrate, frames, audio: [{ data (base64), start, volume }] }
   */
  async function init(o) {
    cfg = o;
    if (typeof VideoEncoder === 'undefined' || o.forceRecorder) return initRecorder(o);
    var video = await pickVideo(o.width, o.height, o.fps, o.bitrate);
    var rate = 48000;
    var audio = null;
    var rendered = null;
    if (o.audio && o.audio.length) {
      audio = await pickAudio(rate, 2);
      if (audio) rendered = await mixAudio(o.audio, o.frames / o.fps, rate);
      if (!rendered) audio = null;
    }
    var options = {
      target: new Mp4Muxer.StreamTarget({
        onData: function (data, position) {
          if (o.collect) store(data, position);
          else chunks.push({ p: position, d: toB64(data) });
        },
        chunked: true,
        chunkSize: 4 * 1024 * 1024
      }),
      video: { codec: video.muxCodec, width: o.width, height: o.height, frameRate: o.fps },
      fastStart: false,
      firstTimestampBehavior: 'offset'
    };
    if (audio) options.audio = { codec: audio.muxCodec, numberOfChannels: 2, sampleRate: rate };
    muxer = new Mp4Muxer.Muxer(options);

    venc = new VideoEncoder({
      output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); },
      error: function (e) { failure = e; }
    });
    venc.configure(video.config);
    if (audio) await encodeAudio(rendered, audio);
    return { video: video.config.codec, audio: audio ? audio.config.codec : null, mime: 'video/mp4' };
  }

  /* ---- fallback: MediaRecorder on a canvas ----
   * MediaRecorder stamps frames with the real clock, and capturing a frame
   * is slower than playing it. So the (small, compressed) pictures are kept
   * and played into the recorder at the exact frame rate in finish(). */
  var recFrames = [];
  var canvas = null;
  var ctx2d = null;
  var track = null;
  var recChunks = [];
  var recStart = 0;

  function initRecorder(o) {
    if (typeof MediaRecorder === 'undefined') throw new Error('This device cannot encode video.');
    canvas = document.createElement('canvas');
    canvas.width = o.width;
    canvas.height = o.height;
    ctx2d = canvas.getContext('2d');
    var stream = canvas.captureStream(0);
    track = stream.getVideoTracks()[0];
    var types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    var mime = '';
    for (var i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported(types[i])) { mime = types[i]; break; }
    }
    rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: o.bitrate } : {});
    rec.ondataavailable = function (e) { if (e.data && e.data.size) recChunks.push(e.data); };
    recFrames = [];
    return { video: rec.mimeType || mime || 'MediaRecorder', audio: null, mime: (rec.mimeType || mime || 'video/webm').split(';')[0] };
  }

  async function recorderFinish() {
    rec.start();
    recStart = performance.now();
    var next = recFrames.length ? createImageBitmap(recFrames[0]) : null;
    for (var i = 0; i < recFrames.length; i++) {
      var bmp = await next;
      next = i + 1 < recFrames.length ? createImageBitmap(recFrames[i + 1]) : null;
      var due = recStart + (i * 1000) / cfg.fps;
      while (performance.now() < due) await new Promise(function (r) { setTimeout(r, 1); });
      ctx2d.drawImage(bmp, 0, 0, cfg.width, cfg.height);
      if (track.requestFrame) track.requestFrame();
      bmp.close();
    }
    var end = recStart + (recFrames.length * 1000) / cfg.fps;
    while (performance.now() < end) await new Promise(function (r) { setTimeout(r, 1); });
    recFrames = [];
    return new Promise(function (resolve) {
      rec.onstop = function () {
        new Blob(recChunks, { type: rec.mimeType }).arrayBuffer().then(function (buf) {
          result = new Uint8Array(buf);
          resolve({ size: result.length, pieces: Math.ceil(result.length / PIECE) });
        });
      };
      rec.stop();
    });
  }

  // collect mode: the finished file in base64 pieces
  function piece(i) {
    return toB64(result.subarray(i * PIECE, Math.min(result.length, (i + 1) * PIECE)));
  }

  function waitQueue() {
    return new Promise(function (resolve) {
      (function check() {
        if (failure || venc.encodeQueueSize <= 4) resolve();
        else setTimeout(check, 2);
      })();
    });
  }

  // One frame (PNG/JPEG bytes as base64). Returns finished file pieces.
  async function frame(b64, index, type) {
    if (failure) throw failure;
    var blob = new Blob([fromB64(b64)], { type: type || 'image/png' });
    if (rec) {
      recFrames[index] = blob;
      return [];
    }
    var bmp = await createImageBitmap(blob);
    var source = bmp;
    if (bmp.width !== cfg.width || bmp.height !== cfg.height) {
      // a phone's screen capture can be a pixel off the video size
      if (!fitCanvas) {
        fitCanvas = document.createElement('canvas');
        fitCanvas.width = cfg.width;
        fitCanvas.height = cfg.height;
        fitCtx = fitCanvas.getContext('2d');
        fitCtx.imageSmoothingQuality = 'high';
      }
      fitCtx.drawImage(bmp, 0, 0, cfg.width, cfg.height);
      source = fitCanvas;
    }
    var us = 1e6 / cfg.fps;
    var vf = new VideoFrame(source, { timestamp: Math.round(index * us), duration: Math.round(us) });
    venc.encode(vf, { keyFrame: index % Math.max(1, Math.round(cfg.fps * 2)) === 0 });
    vf.close();
    bmp.close();
    await waitQueue();
    return drain();
  }

  async function finish() {
    if (rec) return recorderFinish();
    await venc.flush();
    venc.close();
    muxer.finalize();
    if (cfg.collect) {
      if (failure) throw failure;
      result = mem.subarray(0, memSize);
      return { size: result.length, pieces: Math.ceil(result.length / PIECE) };
    }
    return drain();
  }

  window.__enc = { init: init, frame: frame, finish: finish, drain: drain, piece: piece };
})();
