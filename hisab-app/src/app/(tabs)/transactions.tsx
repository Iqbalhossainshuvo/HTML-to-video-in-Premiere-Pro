import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { SectionList, View } from 'react-native';
import { liveTxns, txnEffects } from '../../core/ledger';
import type { TxnType } from '../../core/types';
import { useStore } from '../../data/store';
import { Empty, Fab, Page, SearchBar, Segmented, T } from '../../ui/kit';
import { TxnRow } from '../../ui/parts';
import { dateLabel, useMoney, useTheme } from '../../ui/theme';

type Filter = 'all' | 'send' | 'in' | 'out';
const IN: TxnType[] = ['receive', 'cash_in'];
const OUT: TxnType[] = ['give', 'expense', 'cash_out'];

export default function Transactions() {
  const t = useTheme();
  const m = useMoney();
  const { db } = useStore();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const sections = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = liveTxns(db)
      .reverse()
      .filter((x) => {
        if (filter === 'send' && x.type !== 'send') return false;
        if (filter === 'in' && !IN.includes(x.type)) return false;
        if (filter === 'out' && !OUT.includes(x.type)) return false;
        if (!s) return true;
        const names = [x.partyId, x.agentId].map((id) => (id ? db.parties[id]?.name || '' : ''));
        return [...names, x.note || '', x.receiver || ''].some((v) => v.toLowerCase().includes(s));
      });
    const byDay = new Map<string, typeof list>();
    for (const x of list) {
      const arr = byDay.get(x.date) || [];
      arr.push(x);
      byDay.set(x.date, arr);
    }
    return [...byDay.entries()].map(([date, data]) => ({
      date,
      data,
      cash: data.reduce((a, x) => a + txnEffects(x).cash, 0),
    }));
  }, [db, q, filter]);

  return (
    <Page title="লেনদেন" scroll={false}>
      <SearchBar value={q} onChange={setQ} placeholder="নাম, নোট বা প্রাপক খুঁজুন" />
      <Segmented
        style={{ marginHorizontal: 16, marginBottom: 8 }}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'সব' },
          { value: 'send', label: 'পাঠানো' },
          { value: 'in', label: 'এসেছে' },
          { value: 'out', label: 'গিয়েছে' },
        ]}
      />
      <SectionList
        sections={sections}
        keyExtractor={(x) => x.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 160 }}
        renderSectionHeader={({ section }) => (
          <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 }}>
            <T size={13} dim={1} weight="600" style={{ flex: 1, textTransform: 'uppercase' }}>
              {dateLabel(section.date, true)}
            </T>
            <T size={13} weight="600" color={section.cash >= 0 ? t.green : t.red}>
              ক্যাশ {m.fmt(section.cash, { sign: true })}
            </T>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View
            style={{
              backgroundColor: t.card,
              marginHorizontal: 16,
              borderTopLeftRadius: index === 0 ? 14 : 0,
              borderTopRightRadius: index === 0 ? 14 : 0,
              borderBottomLeftRadius: index === section.data.length - 1 ? 14 : 0,
              borderBottomRightRadius: index === section.data.length - 1 ? 14 : 0,
              overflow: 'hidden',
            }}
          >
            <TxnRow txn={item} onPress={() => router.push({ pathname: '/txn/[id]', params: { id: item.id } })} />
          </View>
        )}
        ListEmptyComponent={
          <Empty
            icon="file-tray-outline"
            title={q || filter !== 'all' ? 'কিছু পাওয়া যায়নি' : 'এখনো কোনো লেনদেন নেই'}
            text="নিচের + চেপে নতুন হিসাব যোগ করুন"
          />
        }
      />
      <Fab onPress={() => router.push({ pathname: '/txn/new', params: { type: 'send' } })} />
    </Page>
  );
}
