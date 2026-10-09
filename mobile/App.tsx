/*
 * HTML to Video – mobile app.
 * Choose an HTML file (or a .zip with its assets), render it to a video
 * frame by frame exactly as it plays in a browser, watch it in the player
 * and save it with the download button.
 */
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import {
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { type Job, outputFile, prepareJob, removeJob } from './src/render/job';
import { type Progress, type RenderHost, type RenderResult, renderVideo } from './src/render/renderJob';
import { RenderStage, type StageHandle } from './src/render/RenderStage';
import { Player } from './src/ui/Player';
import { colors } from './src/ui/theme';

// Auto: the page's own stage size, video up to 1280 px (light on memory)
const SIZES = [
  { label: 'Auto', value: 'auto', max: 1280 },
  { label: '720p', value: '1280x720', max: 1280 },
  { label: '1080p', value: '1920x1080', max: 1920 },
  { label: '9:16', value: '720x1280', max: 1280 },
  { label: '1:1', value: '1080x1080', max: 1080 }
];
const FPS = [24, 30, 60];

type Picked = { uri: string; name: string };
type Video = RenderResult & { uri: string; title: string };

function Chip({ label, selected, onPress, disabled }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, selected && styles.chipSel, disabled && { opacity: 0.5 }]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSel]}>{label}</Text>
    </Pressable>
  );
}

