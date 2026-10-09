/*
 * The two WebViews used while rendering:
 *  - the page, laid out at the video's real size (w × h pixels) and shown
 *    scaled down inside the player box, so it can be captured frame by frame
 *  - a tiny hidden encoder page that builds the MP4
 * Exposes them to renderJob through a ref.
 */
import React, { useImperativeHandle, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { captureRef } from 'react-native-view-shot';
import { ENCODER_HTML, rpcScript } from '../runtime/html';
import { type Job, writeMain } from './job';

export interface StageHandle {
  loadPage(w: number, h: number): Promise<void>;
  evalPage<T = unknown>(expr: string): Promise<T>;
  capture(): Promise<string>;
  loadEncoder(): Promise<void>;
  evalEncoder<T = unknown>(expr: string): Promise<T>;
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

export function RenderStage({ job, boxWidth, boxHeight, onPageError, ref }: Props) {
  const pr = PixelRatio.get();
  const [page, setPage] = useState<{ w: number; h: number; key: number } | null>(null);
  const [encKey, setEncKey] = useState(0);
  const pageRef = useRef<WebView>(null);
  const encRef = useRef<WebView>(null);
  const shotRef = useRef<View>(null);
  const ready = useRef<Record<Channel, (() => void) | null>>({ page: null, enc: null });
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);

  function waitReady(channel: Channel, what: string, start: () => void) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ready.current[channel] = null;
        reject(new Error(what + ' did not load in time.'));
      }, 60000);
      ready.current[channel] = () => {
        clearTimeout(timer);
        resolve();
      };
      start();
    });
  }

  function rpc<T>(channel: Channel, expr: string): Promise<T> {
    const view = channel === 'page' ? pageRef.current : encRef.current;
    if (!view) return Promise.reject(new Error('The ' + channel + ' view is not ready.'));
    const id = nextId.current++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.current.delete(id);
        reject(new Error('No answer from the ' + (channel === 'page' ? 'page' : 'encoder') + '.'));
      }, TIMEOUT);
      pending.current.set(id, { resolve, reject, timer });
      view.injectJavaScript(rpcScript(id, expr));
    });
  }

  function handleMessage(channel: Channel, e: WebViewMessageEvent) {
    let msg: any;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'ready') {
      const done = ready.current[channel];
      ready.current[channel] = null;
      if (done) done();
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

  useImperativeHandle(ref, () => ({
    loadPage: (w, h) => waitReady('page', 'The page', () => {
      writeMain(job, w, h, 1 / pr);
      setPage((p) => ({ w, h, key: (p?.key ?? 0) + 1 }));
    }),
    evalPage: (expr) => rpc('page', expr),
    capture: () => captureRef(shotRef, { format: 'jpg', quality: 0.92, result: 'base64' }),
    loadEncoder: () => waitReady('enc', 'The video encoder', () => setEncKey((k) => k + 1)),
    evalEncoder: (expr) => rpc('enc', expr)
  }), [job, pr]);

  // the page at its real pixel size, scaled to fit the box
  const vw = page ? page.w / pr : 1;
  const vh = page ? page.h / pr : 1;
  const scale = Math.min(boxWidth / vw, boxHeight / vh);

  return (
    <View style={[styles.box, { width: boxWidth, height: boxHeight }]}>
      {page && (
        <View
          style={{
            position: 'absolute',
            left: (boxWidth - vw * scale) / 2,
            top: (boxHeight - vh * scale) / 2,
            width: vw,
            height: vh,
            transform: [{ scale }],
            transformOrigin: 'top left'
          }}
        >
          <View ref={shotRef} collapsable={false} style={styles.fill}>
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
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              webviewDebuggingEnabled={__DEV__}
              onMessage={onPageMessage}
              style={styles.page}
            />
          </View>
        </View>
      )}
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
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: '#000' },
  fill: { flex: 1 },
  page: { flex: 1, backgroundColor: '#fff' },
  encoder: { position: 'absolute', left: 0, top: 0, width: 2, height: 2, opacity: 0.01 }
});
