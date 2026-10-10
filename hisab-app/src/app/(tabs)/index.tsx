import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { balances, daySummary, dayKey, liveParties, liveTxns, totals } from '../../core/ledger';
import type { TxnType } from '../../core/types';
import { useStore } from '../../data/store';
import { Avatar, IconBtn, Page, Row, Section, T, tap } from '../../ui/kit';
import { balanceWord, TXN_META } from '../../ui/meta';
import { TxnRow } from '../../ui/parts';
import { dateLabel, useMoney, useTheme } from '../../ui/theme';

const QUICK: TxnType[] = ['send', 'receive', 'give', 'expense'];

export default function Home() {
  const t = useTheme();
  const m = useMoney();
  const { db, session, prefs, setPrefs, sync } = useStore();
  const today = dayKey();
  const data = useMemo(() => {
    const b = balances(db);
    const tot = totals(db, b);
    const day = daySummary(db, today);
    const others = liveParties(db).filter((p) => p.kind !== 'agent');
    const owesMe = others.filter((p) => (b.party[p.id] || 0) > 0).sort((a, z) => b.party[z.id] - b.party[a.id]);
    const iOwe = others.filter((p) => (b.party[p.id] || 0) < 0).sort((a, z) => b.party[a.id] - b.party[z.id]);
    const agents = liveParties(db, 'agent');
    const recent = liveTxns(db).reverse().slice(0, 6);
    return { b, tot, day, owesMe, iOwe, agents, recent };
  }, [db, today]);
  const { b, tot, day } = data;
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && t.dark);
  const name = session?.user?.name || 'আমি';
  const syncIcon =
    sync.status === 'syncing' ? 'sync' : sync.status === 'error' ? 'cloud-offline' : sync.status === 'off' ? 'phone-portrait' : 'cloud-done';
  const syncText =
    sync.status === 'syncing'
      ? 'সিঙ্ক হচ্ছে…'
      : sync.status === 'error'
        ? 'সিঙ্ক হয়নি'
        : sync.status === 'off'
          ? 'শুধু এই ফোনে'
          : 'Google-এ সংরক্ষিত';

  return (
    <Page
      subtitle={dateLabel(today, true)}
      title={db.settings.businessName || 'হিসাব খাতা'}
      right={
        <>
          <IconBtn
            name={prefs.hideAmounts ? 'eye-off' : 'eye'}
            label="টাকা লুকান"
            onPress={() => setPrefs({ hideAmounts: !prefs.hideAmounts })}
          />
          <IconBtn
            name={dark ? 'sunny' : 'moon'}
            label="থিম"
            color={dark ? t.orange : t.indigo}
            onPress={() => setPrefs({ theme: dark ? 'light' : 'dark' })}
          />
          <Pressable onPress={() => router.push('/profile')} hitSlop={6}>
            <Avatar name={name} photo={session?.user?.photo} size={38} />
          </Pressable>
        </>
      }
    >
      {/* hero */}
      <LinearGradient colors={t.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T size={14} color="#ffffffcc" weight="600" style={{ flex: 1 }}>
            মোট ব্যালেন্স {tot.netConverted ? '(প্রায়)' : ''}
          </T>
          <Pressable onPress={() => router.push('/profile')} style={styles.syncChip}>
            <Ionicons name={syncIcon} size={13} color="#fff" />
            <T size={11} color="#fff" weight="600" style={{ marginLeft: 4 }}>
              {syncText}
            </T>
          </Pressable>
        </View>
        <T size={38} weight="800" color="#fff" style={{ marginTop: 6, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
          {m.fmt(tot.net)}
          <T size={18} weight="600" color="#ffffffcc">
            {' '}
            {m.localCurrency}
          </T>
        </T>
        <T size={12} color="#ffffffaa" style={{ marginTop: 2 }}>
          ক্যাশ + পাবো − দেবো{tot.agentNet ? ' − এজেন্টের দেনা' : ''}
        </T>
        <View style={styles.heroRow}>
          <HeroStat label="হাতে ক্যাশ" value={m.fmt(tot.cash)} />
          <View style={styles.heroDiv} />
          <HeroStat label="পাবো (বাকি)" value={m.fmt(tot.receivable)} />
          <View style={styles.heroDiv} />
          <HeroStat label="দেবো" value={m.fmt(tot.payable)} />
        </View>
      </LinearGradient>

      {/* quick actions */}
      <View style={styles.quick}>
        {QUICK.map((type) => {
          const meta = TXN_META[type];
          const c = meta.color(t);
          return (
            <Pressable
              key={type}
              onPress={() => {
                tap();
                router.push({ pathname: '/txn/new', params: { type } });
              }}
              style={({ pressed }) => [styles.quickItem, { opacity: pressed ? 0.6 : 1 }]}
            >
              <View style={[styles.quickIcon, { backgroundColor: c + (t.dark ? '33' : '1F') }]}>
                <Ionicons name={meta.icon} size={24} color={c} />
              </View>
              <T size={12} weight="600" center style={{ marginTop: 6 }}>
                {type === 'send' ? 'পাঠান' : type === 'receive' ? 'পেলাম' : type === 'give' ? 'দিলাম' : 'খরচ'}
              </T>
            </Pressable>
          );
        })}
      </View>

      {/* today */}
      <Section
        title="আজকের হিসাব"
        action={{ label: 'বিস্তারিত', onPress: () => router.push('/report') }}
      >
        <View style={styles.grid}>
          <Stat label="আগের জের (ক্যাশ)" value={m.fmt(day.openingCash)} />
          <Stat label="এখন ক্যাশ" value={m.fmt(day.closingCash)} color={t.tint} />
          <Stat label="আজ এসেছে" value={m.fmt(day.cashIn, { sign: true })} color={t.green} />
          <Stat label="আজ গিয়েছে" value={m.fmt(-day.cashOut)} color={t.red} />
          <Stat label={`পাঠানো (${day.sendCount}টি)`} value={m.home(day.sendHome)} />
          <Stat label="সার্ভিস চার্জ আয়" value={m.fmt(day.fees)} color={t.green} />
          <Stat label="আজ নতুন বাকি" value={m.fmt(day.newDue)} color={t.orange} />
          <Stat label="বাকি আদায়" value={m.fmt(day.collected)} color={t.green} />
        </View>
      </Section>

      {data.agents.length ? (
        <Section title="দেশের এজেন্ট" footer="মাইনাস মানে এজেন্টকে আপনি দেবেন">
          {data.agents.map((a) => {
            const v = b.party[a.id] || 0;
            return (
              <Row
                key={a.id}
                left={<Avatar name={a.name} size={36} />}
                title={a.name}
                subtitle={balanceWord(v, 'agent')}
                value={m.home(v)}
                valueColor={v < 0 ? t.red : v > 0 ? t.green : undefined}
                onPress={() => router.push({ pathname: '/party/[id]', params: { id: a.id } })}
              />
            );
          })}
        </Section>
      ) : null}

      <Section
        title="বাকি আছে যাদের কাছে"
        action={data.owesMe.length > 5 ? { label: 'সব', onPress: () => router.push('/parties') } : undefined}
      >
        {data.owesMe.length ? (
          data.owesMe.slice(0, 5).map((p) => (
            <Row
              key={p.id}
              left={<Avatar name={p.name} size={36} />}
              title={p.name}
              subtitle={p.phone || 'পাবো'}
              value={m.fmt(b.party[p.id])}
              valueColor={t.green}
              onPress={() => router.push({ pathname: '/party/[id]', params: { id: p.id } })}
            />
          ))
        ) : (
          <Row title="কারো কাছে বাকি নেই" subtitle="সব হিসাব পরিষ্কার" icon={<Ionicons name="checkmark-circle" size={28} color={t.green} />} />
        )}
      </Section>

      {data.iOwe.length ? (
        <Section title="আমি দেব যাদের">
          {data.iOwe.slice(0, 5).map((p) => (
            <Row
              key={p.id}
              left={<Avatar name={p.name} size={36} />}
              title={p.name}
              subtitle={p.phone || 'দেবো'}
              value={m.fmt(-b.party[p.id])}
              valueColor={t.red}
              onPress={() => router.push({ pathname: '/party/[id]', params: { id: p.id } })}
            />
          ))}
        </Section>
      ) : null}

      <Section
        title="সাম্প্রতিক লেনদেন"
        action={data.recent.length ? { label: 'সব', onPress: () => router.push('/transactions') } : undefined}
      >
        {data.recent.length ? (
          data.recent.map((x) => (
            <TxnRow key={x.id} txn={x} showDate={x.date !== today} onPress={() => router.push({ pathname: '/txn/[id]', params: { id: x.id } })} />
          ))
        ) : (
          <Row
            title="প্রথম হিসাব যোগ করুন"
            subtitle="উপরের ‘পাঠান’ বা ‘পেলাম’ চাপুন"
            icon={<Ionicons name="sparkles" size={26} color={t.orange} />}
            onPress={() => router.push({ pathname: '/txn/new', params: { type: 'send' } })}
          />
        )}
      </Section>
    </Page>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <T size={12} color="#ffffffbb" weight="500">
        {label}
      </T>
      <T size={16} color="#fff" weight="700" numberOfLines={1} style={{ marginTop: 3, fontVariant: ['tabular-nums'] }}>
        {value}
      </T>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <T size={12} dim={1} weight="500" numberOfLines={1}>
        {label}
      </T>
      <T size={17} weight="700" color={color} numberOfLines={1} style={{ marginTop: 4, fontVariant: ['tabular-nums'] }}>
        {value}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginHorizontal: 16,
    borderRadius: 22,
    padding: 20,
    shadowColor: '#0A84FF',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  syncChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff2e',
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  heroRow: {
    flexDirection: 'row',
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ffffff55',
  },
  heroDiv: { width: StyleSheet.hairlineWidth, backgroundColor: '#ffffff55', marginHorizontal: 10 },
  quick: { flexDirection: 'row', justifyContent: 'space-around', marginHorizontal: 16, marginVertical: 22 },
  quickItem: { alignItems: 'center', width: 76 },
  quickIcon: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 4 },
  stat: { width: '50%', paddingHorizontal: 16, paddingVertical: 10 },
});

