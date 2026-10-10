import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router/tabs';
import { Platform, StyleSheet } from 'react-native';
import { useTheme } from '../../ui/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'হোম', icon: 'home' },
  { name: 'transactions', title: 'লেনদেন', icon: 'swap-vertical' },
  { name: 'parties', title: 'খাতা', icon: 'people' },
  { name: 'report', title: 'রিপোর্ট', icon: 'stats-chart' },
  { name: 'calculator', title: 'ক্যালকুলেটর', icon: 'calculator' },
];

export default function TabsLayout() {
  const t = useTheme();
  const ios = Platform.OS === 'ios';
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.tint,
        tabBarInactiveTintColor: t.dark ? '#8E8E93' : '#999999',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarStyle: {
          position: 'absolute',
          borderTopColor: t.sep,
          borderTopWidth: StyleSheet.hairlineWidth,
          backgroundColor: ios ? 'transparent' : t.tabBar,
          elevation: 0,
        },
        tabBarBackground: ios
          ? () => <BlurView tint={t.dark ? 'dark' : 'light'} intensity={90} style={StyleSheet.absoluteFill} />
          : undefined,
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons
                name={(focused ? tab.icon : `${tab.icon}-outline`) as IconName}
                size={size - 1}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
