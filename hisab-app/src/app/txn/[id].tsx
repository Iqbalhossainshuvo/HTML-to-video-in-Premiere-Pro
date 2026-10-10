import { router, useLocalSearchParams } from 'expo-router';
import { Alert, View } from 'react-native';
import { txnEffects } from '../../core/ledger';
import { rateToString } from '../../core/money';
import { useStore } from '../../data/store';
import { Button, Empty, IconBadge, Row, Section, T } from '../../ui/kit';
import { KIND_META, TXN_META } from '../../ui/meta';
import { Sheet } from '../../ui/sheet';
import { dateLabel, timeLabel, useMoney, useTheme } from '../../ui/theme';

export default function TxnDetail() {
  const t = useTheme();
  const m = useMoney();
  const { db, deleteTxn } = useStore();
  const { id } = useLocalSearchParams<{ id: string }>();
  const x = db.txns[id];
  if (!x || x.deleted)
    return (
      <Sheet title="লেনদেন">
        <Empty icon="trash-outline" title="এই লেনদেনটি আর নেই" />
      </Sheet>
    );

  const meta = TXN_META[x.type];
  const party = x.partyId ? db.parties[x.partyId] : undefined;
  const agent = x.agentId ? db.parties[x.agentId] : undefined;
  const e = txnEffects(x);
  const fmtFor = (pid: string, v: number) =>
    db.parties[pid]?.kind === 'agent' ? m.home(v, { sign: true }) : m.local(v, { sign: true });
  const main =
    x.type === 'send'
      ? m.local(x.amount + (x.fee || 0))
      : x.type === 'opening' && x.homeAmount !== undefined
        ? m.home(x.homeAmount, { sign: true })
        : m.local(x.amount);

  const remove = () =>
    Alert.alert('লেনদেন মুছবেন?', 'সব হিসাব থেকে এটা বাদ যাবে।', [
      { text: 'বাতিল', style: 'cancel' },
      {
        text: 'মুছে ফেলুন',
        style: 'destructive',
        onPress: () => {
          deleteTxn(x.id);
          router.back();
        },
      },
    ]);

  return (
    <Sheet title={meta.label}>
      <View style={{ alignItems: 'center', paddingVertical: 18 }}>
        <IconBadge name={meta.icon} color={meta.color(t)} size={64} />
        <T size={34} weight="800" style={{ marginTop: 14, fontVariant: ['tabular-nums'] }}>
          {main}
        </T>
        <T size={15} dim={1} style={{ marginTop: 4 }}>
          {dateLabel(x.date, true)} · {timeLabel(x.createdAt)}
        </T>
      </View>

      <Section title="বিস্তারিত">
        {party ? <Row title={KIND_META[party.kind].label} value={party.name} onPress={() => router.push({ pathname: '/party/[id]', params: { id: party.id } })} /> : null}
        {agent ? <Row title="দেশের এজেন্ট" value={agent.name} onPress={() => router.push({ pathname: '/party/[id]', params: { id: agent.id } })} /> : null}
        {x.type === 'send' ? <Row title="টাকা" value={m.local(x.amount)} /> : null}
        {x.homeAmount !== undefined && x.type !== 'opening' && m.homeCurrency !== m.localCurrency ? (
          <Row title={x.type === 'send' ? 'দেশে পাঠানো' : 'এজেন্টের খাতায়'} value={m.home(x.homeAmount)} valueColor={t.tint} />
        ) : null}
        {x.rateE4 && m.homeCurrency !== m.localCurrency ? <Row title="রেট" value={rateToString(x.rateE4)} /> : null}
        {x.fee ? <Row title="সার্ভিস চার্জ" value={m.local(x.fee)} /> : null}
        {x.type === 'send' ? <Row title="দিয়েছে" value={m.local(x.paid || 0)} valueColor={t.green} /> : null}
        {x.type === 'send' ? (
          <Row title="বাকি" value={m.local(x.amount + (x.fee || 0) - (x.paid || 0))} valueColor={t.orange} />
        ) : null}
        {x.receiver ? <Row title="প্রাপক" value={x.receiver} /> : null}
        {x.note ? <Row title="নোট" subtitle={x.note} /> : null}
      </Section>

      <Section title="হিসাবে যা বদলেছে">
        {e.cash ? <Row title="হাতে ক্যাশ" value={m.local(e.cash, { sign: true })} valueColor={e.cash > 0 ? t.green : t.red} /> : null}
        {e.parties.map((p) => (
          <Row
            key={p.id}
            title={db.parties[p.id]?.name || '—'}
            subtitle={p.delta > 0 ? 'আমার পাওনা বাড়লো' : 'আমার দেনা বাড়লো / পাওনা কমলো'}
            value={fmtFor(p.id, p.delta)}
            valueColor={p.delta > 0 ? t.green : t.red}
          />
        ))}
        {e.fee ? <Row title="আয় (সার্ভিস চার্জ)" value={m.local(e.fee, { sign: true })} valueColor={t.green} /> : null}
        {e.expense ? <Row title="খরচ" value={m.local(-e.expense)} valueColor={t.red} /> : null}
      </Section>

      <View style={{ marginHorizontal: 16, gap: 12 }}>
        <Button title="সম্পাদনা" icon="create-outline" onPress={() => router.replace({ pathname: '/txn/new', params: { id: x.id } })} />
        <Button title="মুছে ফেলুন" icon="trash-outline" kind="tinted" color={t.red} onPress={remove} />
      </View>
    </Sheet>
  );
}
