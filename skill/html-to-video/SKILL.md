---
name: html-to-video
description: Make HTML motion videos (promos, explainers, product demos, kinetic type, logo reveals, lower thirds, UI animations, charts, social reels) that the "HTML to Video" Premiere Pro panel turns into an editable Premiere Pro sequence, with every object on its own track and its movement as Premiere keyframes. Use it when the user says "for Premiere", "HTML to Video", "make this editable in Premiere Pro", "send this animation to Premiere", or asks for an HTML / CSS / SVG / GSAP / canvas animation they want to edit in Premiere Pro. Also use it when they have an HTML animation and ask whether it will convert well.
---

# HTML to Video: HTML motion video → editable Premiere Pro sequence

You write the animation the way you normally would (CSS animations,
transitions, Web Animations, GSAP, anime.js, `requestAnimationFrame`, SVG,
canvas, video clips). The user opens the HTML file in the **HTML to Video**
panel in Premiere Pro. The panel plays the page frame by frame on its own
clock, offline, and builds a sequence:

- **V1**: the background (everything that is not an object)
- **one track per object** (heading, paragraph, image, icon, SVG, shape,
  button…), starting at the frame where the object appears
- an object that only **moves, scales, rotates or fades** becomes **one
  picture with Position / Scale / Rotation / Opacity keyframes**, so the
  editor can change the motion in Premiere's Effect Controls
- anything else (text that changes, colour changes, canvas, video, SVG
  shape morphs) becomes a transparent picture sequence on its own track
- `<audio>` becomes a clip on an audio track

## Habits for a clean conversion (always)

1. **One HTML file per video**, with pictures, clips, sounds, fonts **and
   libraries** in an `assets/` folder next to it, linked with relative paths.
   The panel works offline. A CDN `<script>`/Google Font is fine only if
   the user converts once with internet (it is cached afterwards) or the file
   also exists in `assets/` with the same file name (`assets/gsap.min.js`).
   For guaranteed offline use, prefer local copies or system fonts.
2. **A fixed-size stage in px** for the video frame (`1920×1080`, `1080×1920`,
   `1080×1080`…). Scaling the stage to fit the window is fine; the panel finds
   it and uses its real size.
3. **Say how long it is**: `const DURATION = 8;` (seconds) in the script.
   Without it the panel measures the animation, which is slower and can guess
   wrong for loops.
4. **It plays by itself** on page load. No click to start, no scroll
   triggers. `Math.random()` is fine: the panel fixes the seed.
5. **Animate objects with transform and opacity** (`translate`, `scale`,
   `rotate`, `opacity`). Those become Premiere keyframes. Changing
   `width`, `height`, `left`, `top`, colours or text works too, but that
   object then comes in as a picture sequence instead of keyframes.
6. **Keep words as real text** (HTML text or SVG `<text>`), one element per
   line or word that should move on its own. Wrap words/letters in their own
   `<span style="display:inline-block">` when they animate separately; each
   becomes its own track.
7. **Sound**: `<audio src="assets/voice.mp3" data-start="0.5"></audio>`.
   `data-start` is the second on the timeline where it begins. Sound made
   only from JavaScript (`new Audio()`, Web Audio) is not seen.
8. **Video clips**: `<video src="assets/clip.mp4" muted autoplay playsinline>`
   (H.264 MP4).

## What comes in as a picture sequence (not keyframes)

Still exact in position and timing, just not keyframed:
- `<canvas>` / WebGL, `<video>`, SVG `<animate>` (SMIL)
- objects whose look changes: colour, size, border, text, filter or shadow
  animation, morphing SVG paths, typing effects
- skew, mirroring (negative scale), CSS 3D (`rotateX/Y`, perspective)
- objects clipped by a moving mask or `overflow:hidden` reveal (wipes)
- `mix-blend-mode`

That's fine to use. If the user wants a part editable in Premiere, build it
from transform/opacity motion instead, and tell them which parts will be
picture sequences. See `references/convert.md`.

## Deliver

1. Save `<Name>.html` and its `assets/` folder (one folder per video).
2. Tell the user, with the **full path of the HTML file**:
   - preview it: double-click the HTML (opens in Chrome or Edge);
   - convert it: Premiere Pro → **Window → Extensions → HTML to Video** →
     **Upload your file** (or drag the HTML onto the panel), choose
     **New sequence** or **Active sequence**, click **Convert video**;
   - it needs Chrome or Edge installed, no internet (except the first use
     of CDN files that are not in `assets/`);
   - which parts (if any) will be picture sequences.

## Check it

If you can run a browser, open the page once: it must play by itself with a
clean console and no missing files. If the repository's CLI is available:
`node tools/render-cli.js <file.html> <out> --width auto --debug 1` lists
every object and says why one is not keyframed.
