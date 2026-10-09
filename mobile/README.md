# HTML to Video – mobile app (React Native + Expo)

Choose an **HTML file** on your phone and get a **video** of it: it plays in the
built-in player exactly like it plays in a browser, and the **download button**
on top of the player saves it to a folder you choose.

```
┌──────────────────────────────┐
│ HTML to Video                │
│ ┌──────────────────────────┐ │
│ │                  (⇪) (⬇) │ │  ← share · download
│ │     your video plays     │ │
│ │ ▶ ──●────────── 0:01/0:03│ │
│ └──────────────────────────┘ │
│ [HTML] promo.html            │  ← tap to choose a file
│ Size  [Auto] 720p 1080p 9:16 │
│ Frame rate  24 [30] 60       │
│ Length  Auto                 │
│ [ ▶ Render video ]           │
└──────────────────────────────┘
```

## Using it

1. **Choose a file**: an `.html` file, or a **`.zip`** containing the HTML plus its
   pictures, fonts, sounds and scripts (folders are kept; `index.html` is used
   if there are several HTML files).
2. Pick the size (*Auto* finds the page's own stage, e.g. 1920×1080, and makes a
   video up to 1280 px wide, which is light on the phone's memory; *1080p* for full HD), frame
   rate and length (*Auto* reads `const DURATION = …` from the page or measures
   the animation), then tap **Render video**. The page is shown while it renders.
3. The video plays in the player. Under it, **Save to:** shows the folder the
   video goes to (choose it once with the phone's folder picker, e.g. *Movies* or
   *Download*; tap the row to change it). Tap **⬇** and the video is copied there
   at once, checked to be complete, and shows up in the Gallery too.
   **⇪** shares it (or saves it to Files on iPhone). The app needs no photo or
   storage permission.

To **edit** the animation object by object, use the Premiere Pro / After
Effects plugin in this repository with the same HTML file.

## Long animations

The whole animation is rendered, however long it is: the length comes from
`const DURATION = …` (or `DURATION_MS`, `TOTAL`, `<meta name="h2v-duration">`), else
it is measured, including GSAP timelines and pauses where nothing moves (up to 5
minutes are measured; for longer animations type the length). Frames are written
into the video file while rendering, so a long video does not fill the phone's
memory.

## How it renders

The same engine as the desktop app and the Adobe plugin (`../js`, copied in by
`npm run sync-runtime`):

- the page runs in a WebView on a **virtual clock** (CSS animations and
  transitions, Web Animations, `requestAnimationFrame`, GSAP, timers, SVG
  `<animate>`, `<video>`), so every frame is exact even on a slow phone;
- each frame is captured (`react-native-view-shot`) at the video's real pixel
  size and encoded with the phone's own **H.264 encoder** (WebCodecs in a second,
  hidden WebView) into an **MP4** with `mp4-muxer`. Sounds from
  `<audio data-start="…">` are mixed in (AAC/Opus where the phone supports it);
- phones whose WebView has no WebCodecs fall back to MediaRecorder (MP4 on
  iOS, WebM on older Android), without sound.

Rendering happens on the phone and needs no internet, except for libraries or
fonts the HTML loads from the web (put them in the `.zip` to be safe).

## Install / run

**Android APK**: download `HTMLtoVideo-Android.apk` from the repository's
**Releases** (or *Actions → Build Android app → Artifacts*), open it on the
phone and allow installing from this source.

**Development** (Node 22+):

```bash
cd mobile
npm install
npx expo start          # scan the QR code with Expo Go (Android / iOS)
```

Every native module the app uses is included in Expo Go. For a standalone app,
build with EAS (`npx eas-cli@latest build -p android` / `-p ios`) or locally
(`npx expo run:android`, `npx expo run:ios`).

## Project layout

```
App.tsx                     screen: file, settings, render button, player
src/render/RenderStage.tsx  page WebView (captured) + hidden encoder WebView
src/render/renderJob.ts     render steps (platform independent)
src/render/job.ts           copies / unzips the picked file, writes the runtime
src/runtime/html.ts         viewport + runtime injection, encoder page, RPC bridge
src/runtime/generated.ts    engine from ../js (npm run sync-runtime)
src/ui/Player.tsx           expo-video player with download / share buttons
test/render-in-chrome.js    runs the same render steps in headless Chrome
                            with phone emulation (npm run test:render page.html out.mp4)
```

Checks: `npx tsc --noEmit`, `npx expo lint`.
