import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider, useStore } from '../data/store';
import { useTheme } from '../ui/theme';

function Root() {
  const t = useTheme();
  const { session } = useStore();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.bg).catch(() => {});
  }, [t.bg]);
  return (
    <>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.bg },
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.tint,
          headerTitleStyle: { color: t.text },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Protected guard={!session}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="party/[id]" />
          <Stack.Screen name="txn/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="txn/new" options={{ presentation: 'modal' }} />
          <Stack.Screen name="party/edit" options={{ presentation: 'modal' }} />
          <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <Root />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
