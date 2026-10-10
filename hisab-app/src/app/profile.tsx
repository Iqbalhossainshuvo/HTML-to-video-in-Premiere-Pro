import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Switch, View } from 'react-native';
import { parseRate, rateToString } from '../core/money';
import { shareCsv } from '../data/export';
import { useStore } from '../data/store';
import { Avatar, Button, Field, IconBadge, Row, Section, Segmented, T } from '../ui/kit';
import { Sheet } from '../ui/sheet';
import { timeLabel, dateLabel, useTheme } from '../ui/theme';
import { dayKey } from '../core/ledger';

export default function Profile() {
  const t = useTheme();
  const { db, session, prefs, setPrefs, sync, syncNow, signOut, signInWithGoogle, saveSettings } = useStore();
  const s = db.settings;
  const [business, setBusiness] = useState(s.businessName);
  const [local, setLocal] = useState(s.localCurrency);
  const [home, setHome] = useState(s.homeCurrency);
  const [rate, setRate] = useState(rateToString(s.defaultRateE4));
  const [busy, setBusy] = useState(false);
  const google = session?.mode === 'google';
  const user = session?.user;

  const settingsChanged =
    business.trim() !== s.businessName ||
    local.trim().toUpperCase() !== s.localCurrency ||
    home.trim().toUpperCase() !== s.homeCurrency ||
    parseRate(rate) !== s.defaultRateE4;

  const saveAll = () => {
    const r = parseRate(rate);
    if (!r) {
      Alert.alert('রেট ঠিক নেই', 'যেমন: 32.50');
      return;
    }
    if (!local.trim() || !home.trim()) {
      Alert.alert('মুদ্রার নাম দিন', 'যেমন: SAR, AED, MYR, BDT');
      return;
    }
    saveSettings({
      businessName: business.trim(),
      localCurrency: local.trim().toUpperCase(),
      homeCurrency: home.trim().toUpperCase(),
      defaultRateE4: r,
    });
    Alert.alert('সেভ হয়েছে');
  };

  const connect = async () => {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      Alert.alert('লগইন হয়নি', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    const go = async () => {
      setBusy(true);
      const ok = google ? await syncNow() : true;
      setBusy(false);
      const finish = () => void signOut();
      if (!ok) {
        Alert.alert('Google-এ সব ওঠেনি', 'এখন বের হলে শেষ কিছু হিসাব হারাতে পারে। ইন্টারনেট চালু করে আবার চেষ্টা করুন।', [
          { text: 'থাকুন', style: 'cancel' },
          { text: 'তবুও বের হন', style: 'destructive', onPress: finish },
        ]);
      } else finish();
    };
    Alert.alert(
      'লগআউট করবেন?',
      google
        ? 'আপনার সব হিসাব Google-এ রাখা আছে। আবার একই Google দিয়ে ঢুকলে সব ফিরে পাবেন। এই ফোন থেকে হিসাব মুছে যাবে।'
        : 'আপনি Google ছাড়া চালাচ্ছেন — বের হলে এই ফোনের সব হিসাব মুছে যাবে!',
      [
        { text: 'বাতিল', style: 'cancel' },
        { text: 'লগআউট', style: 'destructive', onPress: () => void go() },
      ],
    );
  };

  const syncLine =
    sync.status === 'syncing'
      ? 'সিঙ্ক হচ্ছে…'
      : sync.status === 'error'
        ? `সিঙ্ক হয়নি: ${sync.error || ''}`
        : sync.lastSync
          ? `শেষ সিঙ্ক: ${dateLabel(dayKey(new Date(sync.lastSync)))}, ${timeLabel(sync.lastSync)}`
          : 'এখনো সিঙ্ক হয়নি';

  const counts = {
    parties: Object.values(db.parties).filter((p) => !p.deleted).length,
    txns: Object.values(db.txns).filter((x) => !x.deleted).length,
  };

  return (
    <Sheet title="প্রোফাইল">
      <View style={{ alignItems: 'center', paddingVertical: 14 }}>
        <Avatar name={user?.name || 'আমি'} photo={user?.photo} size={88} />
        <T size={24} weight="700" style={{ marginTop: 12 }}>
          {user?.name || 'অফলাইন ব্যবহারকারী'}
        </T>
        <T size={15} dim={1} style={{ marginTop: 2 }}>
          {user?.email || 'Google যুক্ত নেই'}
        </T>
      </View>

      <Section title="Google ব্যাকআপ" footer={google ? 'সব হিসাব আপনার Google Drive-এর গোপন অ্যাপ-ফোল্ডারে থাকে। নতুন ফোনে একই Google দিয়ে ঢুকলে সব ফিরে আসবে।' : undefined}>
        {google ? (
          <>
            <Row
              icon={<IconBadge name={sync.status === 'error' ? 'cloud-offline' : 'cloud-done'} color={sync.status === 'error' ? t.red : t.green} />}
              title={sync.status === 'error' ? 'সমস্যা হয়েছে' : 'Google-এ সংরক্ষিত'}
              subtitle={syncLine}
              right={sync.status === 'syncing' ? <ActivityIndicator /> : undefined}
            />
            <Row
              icon={<IconBadge name="sync" color={t.tint} />}
              title="এখনই সিঙ্ক করুন"
              onPress={() => void syncNow()}
            />
          </>
        ) : (
          <Row
            icon={<IconBadge name="logo-google" color={t.tint} />}
            title="Google দিয়ে ব্যাকআপ চালু করুন"
            subtitle="এই ফোনের হিসাবও Google-এ উঠে যাবে"
            onPress={() => void connect()}
            right={busy ? <ActivityIndicator /> : undefined}
          />
        )}
      </Section>

      <Section title="ব্যবসার তথ্য" footer="রেট = ১ এখানের টাকায় দেশের কত টাকা। দুই মুদ্রা একই হলে রেটের দরকার নেই।">
        <Field label="ব্যবসার নাম" placeholder="যেমন: রহিম ট্রাভেলস" value={business} onChangeText={setBusiness} />
        <Field label="এখানের মুদ্রা" placeholder="SAR / AED / MYR / QAR" value={local} onChangeText={setLocal} autoCapitalize="characters" />
        <Field label="দেশের মুদ্রা" placeholder="BDT" value={home} onChangeText={setHome} autoCapitalize="characters" />
        <Field label="সাধারণ রেট" placeholder="32.50" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
      </Section>
      {settingsChanged ? (
        <View style={{ marginHorizontal: 16, marginTop: -8, marginBottom: 22 }}>
          <Button title="সেভ করুন" onPress={saveAll} />
        </View>
      ) : null}

      <Section title="দেখতে কেমন">
        <View style={{ padding: 12 }}>
          <Segmented
            value={prefs.theme}
            onChange={(theme) => setPrefs({ theme })}
            options={[
              { value: 'system', label: 'অটো' },
              { value: 'light', label: 'লাইট' },
              { value: 'dark', label: 'ডার্ক' },
            ]}
          />
        </View>
        <Row
          icon={<IconBadge name="language" color={t.orange} />}
          title="বাংলা সংখ্যা (১২৩)"
          right={<Switch value={prefs.banglaDigits} onValueChange={(v) => setPrefs({ banglaDigits: v })} />}
        />
        <Row
          icon={<IconBadge name="eye-off" color={t.purple} />}
          title="টাকার অঙ্ক লুকান"
          right={<Switch value={prefs.hideAmounts} onValueChange={(v) => setPrefs({ hideAmounts: v })} />}
        />
      </Section>

      <Section title="ডেটা" footer={`${counts.parties} জন · ${counts.txns}টি লেনদেন`}>
        <Row
          icon={<IconBadge name="document-text" color={t.green} />}
          title="Excel / CSV এক্সপোর্ট"
          onPress={() => void shareCsv(db).catch((e) => Alert.alert('এক্সপোর্ট হয়নি', String(e)))}
        />
      </Section>

      <View style={{ marginHorizontal: 16 }}>
        <Button title="লগআউট" kind="tinted" color={t.red} icon="log-out-outline" onPress={logout} loading={busy && google} />
      </View>
      <View style={{ alignItems: 'center', marginTop: 24 }}>
        <Ionicons name="wallet" size={20} color={t.text3} />
        <T size={12} dim={2} style={{ marginTop: 4 }}>
          হিসাব খাতা · v1.0.0
        </T>
      </View>
    </Sheet>
  );
}
