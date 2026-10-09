# HTML to Video

> বাংলা নির্দেশিকা: [README.bn.md](README.bn.md)

Turn any **HTML animation into video, frame by frame**, exactly as it plays in a
web browser. **Works fully offline.** Two ways to use it:

| | For whom | What you get |
|---|---|---|
| **[HTMLtoVideo.exe](#desktop-app-htmltovideoexe)**: desktop app | You just want the video | Open an HTML file, **Render video**, watch it in the built-in player, click **⬇** to save the **MP4** to a folder, or **Edit in Premiere / After Effects** |
| **[Mobile app](mobile/README.md)** (Android / iOS, React Native + Expo) | You're on your phone | Choose an HTML (or .zip), **Render video**, watch it in the player, tap **⬇** to save it to the Gallery |
| **[Premiere Pro / After Effects plugin](#premiere-pro--after-effects-plugin)** | You want to edit it | **Every object and icon on its own track/layer**, movement as real **Position / Scale / Rotation / Opacity keyframes** |

All of them use the same rendering engine. On a computer they need only Google
Chrome or Microsoft Edge (Edge comes with Windows 10/11); the mobile app uses the
phone's own browser engine and video encoder.

## Desktop app (HTMLtoVideo.exe)

```
┌ HTML to Video ────────────────────────────────────────────────────────┐
│ [HTML] promo.html      │  Rendered video | Live HTML      1920×1080 · 30 fps │
│ [ Open HTML file    ]  │ ┌───────────────────────────────────────────┐ │
│ Resolution  Auto       │ │                                       (⬇) │ │
│ Frame rate  30         │ │            your video plays here          │ │
│ Length      auto       │ │                                           │ │
│ Quality     High       │ │ ▶ ───────●──────────────────── 0:01/0:03  │ │
│ [ ▶ Render video    ]  │ └───────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

1. **Download** `HTMLtoVideo.exe` from the repository's **Releases** page (or from
   the latest *Build Windows app* run under **Actions → Artifacts**). It is a single
   file: no installation, no ffmpeg, nothing else to download.
2. Double-click it. The app opens in its own window. (Windows SmartScreen may
   warn about an unknown app: click *More info → Run anyway*.)
3. **Open HTML file** (or paste a path, or drop an `.html` file onto the `.exe`).
4. Pick resolution (*Auto* uses the page's own stage size), frame rate, length and
   quality, then click **Render video**.
5. The video plays in the player: frame-exact, just like in the browser. The
   **Live HTML** tab shows the original page for comparison.
6. Click the **⬇ download button** on the player: the MP4 is saved at once to the
   folder shown under the player (**Save to:** `Videos\HTML to Video` at first).
   **Change…** picks another folder; the app remembers it.
7. **Edit in Premiere / After Effects** (top right): choose **Premiere Pro** or
   **After Effects**. The first time, the plugin is installed for you. The app
   converts the HTML into separate layers (every object with its own keyframes),
   then opens the program (or switches to it) and builds a new sequence /
   composition there by itself. If the program was already open when the
   plugin was installed, close it and open it again once.

Resolutions come in landscape, vertical (phone / Reels / Shorts) and square
versions: 1920×1080 ↔ 1080×1920, 1280×720 ↔ 720×1280, 2560×1440 ↔ 1440×2560,
3840×2160 ↔ 2160×3840, 1350×1080 ↔ 1080×1350, 1080×1080 and 2160×2160.
The length is measured from the page (scenes driven by timers, `setInterval`,
`requestAnimationFrame` loops, CSS, GSAP); the log shows the length found.
Type a number of seconds in **Length** to choose it yourself.

The video is encoded by the browser's own encoder: **H.264 + AAC MP4** with Chrome
or Edge (plays everywhere, imports into any editor). `<audio>` in the page is
mixed into the soundtrack. To **edit** the animation (each object separately), use
the plugin below with the same HTML file.

Build it yourself: `npm install`, then `npm run build:exe` (Windows .exe, from
any OS) or `npm run build:app` (current OS). Run from source: `npm run app`.

## Premiere Pro / After Effects plugin

The same panel works in **Premiere Pro** (sequence + tracks) and **After Effects**
(composition + layers).

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
3. A new sequence opens in Premiere Pro (or, with **Build into: Active
   sequence**, new tracks are added to your open sequence at the playhead):
   - **V1 – Background**: the page without its objects.
   - **V2, V3, …**: one **transparent** track per object (heading, paragraph,
     image, icon, SVG, button, shape…), stacked in the same order the browser
     paints them.
   - Each clip **starts at the frame where its object first appears**, so the
     timeline shows elements arriving one by one.
   - **Editable keyframes**: an object that only moves / scales / rotates /
     fades is **one sharp picture** with **Position, Scale, Rotation and
     Opacity keyframes** in Effect Controls. Change the motion right in
     Premiere: move a keyframe, change the easing, add a bounce.
   - Objects whose look changes (typing text, colour changes, canvas, video)
     come in as transparent picture sequences instead.
   - `<audio>` files go on **audio tracks** at their start time.
4. **In After Effects** you get the same as a **composition**: the background
   layer at the bottom, one layer per object above it (each starting when its
   object appears), Position / Scale / Rotation / Opacity keyframes (linear), and
   audio layers. **Build into: Active composition** adds the layers to the open
   comp at the current time.

Nothing is cut or removed: stacking all the tracks gives back the original page
pixel for pixel. Anything that isn't its own object stays in the background track.

### What gets captured exactly

| Page uses | Supported |
|---|---|
| CSS `@keyframes` animations, CSS transitions | ✅ |
| Web Animations API (`element.animate`) | ✅ |
| JavaScript animation (`requestAnimationFrame`, GSAP, anime.js, Lottie…) | ✅ |
| `setTimeout` / `setInterval`, `Date`, `performance.now()` | ✅ (virtual time) |
| SVG `<animate>` / `<animateTransform>` (SMIL) | ✅ |
| `Math.random()` | ✅ (fixed seed, same result every time) |
| `<video>` elements | ✅ (seeked frame by frame) |
| `<canvas>` / WebGL | ✅ (as one object) |
| Web fonts, icon fonts (Font Awesome, Material Icons, Bootstrap Icons…), inline SVG | ✅ |
| `<audio src="…" data-start="1.5">` | ✅ audio track clip at 1.5 s |
| Sound made only in JavaScript (Web Audio, `new Audio()`) | ❌ use an `<audio>` tag |

### Works offline

No internet is needed. Every http(s) file the page asks for (a library from a
CDN, a Google Font, a picture) is looked up first in the panel's **cache**, then
as a **file with the same name next to your HTML** (or in `assets/`, `libs/`,
`js/`, `css/`, `fonts/`). Only then does it try the internet. Anything
downloaded once is cached, so the next conversion works offline. Files that
could not be loaded are listed in the panel's log in orange.

## Requirements

- Adobe Premiere Pro **2020 (14.0) or newer** or After Effects **2020 (17.0) or
  newer**, Windows or macOS
- **Google Chrome, Microsoft Edge, Brave or Chromium** installed. Edge ships
  with Windows 10/11, so Windows users usually need nothing extra. The plugin
  uses your installed browser instead of bundling one, which keeps it small:
  **no npm install, no dependencies**.

## Install

1. Download this repository (green **Code → Download ZIP**) and unzip it.
2. Run the installer:
   - **Windows**: double-click `scripts\install-win.bat`
   - **macOS**: open Terminal and run `bash scripts/install-mac.sh`
3. Restart Premiere Pro / After Effects.
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
| Resolution | Auto | **Auto** finds the page's own fixed-size stage (e.g. a 1920×1080 `<div>` scaled to fit the window) and uses its real size. Presets for HD, 2K, 4K, each also vertical (9:16 / 4:5), square, or custom |
| Frame rate | 30 | 24, 25, 30, 50, 60 |
| Duration | `auto` | `auto` reads `const DURATION = 8` (or `DURATION_MS`, `TOTAL`, `TOTAL_MS`) from the page, else plays it until nothing changes (+1 s; a loop: one cycle; max 60 s). Or type seconds, e.g. `8` |
| Editable keyframes | on | Objects that only move / scale / rotate / fade become one picture + keyframes. Off = every object is a picture sequence |
| Layers | Every object & icon | **Top-level sections** gives fewer, bigger tracks; **Single flat video** gives one track |
| Max object tracks | 60 | Objects beyond this stay in the background track |
| Browser | auto-detect | Path to `chrome.exe` / `msedge.exe` / Chrome app if not found automatically |
| Output folder | Documents/HTML to Video | Where PNG frames are written |

## Making HTML for this panel (with Claude)

`skill/html-to-video.zip` is a Claude skill that teaches Claude how to write HTML
animations that convert cleanly (fixed stage, `DURATION`, transform/opacity
motion for keyframes, local assets for offline use, `<audio data-start>`).
Upload it in Claude (Settings → Capabilities → Skills), then ask e.g.
*"Make a 10-second logo reveal for Premiere"*. The details of what converts and
how are in `skill/html-to-video/references/convert.md`.

## How it works

```
index.html + js/main.js      Panel UI (CEP, runs inside Premiere Pro and After Effects)
js/core/chrome.js            Finds and starts headless Chrome / Edge
js/core/cdp.js               Tiny Chrome DevTools Protocol client (no dependencies)
js/core/inject.js            Runs inside the page: virtual clock, objects, stage, analysis
js/core/renderer.js          Analysis pass + capture pass: background, objects, stills, keyframes
js/core/motion.js            On-screen box per frame -> Position/Scale/Rotation/Opacity keyframes
js/core/netcache.js          Offline cache / local files for http(s) requests
js/core/png.js               Tiny PNG reader (crops the still pictures)
js/core/encoder.js           MP4 output: frames -> WebCodecs (H.264/AAC) in Chrome -> mp4-muxer
js/core/encoder-page.js      … the part that runs in the browser (js/vendor/mp4-muxer.js, MIT)
jsx/host.jsx                 ExtendScript: Premiere (h2v_build) and After Effects (h2vAE_build)
app/                         Desktop app: local server + UI in a Chrome/Edge app window
tools/build-exe.js           Packs the app into one HTMLtoVideo.exe (Node.js single executable)
tools/smoke-app.js           End-to-end test of the app / .exe (renders an MP4)
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
- **Keyframes**: a first, fast pass plays the page without taking pictures
  and records each object's on-screen corners and opacity on every frame,
  plus a fingerprint of how it looks. When only the position, scale, rotation
  or opacity changes, the object is captured once at rest and its motion is
  converted to Premiere keyframes, keeping only the keyframes needed to
  reproduce it (within ¼ pixel).

## Command line (optional)

You can render without Premiere (Node.js 22+):

```bash
node tools/render-cli.js examples/demo.html out/demo --fps 30 --width 1920 --height 1080
node tools/render-cli.js examples/demo.html --video out/demo.mp4 --quality high   # plain MP4
# options: --width auto  --duration 5  --mode objects|sections|flat  --max-layers 60
#          --keyframes off  --chrome "<path>"  --debug 1 (says why an object is not keyframed)
```

## Troubleshooting

- **Panel doesn't appear under Window → Extensions**: re-run the installer and
  restart Premiere. Check that the folder sits directly in `CEP/extensions/`.
- **"No Chrome/Edge found"**: install Google Chrome or enter the browser path in
  Settings.
- **Debugging**: with the panel open, visit `http://localhost:8098` in Chrome
  to open DevTools for the panel.
- **Too many tracks**: use **Top-level sections** or lower **Max object tracks**.
- **Keyframed pictures look too big or small**: in Premiere, *Preferences → Media
  → Default Media Scaling* must be **None** (not *Scale to frame size*).
- **A font or library is missing offline**: put the file next to the HTML (or in
  `assets/`) with the same file name as in its URL, or convert once with
  internet so it is cached.

## License

MIT
