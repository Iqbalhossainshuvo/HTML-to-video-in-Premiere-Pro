# How the HTML to Video panel converts a page

The panel opens the page in headless Chrome/Edge and drives every clock
itself (`Date`, `performance.now`, timers, `requestAnimationFrame`, CSS
animations and transitions, Web Animations, SVG `<animate>`, `<video>`).
`Math.random` gets a fixed seed. It renders frame by frame, so nothing is
dropped and the result looks like the page does in a browser.

## Length and size
- **Length**: `DURATION` / `DURATION_MS` / `TOTAL` / `TOTAL_MS` in the
  script, `window.H2V_DURATION`, or `<meta name="h2v-duration" content="6">`.
  Otherwise it is measured: until nothing changes any more, plus 1 s (a looping
  page: one cycle of its looping CSS animation, else 10 s; max 60 s).
- **Size**: with *Resolution: Auto*, the fixed-size stage element the page
  draws in (a common video size, or an element scaled to fit the window) is
  used at its real size. Otherwise the chosen resolution is the viewport.

## What becomes an object (its own track)
An element is an object when it is an image, `<svg>`, icon (`<i>`, icon-font
classes like `fa-*`, `bi-*`, `material-icons`), `<video>`, `<canvas>`,
`<iframe>`, a form control, a custom element / web component, an element with
its own text, or an empty element that paints something (a card, shape,
line). Containers are not objects: their own background/border stays in the
background track. *Layers: Top-level sections* uses only the top-level blocks.

Tracks are stacked in paint order (z-index, then document order).

## Keyframes
An object becomes **one picture + keyframes** when, over its whole time on
screen:
- only its own (and its parents') transform and opacity change,
- the transform is 2D without skew or mirroring,
- it is not clipped by a parent that clips inside the frame,
- it contains no video, canvas, iframe or SVG `<animate>`, and has no
  `mix-blend-mode`.

The picture is captured once, at rest (no transform, full opacity), at up to
4× resolution when the object is scaled up, so it stays sharp. Keyframes:
- **Position** (Motion), anchor at the picture's centre
- **Scale** (and **Scale Width** when width and height scale differently)
- **Rotation** (no jumps at ±180°)
- **Opacity** (parents' opacity included; 0 while hidden)

Keyframes are linear and reduced to the ones needed: within 0.25 px,
0.1 %, 0.1° and 0.5 % opacity of the real motion. Easing curves therefore
become several keyframes.

Everything else is a transparent PNG sequence on its own track, positioned
exactly where the object is.

## Sound and clips
- `<audio src data-start="1.5">` → audio clip at 1.5 s; autoplaying
  `<audio>` → at the moment it starts. Sound files must be local (or in
  `assets/` with the same name as a URL).
- `<video>` is rendered frame by frame inside its object's picture sequence.

## Offline
No internet is needed. http(s) files are looked up in this order: the
panel's cache, a file with the same name next to the HTML (or in `assets/`,
`libs/`, `lib/`, `js/`, `css/`, `fonts/`, `vendor/`), then the network. Files
downloaded once are cached for later offline use. Files that could not be
loaded are listed in the panel's log.

## Fonts
Any font installed on the computer, `@font-face` files in `assets/`, or web
fonts that were cached during an earlier online conversion. Missing fonts
fall back to the browser's default, so the picture uses the fallback font.
