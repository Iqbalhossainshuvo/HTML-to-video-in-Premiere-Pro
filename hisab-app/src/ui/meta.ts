/* Labels, icons and colours for transaction types and party kinds. */
import type { Ionicons } from '@expo/vector-icons';
import type { PartyKind, TxnType } from '../core/types';
import type { Theme } from './theme';

type Icon = keyof typeof Ionicons.glyphMap;

export const TXN_META: Record<TxnType, { label: string; short: string; icon: Icon; color: (t: Theme) => string }> = {
  send: { label: 'টাকা পাঠানো', short: 'পাঠানো', icon: 'paper-plane', color: (t) => t.tint },
  receive: { label: 'টাকা পেলাম / জমা', short: 'পেলাম', icon: 'arrow-down', color: (t) => t.green },
  give: { label: 'টাকা দিলাম', short: 'দিলাম', icon: 'arrow-up', color: (t) => t.orange },
  expense: { label: 'খরচ', short: 'খরচ', icon: 'receipt', color: (t) => t.red },
  cash_in: { label: 'ক্যাশ যোগ', short: 'ক্যাশ যোগ', icon: 'add-circle', color: (t) => t.teal },
  cash_out: { label: 'ক্যাশ উত্তোলন', short: 'উত্তোলন', icon: 'remove-circle', color: (t) => t.purple },
  opening: { label: 'আগের জের', short: 'আগের জের', icon: 'flag', color: (t) => t.indigo },
};

export const KIND_META: Record<PartyKind, { label: string; plural: string; icon: Icon; hint: string }> = {
  customer: { label: 'কাস্টমার', plural: 'কাস্টমার', icon: 'person', hint: 'যারা টাকা পাঠাতে দেয়' },
  agent: { label: 'দেশের এজেন্ট', plural: 'দেশের এজেন্ট', icon: 'business', hint: 'দেশে যার কাছে টাকা পাঠান' },
  partner: { label: 'পার্টনার', plural: 'পার্টনার', icon: 'people', hint: 'এখানে যার সাথে টাকা আসা-যাওয়া' },
};

/** Words for a balance: positive = they owe me. */
export function balanceWord(v: number, kind?: PartyKind): string {
  if (v === 0) return 'হিসাব পরিষ্কার';
  if (kind === 'agent') return v < 0 ? 'আমি দেব' : 'আমি পাব';
  return v > 0 ? 'পাবো (বাকি)' : 'দেবো';
}

const AVATAR = ['#FF9500', '#34C759', '#007AFF', '#5856D6', '#FF2D55', '#AF52DE', '#30B0C7', '#FF3B30', '#A2845E'];

export function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
