/*
 * The two WebViews used while rendering:
 *  - the page, laid out at its real size (no transforms: Android WebView
 *    draws wrongly inside scaled parents) so it can be captured frame by
 *    frame; the player box shows the last captured frame on top of it
 *  - a tiny hidden encoder page that builds the MP4
 * Exposes them to renderJob through a ref. If a WebView's process dies
 * (out of memory), the render stops with a message instead of the app closing.
 */
import React, { useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Image, PixelRatio, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { captureRef } from 'react-native-view-shot';
import { ENCODER_HTML, rpcScript, webviewSize } from '../runtime/html';
import { type Job, writeMain } from './job';

export interface StageHandle {
  loadPage(w: number, h: number, outW: number, outH: number): Promise<void>;
  evalPage<T = unknown>(expr: string, timeoutMs?: number): Promise<T>;
  capture(): Promise<string>;
  loadEncoder(): Promise<void>;
  evalEncoder<T = unknown>(expr: string): Promise<T>;
  preview(picture: string): void;
}

type Channel = 'page' | 'enc';
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

interface Props {
  job: Job;
  boxWidth: number;
  boxHeight: number;
  onPageError?: (message: string) => void;
  ref?: React.Ref<StageHandle>;
}

const TIMEOUT = 120000;
const CRASHED = 'The phone ran out of memory for this page. Try a smaller size (720p) or a shorter length.';

export function RenderStage({ job, boxWidth, boxHeight, onPageError, ref }: Props) {
  const pr = PixelRatio.get();
  const [page, setPage] = useState<{ dpW: number; dpH: number; key: number } | null>(null);
  const [encKey, setEncKey] = useState(0);
  const [frame, setFrame] = useState<string | null>(null);
  const pageRef = useRef<WebView>(null);
  const encRef = useRef<WebView>(null);
  const shotRef = useRef<View>(null);
  const ready = useRef<Record<Channel, { resolve: () => void; reject: (e: Error) => void } | null>>({ page: null, enc: null });
  const pending = useRef(new Map<number, Pending & { channel: Channel }>());
  const nextId = useRef(1);

  function waitReady(channel: Channel, what: string, start: () => void) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ready.current[channel] = null;
        reject(new Error(what + ' did not load in time.'));
      }, 180000); // big pages (many pictures, fonts) can take a while
      ready.current[channel] = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      };
      start();
    });
  }

  function rpc<T>(channel: Channel, expr: string, timeoutMs = TIMEOUT): Promise<T> {
    const view = channel === 'page' ? pageRef.current : encRef.current;
    if (!view) return Promise.reject(new Error('The ' + channel + ' view is not ready.'));
    const id = nextId.current++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.current.delete(id);
        reject(new Error('No answer from the ' + (channel === 'page' ? 'page' : 'encoder') + '.'));
      }, timeoutMs);
      pending.current.set(id, { resolve, reject, timer, channel });
      view.injectJavaScript(rpcScript(id, expr));
    });
  }

  // a WebView process died: fail everything waiting on it
  function crashed(channel: Channel) {
    const err = new Error(CRASHED);
    const r = ready.current[channel];
    ready.current[channel] = null;
    r?.reject(err);
    for (const [id, p] of pending.current) {
      if (p.channel !== channel) continue;
      pending.current.delete(id);
      clearTimeout(p.timer);
      p.reject(err);
    }
    if (channel === 'page') setPage(null);
    else setEncKey(0);
  }

  function handleMessage(channel: Channel, e: WebViewMessageEvent) {
    let msg: any;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'ready') {
      const r = ready.current[channel];
      ready.current[channel] = null;
      r?.resolve();
    } else if (msg.type === 'pageError') {
      onPageError?.(msg.message);
    } else if (typeof msg.id === 'number') {
      const p = pending.current.get(msg.id);
      if (!p) return;
      pending.current.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.v);
      else p.reject(new Error(msg.e));
    }
  }
  const onPageMessage = (e: WebViewMessageEvent) => handleMessage('page', e);
  const onEncoderMessage = (e: WebViewMessageEvent) => handleMessage('enc', e);
  const onPageGone = () => crashed('page');
  const onEncoderGone = () => crashed('enc');

  useImperativeHandle(ref, () => ({
    loadPage: (w, h, outW) => waitReady('page', 'The page', () => {
      const size = webviewSize(w, h, outW, pr);
      writeMain(job, w, h, size.scale);
      setPage((p) => ({ dpW: size.dpW, dpH: size.dpH, key: (p?.key ?? 0) + 1 }));
    }),
    evalPage: (expr, timeoutMs) => rpc('page', expr, timeoutMs),
    capture: () => captureRef(shotRef, { format: 'jpg', quality: 0.9, result: 'base64' }),
    loadEncoder: () => waitReady('enc', 'The video encoder', () => setEncKey((k) => k + 1)),
    evalEncoder: (expr) => rpc('enc', expr),
    preview: (picture) => setFrame(picture)
  }), [job, pr]);

  return (
    <View style={[styles.box, { width: boxWidth, height: boxHeight }]}>
      {page && (
        // real size, top-left; covered by the preview picture below
        <View ref={shotRef} collapsable={false} style={{ position: 'absolute', left: 0, top: 0, width: page.dpW, height: page.dpH }}>
          <WebView
            key={page.key}
            ref={pageRef}
            source={{ uri: job.main.uri }}
            originWhitelist={['*']}
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            allowingReadAccessToURL={job.dir.uri}
            javaScriptEnabled
            domStorageEnabled
            cacheEnabled={false}
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            scrollEnabled={false}
            scalesPageToFit
            setBuiltInZoomControls={false}
            setSupportMultipleWindows={false}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            webviewDebuggingEnabled={__DEV__}
            onMessage={onPageMessage}
            onRenderProcessGone={onPageGone}
            onContentProcessDidTerminate={onPageGone}
            onShouldStartLoadWithRequest={(req) => req.url.startsWith('file:') || req.url === 'about:blank'}
            style={styles.page}
          />
        </View>
      )}
      <View style={styles.cover}>
        {frame ? (
          <Image
            source={{ uri: 'data:image/jpeg;base64,' + frame }}
            style={{ width: boxWidth, height: boxHeight }}
            resizeMode="contain"
            fadeDuration={0}
          />
        ) : (
          <View style={styles.wait}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.waitText}>Preparing the page…</Text>
          </View>
        )}
      </View>
      {encKey > 0 && (
        <View pointerEvents="none" style={styles.encoder}>
          <WebView
            key={'enc' + encKey}
            ref={encRef}
            source={{ html: ENCODER_HTML, baseUrl: 'https://h2v.local/' }}
            originWhitelist={['*']}
            javaScriptEnabled
            webviewDebuggingEnabled={__DEV__}
            onMessage={onEncoderMessage}
            onRenderProcessGone={onEncoderGone}
            onContentProcessDidTerminate={onEncoderGone}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: '#000' },
  page: { flex: 1, backgroundColor: '#fff' },
  cover: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  wait: { alignItems: 'center', gap: 8 },
  waitText: { color: '#bbb', fontSize: 12 },
  encoder: { position: 'absolute', left: 0, top: 0, width: 2, height: 2, opacity: 0.01 }
});