function Main() {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [size, setSize] = useState('auto');
  const [fps, setFps] = useState(30);
  const [duration, setDuration] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [video, setVideo] = useState<Video | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'err' | 'info' } | null>(null);
  const stage = useRef<StageHandle>(null);
  const cancel = useRef(false);
  const busy = !!job;

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // player box: full width, shaped like the video (16:9 until there is one)
  const boxW = screenW - 32;
  const aspect = video ? video.width / video.height : 16 / 9;
  const boxH = Math.min(boxW / aspect, screenH * 0.5);

  async function pick() {
    const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (r.canceled || !r.assets.length) return;
    const a = r.assets[0];
    if (!/\.(html?|zip)$/i.test(a.name)) {
      setNotice({ text: 'Choose an .html file, or a .zip with the HTML and its assets.', kind: 'err' });
      return;
    }
    setPicked({ uri: a.uri, name: a.name });
    setNotice(null);
  }

  async function waitForStage() {
    for (let i = 0; i < 100 && !stage.current; i++) await new Promise((r) => setTimeout(r, 20));
    if (!stage.current) throw new Error('Could not start the renderer.');
    return stage.current;
  }

  async function render() {
    if (!picked || busy) return;
    cancel.current = false;
    setProgress({ stage: 'start', message: 'Preparing…', fraction: 0 });
    let current: Job | null = null;
    await activateKeepAwakeAsync('render').catch(() => undefined);
    try {
      current = await prepareJob(picked.uri, picked.name);
      setJob(current);
      const s = await waitForStage();
      const part = outputFile(current.title, 'part');
      const host: RenderHost = {
        loadPage: (w, h, ow, oh) => s.loadPage(w, h, ow, oh),
        preview: (picture) => s.preview(picture),
        evalPage: (e) => s.evalPage(e),
        capture: () => s.capture(),
        loadEncoder: () => s.loadEncoder(),
        evalEncoder: (e) => s.evalEncoder(e),
        async readFileBase64(url) {
          if (!url.startsWith('file:')) return null;
          try { return await new File(decodeURI(url)).base64(); } catch { return null; }
        },
        async appendOutput(b64, first) {
          if (first) part.create({ overwrite: true });
          part.write(b64, { encoding: 'base64', append: true });
        },
        progress: (p) => {
          if (p.stage === 'warn') setNotice({ text: p.message, kind: 'info' });
          setProgress((prev) => ({ ...p, fraction: p.fraction ?? prev?.fraction }));
        },
        cancelled: () => cancel.current
      };
      const [w, h] = size === 'auto' ? ['auto', 'auto'] as const : size.split('x').map(Number);
      const secs = parseFloat(duration);
      const maxOutput = SIZES.find((x) => x.value === size)?.max ?? 1280;
      const result = await renderVideo(host, {
        width: w, height: h, fps, duration: secs > 0 ? secs : 'auto', quality: 'high',
        captureType: 'image/jpeg', maxOutput
      });
      const final = outputFile(current.title, result.mime === 'video/webm' ? 'webm' : 'mp4');
      part.move(final);
      setVideo({ ...result, uri: final.uri, title: current.title });
      setNotice({ text: `Done: ${result.width}×${result.height}, ${result.duration.toFixed(1)} s`, kind: 'ok' });
    } catch (e: any) {
      const msg = String(e?.message || e);
      setNotice({ text: msg === 'Cancelled' ? 'Cancelled.' : msg, kind: msg === 'Cancelled' ? 'info' : 'err' });
    } finally {
      deactivateKeepAwake('render').catch(() => undefined);
      removeJob(current);
      setJob(null);
      setProgress(null);
    }
  }

  // Download: choose a folder (Android's own folder picker), the video is
  // saved there. Needs no photo/gallery permission.
  async function download() {
    if (!video || saving) return;
    setSaving(true);
    try {
      let dir: Directory;
      try {
        dir = await Directory.pickDirectoryAsync();
      } catch (e: any) {
        if (/cancel/i.test(String(e?.message || e) + String(e?.code || ''))) return;
        if (Platform.OS !== 'android') {
          await share(); // iOS: the share sheet has "Save Video" / "Save to Files"
          return;
        }
        throw e;
      }
      const src = new File(video.uri);
      const base = `${video.title}.${src.extension.replace(/^\./, '') || 'mp4'}`;
      const dest = dir.createFile(base, video.mime);
      dest.write(await src.bytes());
      setNotice({ text: `Saved: ${dest.name || base}`, kind: 'ok' });
    } catch (e: any) {
      setNotice({ text: 'Could not save: ' + String(e?.message || e), kind: 'err' });
    } finally {
      setSaving(false);
    }
  }

  async function share() {
    if (!video) return;
    if (!(await Sharing.isAvailableAsync())) {
      setNotice({ text: 'Sharing is not available on this device.', kind: 'err' });
      return;
    }
    await Sharing.shareAsync(video.uri, {
      mimeType: video.mime, dialogTitle: 'Save or share the video', UTI: 'public.mpeg-4'
    });
  }

  const pct = Math.round((progress?.fraction ?? 0) * 100);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.logo}><Ionicons name="code-slash" size={18} color="#fff" /></View>
          <View>
            <Text style={styles.title}>HTML to Video</Text>
            <Text style={styles.subtitle}>Plays exactly like in a browser · frame by frame</Text>
          </View>
        </View>

        {/* player */}
        <View style={[styles.playerBox, { width: boxW, height: boxH }]}>
          {job ? (
            <RenderStage
              ref={stage}
              job={job}
              boxWidth={boxW}
              boxHeight={boxH}
              onPageError={(m) => setNotice({ text: 'Page error: ' + m, kind: 'info' })}
            />
          ) : video ? (
            <Player
              key={video.uri}
              uri={video.uri}
              width={boxW}
              height={boxH}
              saving={saving}
              onDownload={download}
              onShare={share}
            />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="film-outline" size={44} color={colors.muted} />
              <Text style={styles.emptyText}>Choose an HTML file and tap Render video.{'\n'}Your video plays here.</Text>
            </View>
          )}
        </View>
        {video && !job && (
          <Text style={styles.videoInfo}>
            {video.width}×{video.height} · {video.fps} fps · {video.duration.toFixed(2)} s · {(video.size / 1048576).toFixed(1)} MB
          </Text>
        )}

        {/* progress */}
        {progress && (
          <View style={styles.progress}>
            <View style={styles.bar}><View style={[styles.fill, { width: `${pct}%` }]} /></View>
            <Text style={styles.progressText}>
              {progress.message}{progress.eta ? ` · about ${progress.eta} s left` : ''}
            </Text>
          </View>
        )}

        {/* file */}
        <Pressable style={[styles.card, picked && styles.cardReady]} onPress={pick} disabled={busy}>
          <View style={styles.fileIcon}><Text style={styles.fileIconText}>{picked && /\.zip$/i.test(picked.name) ? 'ZIP' : 'HTML'}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fileName} numberOfLines={1}>{picked ? picked.name : 'No file chosen'}</Text>
            <Text style={styles.fileHint} numberOfLines={2}>
              {picked ? 'Tap to choose another file' : 'An .html file, or a .zip with the HTML and its pictures, fonts, sounds'}
            </Text>
          </View>
          <Ionicons name="folder-open-outline" size={22} color={colors.text} />
        </Pressable>

        {/* settings */}
        <View style={styles.card2}>
          <Text style={styles.label}>Size</Text>
          <View style={styles.row}>
            {SIZES.map((s) => (
              <Chip key={s.value} label={s.label} selected={size === s.value} onPress={() => setSize(s.value)} disabled={busy} />
            ))}
          </View>
          <Text style={styles.label}>Frame rate</Text>
          <View style={styles.row}>
            {FPS.map((f) => (
              <Chip key={f} label={`${f} fps`} selected={fps === f} onPress={() => setFps(f)} disabled={busy} />
            ))}
          </View>
          <Text style={styles.label}>Length (seconds)</Text>
          <TextInput
            value={duration}
            onChangeText={setDuration}
            placeholder="Auto (measured from the page)"
            placeholderTextColor={colors.muted}
            keyboardType="decimal-pad"
            editable={!busy}
            style={styles.input}
          />
        </View>

        {busy ? (
          <Pressable style={[styles.button, styles.cancel]} onPress={() => { cancel.current = true; }}>
            <Text style={[styles.buttonText, { color: colors.danger }]}>Cancel</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.button, !picked && { opacity: 0.45 }]} onPress={render} disabled={!picked}>
            <Ionicons name="play" size={18} color="#fff" />
            <Text style={styles.buttonText}>Render video</Text>
          </Pressable>
        )}

        {notice && (
          <Text style={[styles.notice, notice.kind === 'err' && { color: colors.danger }, notice.kind === 'ok' && { color: colors.ok }]}>
            {notice.text}
          </Text>
        )}
        <Text style={styles.foot}>Keep the app open while it renders. Uses the phone's own video encoder.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  logo: { width: 34, height: 34, borderRadius: 9, backgroundColor: '#6d5cff', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 12 },
  playerBox: { borderRadius: 10, overflow: 'hidden', backgroundColor: '#000', alignSelf: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 10 },
  emptyText: { color: colors.muted, textAlign: 'center', lineHeight: 19 },
  videoInfo: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: -4 },
  progress: { gap: 6 },
  bar: { height: 6, backgroundColor: colors.panel2, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
  progressText: { color: colors.muted, fontSize: 12 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10,
    backgroundColor: colors.panel, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line
  },
  cardReady: { borderStyle: 'solid', borderColor: colors.accent },
  fileIcon: { width: 40, height: 48, borderRadius: 6, backgroundColor: '#e44d26', alignItems: 'center', justifyContent: 'center' },
  fileIconText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  fileName: { color: '#fff', fontWeight: '600', fontSize: 15 },
  fileHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
  card2: { padding: 12, borderRadius: 10, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, gap: 8 },
  label: { color: colors.muted, fontSize: 12, marginTop: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2 },
  chipSel: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  chipTextSel: { color: '#fff' },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9,
    color: colors.text, backgroundColor: colors.bg, fontSize: 14
  },
  button: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 14
  },
  cancel: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  notice: { color: colors.text, textAlign: 'center' },
  foot: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 4 }
});
