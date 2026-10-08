/*
 * Turns what an object did on every frame (its on-screen corner points and
 * opacity) into Premiere Pro Motion / Opacity keyframes, keeping only the
 * keyframes that are needed to reproduce the movement.
 */
'use strict';

// quad: [x1,y1, x2,y2, x3,y3, x4,y4] (top-left, top-right, bottom-right,
// bottom-left) of a w×h box -> affine matrix [a,b,c,d,e,f] or null when the
// box is not a parallelogram (3D perspective).
function quadToMatrix(q, w, h) {
  if (!(w > 0 && h > 0)) return null;
  const a = (q[2] - q[0]) / w;
  const b = (q[3] - q[1]) / w;
  const c = (q[6] - q[0]) / h;
  const d = (q[7] - q[1]) / h;
  const brx = q[0] + a * w + c * h;
  const bry = q[1] + b * w + d * h;
  if (Math.abs(brx - q[4]) > 0.75 || Math.abs(bry - q[5]) > 0.75) return null;
  return [a, b, c, d, q[0], q[1]];
}

// matrix -> { sx, sy, rot } or null when it skews or mirrors (no Premiere equivalent)
function decompose(m) {
  const [a, b, c, d] = m;
  const sx = Math.hypot(a, b);
  const det = a * d - b * c;
  if (sx < 1e-4 || det <= 1e-8) return null;
  const sy = det / sx;
  const skew = (a * c + b * d) / (sx * Math.hypot(c, d));
  if (Math.abs(skew) > 0.01) return null;
  return { sx, sy, rot: (Math.atan2(b, a) * 180) / Math.PI };
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Can this object be one still picture + keyframes? Returns null if yes,
 * otherwise the reason why not.
 * samples: [{ frame, m, op, fp, still }] for the frames it is visible.
 */
function whyNotRigid(samples) {
  if (!samples.length) return 'never visible';
  const fp = samples[0].fp;
  for (const s of samples) {
    if (!s.still) return 'clipped, blended, video or canvas';
    if (s.fp !== fp) return 'its look changes';
    if (!s.m) return '3D or no box';
    if (!decompose(s.m)) return 'skewed or mirrored';
  }
  return null;
}

function isRigid(samples) {
  return whyNotRigid(samples) === null;
}

// Ramer–Douglas–Peucker on keyframes [[frame, v1, v2...]] with linear
// interpolation and a tolerance per value.
function simplify(points, tol) {
  if (points.length <= 2) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const p0 = points[i0];
    const p1 = points[i1];
    let worst = -1;
    let worstErr = 1;
    for (let i = i0 + 1; i < i1; i++) {
      const t = (points[i][0] - p0[0]) / (p1[0] - p0[0]);
      let err = 0;
      for (let k = 1; k < p0.length; k++) {
        const v = p0[k] + (p1[k] - p0[k]) * t;
        err = Math.max(err, Math.abs(points[i][k] - v) / tol[k - 1]);
      }
      if (err > worstErr) {
        worstErr = err;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([i0, worst], [worst, i1]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Build keyframes for a still picture of the object.
 *  samples   per-frame data while visible ({frame, m, op})
 *  startFrame/endFrame  clip range on the timeline (inclusive)
 *  img       { dx, dy, cw, ch, scale } picture area in the object's own
 *            coordinates (CSS px) and the capture scale
 *  stage     { width, height, x, y } video frame in viewport coordinates
 * Frames are relative to the clip start.
 */
function buildKeys(samples, startFrame, endFrame, img, stage) {
  const byFrame = new Map(samples.map((s) => [s.frame, s]));
  const pos = [];
  const sw = [];
  const sh = [];
  const rot = [];
  const op = [];
  let last = null;
  let prevRot = null;
  for (let f = startFrame; f <= endFrame; f++) {
    const s = byFrame.get(f);
    const rel = f - startFrame;
    if (!s) {
      op.push([rel, 0]); // hidden in this frame
      continue;
    }
    last = s;
    const dec = decompose(s.m);
    const c = apply(s.m, img.dx + img.cw / 2, img.dy + img.ch / 2);
    pos.push([rel, (c[0] - stage.x) / stage.width, (c[1] - stage.y) / stage.height]);
    sw.push([rel, (dec.sx * 100) / img.scale]);
    sh.push([rel, (dec.sy * 100) / img.scale]);
    let r = dec.rot;
    if (prevRot !== null) r += Math.round((prevRot - r) / 360) * 360; // no jumps at ±180°
    prevRot = r;
    rot.push([rel, r]);
    op.push([rel, Math.max(0, Math.min(100, s.op * 100))]);
  }
  void last;
  const uniform = sw.every((p, i) => Math.abs(p[1] - sh[i][1]) < 0.05);
  const pxTol = 0.25;
  return {
    uniform,
    position: simplify(pos, [pxTol / stage.width, pxTol / stage.height]),
    scale: simplify(sh, [0.1]),
    scaleWidth: uniform ? null : simplify(sw, [0.1]),
    rotation: simplify(rot, [0.1]),
    opacity: simplify(op, [0.5])
  };
}

module.exports = { quadToMatrix, decompose, isRigid, whyNotRigid, simplify, buildKeys, apply };
