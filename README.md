# HTML to Video for Adobe Premiere Pro

A lightweight Premiere Pro panel that turns any **HTML file into video, frame by
frame**, playing it exactly as it plays in a web browser, and puts **every
object and icon on its own track** so you can edit, move, re-time or delete any
of them.

```
┌ HTML to Video ──────────┐      Timeline
│ [HTML] promo.html       │      V9  ▕ counter ───────────────────▏
│                         │      V8  ▕ ball ──────────▏
│ [ Upload your file   ]  │      V7  ▕          ▕ ✓ icon ─────────▏
│ [ Convert video      ]  │      V6  ▕        ▕ ★ icon ───────────▏
│ ▓▓▓▓▓▓▓▓░░░ Frame 70/120│      V5  ▕      ▕ ♥ icon ─────────────▏
│ ▸ Settings              │      V4  ▕   ▕ subtitle ──────────────▏
└─────────────────────────┘      V3  ▕▕ title ───────────────────▏
                                 V2  ▕ card ─────────────────────▏
                                 V1  ▕ background ───────────────▏
```

## What it does

1. **Upload your file**: pick any `.html` / `.htm` file. Its CSS, images, fonts,
   SVGs, scripts and videos are loaded from the same folder, just as in a browser.
2. **Convert video**: the page plays in a hidden (headless) Chrome/Edge on a
   *virtual clock* and is captured frame by frame. It never drops or skips a
   frame, even when your computer is slow.
3. A new sequence opens in Premiere Pro:
   - **V1 – Background**: the page without its objects.
   - **V2, V3, …**: one **transparent** track per object (heading, paragraph,
     image, icon, SVG, button, shape…), stacked in the same order the browser
     paints them.
   - Each clip **starts at the frame where its object first appears**, so the
     timeline shows elements arriving one by one.

Nothing is cut or removed: stacking all the tracks gives back the original page
pixel for pixel. Anything that isn't its own object stays in the background track.

### What gets captured exactly

| Page uses | Supported |
|---|---|
| CSS `@keyframes` animations, CSS transitions | ✅ |
| Web Animations API (`element.animate`) | ✅ |
| JavaScript animation (`requestAnimationFrame`, GSAP, anime.js, Lottie…) | ✅ |
| `setTimeout` / `setInterval`, `Date`, `performance.now()` | ✅ (virtual time) |
| `<video>` elements | ✅ (seeked frame by frame) |
| `<canvas>` / WebGL | ✅ (as one object) |
| Web fonts, icon fonts (Font Awesome, Material Icons, Bootstrap Icons…), inline SVG | ✅ |
| Audio | ❌ not exported. Add your soundtrack in Premiere |

## Requirements

- Adobe Premiere Pro **2020 (14.0) or newer**, Windows or macOS
- **Google Chrome, Microsoft Edge, Brave or Chromium** installed. Edge ships
  with Windows 10/11, so Windows users usually need nothing extra. The plugin
  uses your installed browser instead of bundling one, which keeps it small:
  **no npm install, no dependencies**.

## Install

1. Download this repository (green **Code → Download ZIP**) and unzip it.
2. Run the installer:
   - **Windows**: double-click `scripts\install-win.bat`
   - **macOS**: open Terminal and run `bash scripts/install-mac.sh`
3. Restart Premiere Pro.
4. Open **Window → Extensions → HTML to Video**. Drag the panel to the left or
   right side of your workspace and dock it there.

The installer copies the panel to the CEP extensions folder and turns on
`PlayerDebugMode` so Premiere loads an unsigned panel.

<details>
<summary>Manual install</summary>

Copy this folder to:

- Windows: `%APPDATA%\Adobe\CEP\extensions\HTMLtoVideo`
- macOS: `~/Library/Application Support/Adobe/CEP/extensions/HTMLtoVideo`

Then allow unsigned extensions:

