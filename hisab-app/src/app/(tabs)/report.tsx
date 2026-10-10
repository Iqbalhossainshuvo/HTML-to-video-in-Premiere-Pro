import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import { dayKey, monthRange, rangeSummary, shiftDay, type DaySummary } from '../../core/ledger';
import { formatMinor } from '../../core/money';
import type { Db } from '../../core/types';
import { useStore } from '../../data/store';
import { Card, IconBtn, Page, Row, Section, Segmented, T, tap } from '../../ui/kit';
import { TxnRow } from '../../ui/parts';
import { dateLabel, monthLabel, useMoney, useTheme } from '../../ui/theme';

type Mode = 'day' | 'month';

export default function Report() {
  const t = useTheme();
  const m = useMoney();
  const { db } = useStore();
  const today = dayKey();
  const [mode, setMode] = useState<Mode>('day');
  const [date, setDate] = useState(today);
  const [from, to] = mode === 'day' ? [date, date] : monthRange(date);
  const s = useMemo(() => rangeSummary(db, from, to), [db, from, to]);
  const profit = s.fees - s.expenses;

  const step = (dir: number) => {
    tap();
    if (mode === 'day') setDate(shiftDay(date, dir));
    else {
      const [y, mo] = date.split('-').map(Number);
      setDate(dayKey(new Date(y, mo - 1 + dir, 1)));
    }
  };
  const isNow = mode === 'day' ? date === today : monthRange(today)[0] === from;
  const label = mode === 'day' ? dateLabel(date, true) : monthLabel(date);

  return (
    <Page
      title="রিপোর্ট"
      right={<IconBtn name="share-outline" label="শেয়ার" onPress={() => void Share.share({ message: reportText(db, s, label) })} />}
    >
      <Segmented
        style={{ marginHorizontal: 16, marginBottom: 14 }}
        value={mode}
        onChange={(v) => {
          setMode(v);
        }}
        options={[
          { value: 'day', label: 'দৈনিক' },
          { value: 'month', label: 'মাসিক' },
        ]}
      />
      <View style={styles.nav}>
        <Pressable onPress={() => step(-1)} hitSlop={10} style={[styles.navBtn, { backgroundColor: t.card }]}>
          <Ionicons name="chevron-back" size={20} color={t.tint} />
        </Pressable>
        <Pressable
          style={{ flex: 1, alignItems: 'center' }}
          onPress={() => {
            tap();
            setDate(today);
          }}
        >
          <T size={17} weight="700">
            {label}
          </T>
          <T size={12} color={isNow ? t.text2 : t.tint}>
            {isNow ? (mode === 'day' ? 'আজ' : 'এই মাস') : 'আজকে ফিরুন'}
          </T>
        </Pressable>
        <Pressable
          onPress={() => step(1)}
          disabled={isNow}
          hitSlop={10}
          style={[styles.navBtn, { backgroundColor: t.card, opacity: isNow ? 0.35 : 1 }]}
        >
          <Ionicons name="chevron-forward" size={20} color={t.tint} />
        </Pressable>
      </View>

      <Card style={{ marginBottom: 22 }}>
        <T size={13} dim={1} weight="600">
          ক্যাশের হিসাব
        </T>
        <Line label="আগের জের" value={m.fmt(s.openingCash)} />
        <Line label="+ এসেছে" value={m.fmt(s.cashIn)} color={t.green} />
        <Line label="− গিয়েছে" value={m.fmt(s.cashOut)} color={t.red} />
        <View style={[styles.rule, { backgroundColor: t.sep }]} />
        <Line label="শেষ ক্যাশ" value={m.local(s.closingCash)} bold />
      </Card>

      <Section title="টাকা পাঠানো">
        <Row title="মোট লেনদেন" value={`${s.sendCount}টি`} />
        <Row title="দেশে পাঠানো" value={m.home(s.sendHome)} valueColor={t.tint} />
        <Row title="কাস্টমারের মোট বিল" value={m.local(s.sendLocal)} />
        <Row title="সাথে সাথে দিয়েছে" value={m.local(s.paidNow)} valueColor={t.green} />
        <Row title="নতুন বাকি" value={m.local(s.newDue)} valueColor={t.orange} />
        <Row title="বাকি আদায়" value={m.local(s.collected)} valueColor={t.green} />
        <Row title="এজেন্টকে পরিশোধ" value={m.local(s.agentPaid)} />
      </Section>

      <Section title="আয়-ব্যয়" footer="লাভ = সার্ভিস চার্জ − খরচ">
        <Row title="সার্ভিস চার্জ আয়" value={m.local(s.fees)} valueColor={t.green} />
        <Row title="খরচ" value={m.local(s.expenses)} valueColor={t.red} />
        <Row title="লাভ" value={m.local(profit, { sign: true })} valueColor={profit >= 0 ? t.green : t.red} />
      </Section>

      <Section title={`লেনদেন (${s.txns.length})`}>
        {s.txns.length ? (
          s.txns.map((x) => (
            <TxnRow
              key={x.id}
              txn={x}
              showDate={mode === 'month'}
              onPress={() => router.push({ pathname: '/txn/[id]', params: { id: x.id } })}
            />
          ))
        ) : (
          <Row title="এই সময়ে কোনো লেনদেন নেই" />
        )}
      </Section>
    </Page>
  );
}

function Line({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
      <T size={bold ? 17 : 16} weight={bold ? '700' : '400'} style={{ flex: 1 }}>
        {label}
      </T>
      <T size={bold ? 20 : 16} weight={bold ? '800' : '600'} color={color} style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </T>
    </View>
  );
}

function reportText(db: Db, s: DaySummary, label: string): string {
  const L = db.settings.localCurrency;
  const H = db.settings.homeCurrency;
  const f = (v: number) => formatMinor(v);
  return [
    `${db.settings.businessName || 'হিসাব খাতা'} — ${label}`,
    '',
    `আগের জের: ${f(s.openingCash)} ${L}`,
    `এসেছে: +${f(s.cashIn)} ${L}`,
    `গিয়েছে: −${f(s.cashOut)} ${L}`,
    `শেষ ক্যাশ: ${f(s.closingCash)} ${L}`,
    '',
    `পাঠানো: ${s.sendCount}টি, ${f(s.sendHome)} ${H}`,
    `কাস্টমারের বিল: ${f(s.sendLocal)} ${L}`,
    `নতুন বাকি: ${f(s.newDue)} ${L}`,
    `বাকি আদায়: ${f(s.collected)} ${L}`,
    `সার্ভিস চার্জ: ${f(s.fees)} ${L}`,
    `খরচ: ${f(s.expenses)} ${L}`,
    `লাভ: ${f(s.fees - s.expenses)} ${L}`,
  ].join('\n');
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 16 },
  navBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rule: { height: StyleSheet.hairlineWidth, marginTop: 12 },
});
