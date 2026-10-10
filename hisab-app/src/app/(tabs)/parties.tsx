import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { balances, liveParties } from '../../core/ledger';
import type { PartyKind } from '../../core/types';
import { useStore } from '../../data/store';
import { Avatar, Empty, Fab, Page, Row, SearchBar, Segmented, T } from '../../ui/kit';
import { balanceWord, KIND_META } from '../../ui/meta';
import { useMoney, useTheme } from '../../ui/theme';

type Sort = 'name' | 'due';

export default function Parties() {
  const t = useTheme();
  const m = useMoney();
  const { db } = useStore();
  const [kind, setKind] = useState<PartyKind>('customer');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('due');
  const bal = useMemo(() => balances(db).party, [db]);
  const cur = kind === 'agent' ? m.homeCurrency : m.localCurrency;

  const { list, plus, minus } = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = liveParties(db, kind);
    let plus = 0;
    let minus = 0;
    for (const p of all) {
      const v = bal[p.id] || 0;
      if (v > 0) plus += v;
      else minus -= v;
    }
    const list = all.filter((p) => !s || p.name.toLowerCase().includes(s) || (p.phone || '').includes(s));
    if (sort === 'due') list.sort((a, z) => Math.abs(bal[z.id] || 0) - Math.abs(bal[a.id] || 0));
    return { list, plus, minus };
  }, [db, kind, q, sort, bal]);

  return (
    <Page title="খাতা" scroll={false}>
      <Segmented
        style={{ marginHorizontal: 16, marginBottom: 12 }}
        value={kind}
        onChange={setKind}
        options={(['customer', 'agent', 'partner'] as PartyKind[]).map((k) => ({ value: k, label: KIND_META[k].plural }))}
      />
      <View style={{ flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, gap: 10 }}>
        <View style={{ flex: 1, backgroundColor: t.card, borderRadius: 14, padding: 12 }}>
          <T size={12} dim={1} weight="500">
            {kind === 'agent' ? 'এজেন্ট দেবে' : 'মোট পাবো (বাকি)'}
          </T>
          <T size={18} weight="700" color={t.green} style={{ marginTop: 3 }} numberOfLines={1}>
            {m.fmt(plus, { cur })}
          </T>
        </View>
        <View style={{ flex: 1, backgroundColor: t.card, borderRadius: 14, padding: 12 }}>
          <T size={12} dim={1} weight="500">
            {kind === 'agent' ? 'এজেন্টকে দেবো' : 'মোট দেবো'}
          </T>
          <T size={18} weight="700" color={t.red} style={{ marginTop: 3 }} numberOfLines={1}>
            {m.fmt(minus, { cur })}
          </T>
        </View>
      </View>
      <SearchBar value={q} onChange={setQ} placeholder={`${KIND_META[kind].label} খুঁজুন`} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 6 }}>
        <T size={13} dim={1} style={{ flex: 1 }}>
          {list.length} জন · {KIND_META[kind].hint}
        </T>
        <Pressable hitSlop={8} onPress={() => setSort(sort === 'due' ? 'name' : 'due')}>
          <T size={13} color={t.tint} weight="600">
            {sort === 'due' ? 'বেশি বাকি আগে' : 'নাম অনুসারে'}
          </T>
        </Pressable>
      </View>
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: 160 }}
        renderItem={({ item, index }) => {
          const v = bal[item.id] || 0;
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
                left={<Avatar name={item.name} size={40} />}
                title={item.name}
                subtitle={[item.phone, balanceWord(v, item.kind)].filter(Boolean).join(' · ')}
                value={v ? m.fmt(v, { abs: true, cur }) : '0'}
                valueColor={v > 0 ? t.green : v < 0 ? t.red : t.text2}
                onPress={() => router.push({ pathname: '/party/[id]', params: { id: item.id } })}
              />
            </View>
          );
        }}
        ListEmptyComponent={
          <Empty
            icon={KIND_META[kind].icon}
            title={q ? 'কাউকে পাওয়া যায়নি' : `কোনো ${KIND_META[kind].label} নেই`}
            text={`নিচের + চেপে ${KIND_META[kind].label} যোগ করুন`}
          />
        }
      />
      <Fab icon="person-add" onPress={() => router.push({ pathname: '/party/edit', params: { kind } })} />
    </Page>
  );
}
