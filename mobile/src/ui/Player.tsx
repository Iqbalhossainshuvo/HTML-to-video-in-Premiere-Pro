/*
 * Video player with a download button (and share button) on top of it.
 */
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { colors } from './theme';

interface Props {
  uri: string;
  width: number;
  height: number;
  saving: boolean;
  onDownload: () => void;
  onShare: () => void;
}

export function Player({ uri, width, height, saving, onDownload, onShare }: Props) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });

  return (
    <View style={{ width, height, backgroundColor: '#000' }}>
      <VideoView
        player={player}
        style={{ width, height }}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
      />
      <View style={styles.actions} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share video"
          onPress={onShare}
          style={({ pressed }) => [styles.round, pressed && styles.pressed]}
          hitSlop={8}
        >
          <Ionicons name="share-social-outline" size={20} color="#fff" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Download video"
          onPress={onDownload}
          disabled={saving}
          style={({ pressed }) => [styles.round, styles.download, pressed && styles.pressed]}
          hitSlop={8}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="download-outline" size={24} color="#fff" />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', gap: 10 },
  round: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(20,20,24,0.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)'
  },
  download: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { opacity: 0.7, transform: [{ scale: 0.95 }] }
});
