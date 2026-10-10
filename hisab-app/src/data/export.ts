/* CSV export of every transaction, for Excel / Google Sheets. */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { liveTxns, txnEffects } from '../core/ledger';
import { formatMinor, rateToString } from '../core/money';
import type { Db } from '../core/types';

const TYPE: Record<string, string> = {
  send: 'পাঠানো',
  receive: 'পেলাম',
  give: 'দিলাম',
  expense: 'খরচ',
  cash_in: 'ক্যাশ যোগ',
  cash_out: 'উত্তোলন',
  opening: 'আগের জের',
};

const cell = (v: string | number | undefined) => {
  const s = v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const num = (v: number | undefined) => (v === undefined ? '' : formatMinor(v, { decimals: true }).replace(/,/g, ''));

export function toCsv(db: Db): string {
  const L = db.settings.localCurrency;
  const H = db.settings.homeCurrency;
  const head = ['তারিখ', 'ধরন', 'নাম', 'এজেন্ট', `টাকা (${L})`, `দেশে (${H})`, 'রেট', 'চার্জ', 'দিয়েছে', 'বাকি', `ক্যাশ পরিবর্তন (${L})`, 'প্রাপক', 'নোট'];
  const rows = liveTxns(db).map((t) => {
    const e = txnEffects(t);
    const due = t.type === 'send' ? t.amount + (t.fee || 0) - (t.paid || 0) : undefined;
    return [
      t.date,
      TYPE[t.type],
      t.partyId ? db.parties[t.partyId]?.name : '',
      t.agentId ? db.parties[t.agentId]?.name : '',
      num(t.amount),
      num(t.homeAmount),
      t.rateE4 ? rateToString(t.rateE4) : '',
      num(t.fee),
      num(t.paid),
      num(due),
      num(e.cash),
      t.receiver,
      t.note,
    ].map(cell);
  });
  // BOM so Excel opens Bangla correctly
  return '﻿' + [head.map(cell), ...rows].map((r) => r.join(',')).join('\n');
}

export async function shareCsv(db: Db) {
  const f = new File(Paths.cache, `hisab-${new Date().toISOString().slice(0, 10)}.csv`);
  if (f.exists) f.delete();
  f.create();
  f.write(toCsv(db));
  await Sharing.shareAsync(f.uri, { mimeType: 'text/csv', dialogTitle: 'হিসাব এক্সপোর্ট', UTI: 'public.comma-separated-values-text' });
}
