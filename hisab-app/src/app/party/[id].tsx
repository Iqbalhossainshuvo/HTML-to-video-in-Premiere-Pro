import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Linking, Pressable, Share, StyleSheet, View } from 'react-native';
import { partyLedger } from '../../core/ledger';
import { formatMinor } from '../../core/money';
import type { TxnType } from '../../core/types';
import { useStore } from '../../data/store';
import { Avatar, Empty, IconBadge, Page, Row, Section, T, tap } from '../../ui/kit';
import { balanceWord, KIND_META, TXN_META } from '../../ui/meta';
import { dateLabel, useMoney, useTheme } from '../../ui/theme';

export default function PartyScreen() {
  const t = useTheme();
  const m = useMoney();
  const { db } = useStore();
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = db.parties[id];
  const lines = useMemo(() => (p ? partyLedger(db, id) : []), [db, id, p]);

  if (!p || p.deleted)
    return (
      <Page topInset={false}>
        <Stack.Screen options={{ headerShown: true, title: '' }} />
        <Empty icon="person-outline" title="পাওয়া যায়নি" />
      </Page>
    );

  const bal = lines.length ? lines[lines.length - 1].balance : 0;
  const isAgent = p.kind === 'agent';
  const fmt = (v: number, o: { sign?: boolean; abs?: boolean } = {}) => (isAgent ? m.home(v, o) : m.local(v, o));
  const color = bal > 0 ? t.green : bal < 0 ? t.red : t.text2;

  const actions: { type: TxnType; label: string }[] =
    p.kind === 'customer'
      ? [
          { type: 'send', label: 'টাকা পাঠান' },
          { type: 'receive', label: 'বাকি আদায়' },
          { type: 'give', label: 'টাকা দিলাম' },
        ]
      : p.kind === 'agent'
        ? [
            { type: 'give', label: 'এজেন্টকে দিলাম' },
            { type: 'receive', label: 'এজেন্ট থেকে পেলাম' },
          ]
        : [
            { type: 'receive', label: 'এসেছে (পেলাম)' },
            { type: 'give', label: 'গিয়েছে (দিলাম)' },
          ];

  const share = () => {
    const cur = isAgent ? db.settings.homeCurrency : db.settings.localCurrency;
    const body = lines
      .slice(-30)
      .map((l) => `${l.txn.date}  ${TXN_META[l.txn.type].short}  ${formatMinor(l.delta, { sign: true })}  = ${formatMinor(l.balance)}`)
      .join('\n');
    void Share.share({
      message: `${p.name} — হিসাব\n\n${body}\n\nবর্তমান: ${formatMinor(Math.abs(bal))} ${cur} (${balanceWord(bal, p.kind)})`,
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '',
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 18 }}>
              <Pressable onPress={share} hitSlop={8}>
                <Ionicons name="share-outline" size={23} color={t.tint} />
              </Pressable>
              <Pressable onPress={() => router.push({ pathname: '/party/edit', params: { id: p.id } })} hitSlop={8}>
                <T color={t.tint} weight="600">
                  এডিট
                </T>
              </Pressable>
            </View>
          ),
        }}
      />
      <Page padBottom={40} topInset={false}>
        <View style={{ alignItems: 'center', marginBottom: 20 }}>
          <Avatar name={p.name} size={84} />
          <T size={26} weight="700" style={{ marginTop: 12 }}>
            {p.name}
          </T>
          <T size={14} dim={1} style={{ marginTop: 2 }}>
            {KIND_META[p.kind].label}
            {p.phone ? ' · ' + p.phone : ''}
          </T>
          {p.phone ? (
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
              <Circle icon="call" color={t.green} onPress={() => void Linking.openURL(`tel:${p.phone}`)} />
              <Circle icon="chatbubble" color={t.tint} onPress={() => void Linking.openURL(`sms:${p.phone}`)} />
            </View>
          ) : null}
        </View>

        <View style={[styles.balance, { backgroundColor: t.card }]}>
          <T size={13} dim={1} weight="600">
            {balanceWord(bal, p.kind)}
          </T>
          <T size={36} weight="800" color={color} style={{ marginTop: 4, fontVariant: ['tabular-nums'] }}>
            {fmt(bal, { abs: true })}
          </T>
        </View>

        <View style={styles.actions}>
          {actions.map((a) => {
            const c = TXN_META[a.type].color(t);
            return (
              <Pressable
                key={a.type}
                onPress={() => {
                  tap();
                  router.push({ pathname: '/txn/new', params: { type: a.type, partyId: p.id } });
                }}
                style={({ pressed }) => [styles.action, { backgroundColor: t.card, opacity: pressed ? 0.6 : 1 }]}
              >
                <Ionicons name={TXN_META[a.type].icon} size={22} color={c} />
                <T size={12} weight="600" center style={{ marginTop: 6 }}>
                  {a.label}
                </T>
              </Pressable>
            );
          })}
        </View>

        {p.note ? (
          <Section>
            <Row title="নোট" subtitle={p.note} />
          </Section>
        ) : null}

        <Section title="হিসাবের বিবরণ" footer={isAgent ? 'মাইনাস = আমি এজেন্টকে দেব' : 'প্লাস = সে আমাকে দেবে, মাইনাস = আমি তাকে দেব'}>
          {lines.length ? (
            lines
              .slice()
              .reverse()
              .map((l) => {
                const meta = TXN_META[l.txn.type];
                const bits = [meta.short, dateLabel(l.txn.date)];
                if (l.txn.receiver) bits.push(l.txn.receiver);
                if (l.txn.note) bits.push(l.txn.note);
                return (
                  <Row
                    key={l.txn.id}
                    icon={<IconBadge name={meta.icon} color={meta.color(t)} size={34} />}
                    title={fmt(l.delta, { sign: true })}
                    subtitle={bits.join(' · ')}
                    value={fmt(l.balance)}
                    valueSub="ব্যালেন্স"
                    onPress={() => router.push({ pathname: '/txn/[id]', params: { id: l.txn.id } })}
                    chevron={false}
                  />
                );
              })
          ) : (
            <Row title="এখনো কোনো লেনদেন নেই" />
          )}
        </Section>
      </Page>
    </>
  );
}

function Circle({ icon, color, onPress }: { icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.circle, { backgroundColor: color + '22' }]}>
      <Ionicons name={icon} size={20} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  balance: { marginHorizontal: 16, borderRadius: 18, padding: 18, alignItems: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginVertical: 18 },
  action: { flex: 1, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 6, alignItems: 'center' },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
