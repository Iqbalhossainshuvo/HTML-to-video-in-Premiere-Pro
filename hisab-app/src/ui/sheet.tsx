/* Header bar for modal screens: Cancel · Title · Save */
import { router } from 'expo-router';
import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from './kit';
import { useTheme } from './theme';

export function Sheet({
  title,
  onSave,
  saveLabel = 'সেভ',
  canSave = true,
  children,
}: {
  title: string;
  onSave?: () => void;
  saveLabel?: string;
  canSave?: boolean;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const top = Platform.OS === 'ios' ? 10 : insets.top + 6;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: top, paddingHorizontal: 16, paddingBottom: 10 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ minWidth: 70 }}>
          <T color={t.tint}>{onSave ? 'বাতিল' : 'বন্ধ'}</T>
        </Pressable>
        <T size={17} weight="600" center numberOfLines={1} style={{ flex: 1 }}>
          {title}
        </T>
        <Pressable onPress={onSave} disabled={!onSave || !canSave} hitSlop={10} style={{ minWidth: 70, alignItems: 'flex-end' }}>
          {onSave ? (
            <T color={t.tint} weight="700" style={{ opacity: canSave ? 1 : 0.35 }}>
              {saveLabel}
            </T>
          ) : null}
        </Pressable>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
