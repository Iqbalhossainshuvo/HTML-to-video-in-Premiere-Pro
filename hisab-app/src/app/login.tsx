import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../data/store';
import { T, tap } from '../ui/kit';
import { useTheme } from '../ui/theme';

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }[] = [
  { icon: 'cloud-done', title: 'Google-এ নিরাপদ', text: 'সব হিসাব আপনার নিজের Google Drive-এ জমা থাকে' },
  { icon: 'phone-portrait', title: 'ফোন হারালেও চিন্তা নেই', text: 'নতুন ফোনে Google দিয়ে ঢুকলেই সব ফিরে আসবে' },
  { icon: 'checkmark-done-circle', title: 'পয়সা পর্যন্ত সঠিক', text: 'যোগ-বিয়োগ-গুণ-ভাগ, রেট, বাকি — সব নির্ভুল' },
];

export default function Login() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { signInWithGoogle, continueAsGuest } = useStore();
  const [busy, setBusy] = useState(false);

  const google = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      Alert.alert('লগইন হয়নি', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const guest = () =>
    Alert.alert(
      'Google ছাড়া চালু করবেন?',
      'তথ্য শুধু এই ফোনে থাকবে। ফোন হারালে ফেরত পাবেন না। পরে প্রোফাইল থেকে Google যুক্ত করতে পারবেন।',
      [
        { text: 'বাতিল', style: 'cancel' },
        { text: 'চালু করুন', onPress: continueAsGuest },
      ],
    );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <LinearGradient
        colors={t.dark ? ['#0A2A66', '#000000'] : ['#D6E6FF', '#F2F2F7']}
        style={StyleSheet.absoluteFill}
      />
      <View style={{ flex: 1, paddingTop: insets.top + 60, paddingHorizontal: 28 }}>
        <LinearGradient colors={t.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logo}>
          <Ionicons name="wallet" size={46} color="#fff" />
        </LinearGradient>
        <T size={36} weight="800" center style={{ marginTop: 22 }}>
          হিসাব খাতা
        </T>
        <T size={16} dim={1} center style={{ marginTop: 6 }}>
          টাকা পাঠানোর দৈনিক হিসাব — সহজ, নির্ভুল, নিরাপদ
        </T>

        <View style={{ marginTop: 42, gap: 22 }}>
          {FEATURES.map((f) => (
            <View key={f.title} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name={f.icon} size={34} color={t.tint} style={{ width: 46 }} />
              <View style={{ flex: 1 }}>
                <T size={16} weight="600">
                  {f.title}
                </T>
                <T size={14} dim={1} style={{ marginTop: 2 }}>
                  {f.text}
                </T>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 24 }}>
        <Pressable
          disabled={busy}
          onPress={() => {
            tap();
            void google();
          }}
          style={({ pressed }) => [
            styles.google,
            { backgroundColor: t.dark ? '#fff' : '#000', opacity: busy ? 0.6 : pressed ? 0.8 : 1 },
          ]}
        >
          <Ionicons name="logo-google" size={20} color={t.dark ? '#000' : '#fff'} />
          <T size={17} weight="600" color={t.dark ? '#000' : '#fff'} style={{ marginLeft: 10 }}>
            {busy ? 'Google থেকে হিসাব আনা হচ্ছে…' : 'Google দিয়ে চালিয়ে যান'}
          </T>
        </Pressable>
        <Pressable onPress={guest} style={{ alignItems: 'center', paddingVertical: 16 }} hitSlop={6}>
          <T size={15} color={t.tint}>
            Google ছাড়া চালু করুন
          </T>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: {
    width: 96,
    height: 96,
    borderRadius: 24,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0A84FF',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  google: { height: 56, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
