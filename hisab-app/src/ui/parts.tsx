/* App-specific pieces: a transaction row and the party picker sheet. */
import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { balances, liveParties } from '../core/ledger';
import type { Party, PartyKind, Txn } from '../core/types';
import { useStore } from '../data/store';
import { Avatar, IconBadge, Row, SearchBar, Segmented, T, tap } from './kit';
import { balanceWord, KIND_META, TXN_META } from './meta';
import { dateLabel, timeLabel, useMoney, useTheme } from './theme';

export function TxnRow({ txn, onPress, showDate }: { txn: Txn; onPress?: () => void; showDate?: boolean }) {
  const t = useTheme();
  const m = useMoney();
  const { db } = useStore();
  const meta = TXN_META[txn.type];
  const party = txn.partyId ? db.parties[txn.partyId] : undefined;
  const agent = txn.agentId ? db.parties[txn.agentId] : undefined;
  const when = showDate ? dateLabel(txn.date) : timeLabel(txn.createdAt);
  const bits = [meta.short, when];
  if (txn.type === 'send' && agent) bits.push('→ ' + agent.name);
  if (txn.note) bits.push(txn.note);

  let value: string;
  let color: string | undefined;
  let sub: string | undefined;
  if (txn.type === 'send') {
    value = m.local(txn.amount + (txn.fee || 0));
    sub = txn.homeAmount && m.homeCurrency !== m.localCurrency ? m.home(txn.homeAmount) : undefined;
    const due = txn.amount + (txn.fee || 0) - (txn.paid || 0);
    if (due > 0) sub = (sub ? sub + ' · ' : '') + 'বাকি ' + m.fmt(due);
    color = t.tint;
  } else if (txn.type === 'opening') {
    value = txn.homeAmount !== undefined ? m.home(txn.homeAmount, { sign: true }) : m.local(txn.amount, { sign: true });
  } else {
    const out = txn.type === 'give' || txn.type === 'expense' || txn.type === 'cash_out';
    value = m.local(out ? -txn.amount : txn.amount, { sign: true });
    color = out ? t.red : t.green;
    if (txn.homeAmount !== undefined && m.homeCurrency !== m.localCurrency) sub = m.home(txn.homeAmount);
  }
  return (
    <Row
      icon={<IconBadge name={meta.icon} color={meta.color(t)} size={36} />}
      title={party?.name || meta.label}
      subtitle={bits.join(' · ')}
      value={value}
      valueColor={color}
      valueSub={sub}
      onPress={onPress}
      chevron={false}
    />
  );
}

export function PartyPicker({
  visible,
  kinds,
  onPick,
  onClose,
  title,
}: {
  visible: boolean;
  kinds: PartyKind[];
  onPick: (p: Party) => void;
  onClose: () => void;
  title: string;
}) {
  const t = useTheme();
  const m = useMoney();
  const insets = useSafeAreaInsets();
  const { db, saveParty } = useStore();
  const [q, setQ] = useState('');
  const [chosen, setKind] = useState<PartyKind | null>(null);
  const kind = chosen && kinds.includes(chosen) ? chosen : kinds[0];
  const bal = useMemo(() => balances(db).party, [db]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return liveParties(db, kind).filter((p) => !s || p.name.toLowerCase().includes(s) || (p.phone || '').includes(s));
  }, [db, kind, q]);
  const exact = list.some((p) => p.name.trim().toLowerCase() === q.trim().toLowerCase());

  const close = () => {
    setQ('');
    setKind(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 }}>
          <T size={20} weight="700" style={{ flex: 1 }}>
            {title}
          </T>
          <Pressable onPress={close} hitSlop={10}>
            <T color={t.tint} weight="600">
              বন্ধ
            </T>
          </Pressable>
        </View>
        {kinds.length > 1 ? (
          <Segmented
            style={{ marginHorizontal: 16, marginBottom: 12 }}
            value={kind}
            onChange={setKind}
            options={kinds.map((k) => ({ value: k, label: KIND_META[k].plural }))}
          />
        ) : null}
        <SearchBar value={q} onChange={setQ} placeholder="নাম বা নম্বর খুঁজুন" />
        <FlatList
          data={list}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          ListHeaderComponent={
            q.trim() && !exact ? (
              <Pressable
                onPress={() => {
                  tap();
                  const p = saveParty({ kind, name: q.trim() });
                  setQ('');
                  setKind(null);
                  onPick(p);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginHorizontal: 16,
                  marginBottom: 12,
                  padding: 14,
                  borderRadius: 14,
                  backgroundColor: t.tint + '1A',
                }}
              >
                <Ionicons name="person-add" size={20} color={t.tint} />
                <T color={t.tint} weight="600" style={{ marginLeft: 10, flex: 1 }} numberOfLines={1}>
                  নতুন {KIND_META[kind].label}: “{q.trim()}”
                </T>
              </Pressable>
            ) : null
          }
          renderItem={({ item, index }) => {
            const v = bal[item.id] || 0;
            const cur = item.kind === 'agent' ? m.homeCurrency : m.localCurrency;
            return (
              <View
                style={{
                  backgroundColor: t.card,
                  marginHorizontal: 16,
                  borderTopLeftRadius: index === 0 ? 14 : 0,
                  borderTopRightRadius: index === 0 ? 14 : 0,
                  borderBottomLeftRadius: index === list.length - 1 ? 14 : 0,
                  borderBottomRightRadius: index === list.length - 1 ? 14 : 0,
                  overflow: 'hidden',
                }}
              >
                <Row
                  left={<Avatar name={item.name} size={36} />}
                  title={item.name}
                  subtitle={item.phone || balanceWord(v, item.kind)}
                  value={v ? m.fmt(v, { abs: true, cur }) : undefined}
                  valueColor={v > 0 ? t.green : v < 0 ? t.red : undefined}
                  onPress={() => {
                    tap();
                    setQ('');
                    setKind(null);
                    onPick(item);
                  }}
                  chevron={false}
                />
              </View>
            );
          }}
          ListEmptyComponent={
            !q.trim() ? (
              <T dim={1} center style={{ marginTop: 30, marginHorizontal: 30 }}>
                এখনো কোনো {KIND_META[kind].label} নেই। উপরে নাম লিখে যোগ করুন।
              </T>
            ) : null
          }
        />
      </View>
    </Modal>
  );
}