- Windows (for each `N` of 10–14): `reg add HKCU\Software\Adobe\CSXS.N /v PlayerDebugMode /t REG_SZ /d 1 /f`
- macOS (for each `N` of 10–14): `defaults write com.adobe.CSXS.N PlayerDebugMode 1`
</details>

To uninstall, run `scripts/uninstall-win.bat` or `scripts/uninstall-mac.sh`.

## Using it

1. Open (or create) a Premiere Pro project.
2. In the panel click **Upload your file** and choose your HTML file.
3. Click **Convert video**. A progress bar shows each frame as it renders.
4. When it finishes, the new sequence opens. Then:
   - **Remove an icon**: select its clip and press Delete (or hide its track's eye).
   - **Re-time an element**: drag its clip left/right.
   - **Restyle it**: add effects, Motion, Opacity, color… to that clip only.

All imported layers are kept in a project bin called `<file> (HTML to Video)`.
The PNG frames are saved in `Documents/HTML to Video/<file>_<date>/`.

### Settings

| Setting | Default | Notes |
|---|---|---|
| Resolution | 1920 × 1080 | Presets for HD, 4K, vertical 9:16, square, or custom |
| Frame rate | 30 | 24, 25, 30, 50, 60 |
| Duration | `auto` | `auto` plays the page until its animations stop (max 60 s; looping pages get 10 s). Or type seconds, e.g. `8` |
| Layers | Every object & icon | **Top-level sections** gives fewer, bigger tracks; **Single flat video** gives one track |
| Max object tracks | 60 | Objects beyond this stay in the background track |
| Browser | auto-detect | Path to `chrome.exe` / `msedge.exe` / Chrome app if not found automatically |
| Output folder | Documents/HTML to Video | Where PNG frames are written |

**Tip for HTML authors:** you can set the video length inside the page:
`<meta name="h2v-duration" content="6">` or `window.H2V_DURATION = 6`.

## How it works

```
index.html + js/main.js      Panel UI (CEP, runs inside Premiere)
js/core/chrome.js            Finds and starts headless Chrome / Edge
js/core/cdp.js               Tiny Chrome DevTools Protocol client (no dependencies)
js/core/inject.js            Runs inside the page: virtual clock + object detection/isolation
js/core/renderer.js          Frame loop: background + one transparent PNG per visible object
jsx/host.jsx                 ExtendScript: import PNG sequences, build sequence and tracks
CSXS/manifest.xml            Extension manifest
tools/render-cli.js          Same renderer from the command line (for testing)
examples/demo.html           Demo page
```

- **Virtual clock**: `inject.js` replaces `Date`, `performance.now`, timers and
  `requestAnimationFrame`, and pauses every CSS/Web animation and video, then
  seeks them all to the exact time of each frame. The output is the same as
  real-time playback, just with no dropped frames.
- **Objects**: a DOM element counts as an object when it is an image, SVG,
  icon, video, canvas, form control, a custom element, an element with its
  own text, or an empty element that paints something (a shape or card).
  Containers stay in the background.
- **Isolation**: for each frame, the renderer captures the page with every
  object hidden (background), then each visible object alone on a transparent
  background, using `visibility` only. Layout, transforms, parent opacity and
  clipping are untouched, so every layer lines up exactly.

## Command line (optional)

You can render without Premiere (Node.js 22+):

```bash
node tools/render-cli.js examples/demo.html out/demo --fps 30 --width 1920 --height 1080
# options: --duration 5  --mode objects|sections|flat  --max-layers 60  --chrome "<path>"
```

## Troubleshooting

- **Panel doesn't appear under Window → Extensions**: re-run the installer and
  restart Premiere. Check that the folder sits directly in `CEP/extensions/`.
- **"No Chrome/Edge found"**: install Google Chrome or enter the browser path in
  Settings.
- **Debugging**: with the panel open, visit `http://localhost:8098` in Chrome
  to open DevTools for the panel.
- **Too many tracks**: use **Top-level sections** or lower **Max object tracks**.

## License

MIT
