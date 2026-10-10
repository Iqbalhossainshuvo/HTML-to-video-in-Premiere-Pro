/*
 * All the bookkeeping. Each transaction is turned into its effects on the
 * cash box and on party balances; every total on every screen is a sum of
 * those effects, so the numbers always agree with each other.
 *
 * Sign rule for a party balance: positive = they owe me (পাবো),
 * negative = I owe them (দেবো). Agents are kept in the home currency,
 * everyone else and the cash box in the local currency.
 */
import type { Db, Party, PartyKind, Txn } from './types.ts';
import { homeToLocal } from './money.ts';

export interface Effects {
  /** Change to cash in hand (local). */
  cash: number;
  /** Changes to party balances, each in that party's currency. */
  parties: { id: string; delta: number }[];
  /** Service charge earned (local). */
  fee: number;
  /** Business expense (local). */
  expense: number;
}

export function txnEffects(t: Txn): Effects {
  const e: Effects = { cash: 0, parties: [], fee: 0, expense: 0 };
  const partyAmount = t.homeAmount !== undefined && t.homeAmount !== null ? t.homeAmount : t.amount;
  switch (t.type) {
    case 'send': {
      const fee = t.fee || 0;
      const paid = t.paid || 0;
      e.cash = paid;
      e.fee = fee;
      if (t.partyId) e.parties.push({ id: t.partyId, delta: t.amount + fee - paid });
      if (t.agentId && t.homeAmount) e.parties.push({ id: t.agentId, delta: -t.homeAmount });
      break;
    }
    case 'receive':
      e.cash = t.amount;
      if (t.partyId) e.parties.push({ id: t.partyId, delta: -partyAmount });
      break;
    case 'give':
      e.cash = -t.amount;
      if (t.partyId) e.parties.push({ id: t.partyId, delta: partyAmount });
      break;
    case 'expense':
      e.cash = -t.amount;
      e.expense = t.amount;
      break;
    case 'cash_in':
      e.cash = t.amount;
      break;
    case 'cash_out':
      e.cash = -t.amount;
      break;
    case 'opening':
      if (t.partyId) e.parties.push({ id: t.partyId, delta: partyAmount });
      else e.cash = t.amount;
      break;
  }
  return e;
}

export function liveTxns(db: Db): Txn[] {
  return Object.values(db.txns)
    .filter((t) => !t.deleted)
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
}

export function liveParties(db: Db, kind?: PartyKind): Party[] {
  return Object.values(db.parties)
    .filter((p) => !p.deleted && (!kind || p.kind === kind))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface Balances {
  cash: number;
  party: Record<string, number>;
}

/** Balances after every live transaction dated on or before `uptoDate` (all when omitted). */
export function balances(db: Db, uptoDate?: string, before = false): Balances {
  const out: Balances = { cash: 0, party: {} };
  for (const t of Object.values(db.txns)) {
    if (t.deleted) continue;
    if (uptoDate && (before ? t.date >= uptoDate : t.date > uptoDate)) continue;
    const e = txnEffects(t);
    out.cash += e.cash;
    for (const p of e.parties) out.party[p.id] = (out.party[p.id] || 0) + p.delta;
  }
  return out;
}

export interface Totals {
  cash: number;
  /** What others owe me, local currency (customers + partners). */
  receivable: number;
  /** What I owe, local currency (customers + partners with negative balance). */
  payable: number;
  /** Net with agents, home currency: positive = agents owe me. */
  agentNet: number;
  /** What I owe agents, home currency. */
  agentPayable: number;
  /** What agents owe me, home currency. */
  agentReceivable: number;
  /** cash + receivable − payable − agent debt converted at the default rate (local). */
  net: number;
  /** True when the net needed a currency conversion (so it is approximate). */
  netConverted: boolean;
}

export function totals(db: Db, b: Balances = balances(db)): Totals {
  let receivable = 0;
  let payable = 0;
  let agentPayable = 0;
  let agentReceivable = 0;
  for (const p of Object.values(db.parties)) {
    const v = b.party[p.id] || 0;
    if (!v) continue;
    if (p.kind === 'agent') {
      if (v < 0) agentPayable -= v;
      else agentReceivable += v;
    } else if (v > 0) receivable += v;
    else payable -= v;
  }
  const agentNet = agentReceivable - agentPayable;
  const same = db.settings.localCurrency === db.settings.homeCurrency;
  const agentLocal = same ? agentNet : homeToLocal(agentNet, db.settings.defaultRateE4);
  return {
    cash: b.cash,
    receivable,
    payable,
    agentNet,
    agentPayable,
    agentReceivable,
    net: b.cash + receivable - payable + agentLocal,
    netConverted: !same && agentNet !== 0,
  };
}

export interface DaySummary {
  from: string;
  to: string;
  /** Cash at the start of the period (আগের জের). */
  openingCash: number;
  cashIn: number;
  cashOut: number;
  closingCash: number;
  sendCount: number;
  /** Customers' bill for the day: amount + fee (local). */
  sendLocal: number;
  /** Money delivered at home (home currency). */
  sendHome: number;
  fees: number;
  expenses: number;
  /** Paid at once on today's sends. */
  paidNow: number;
  /** Unpaid part of today's sends (new dues). */
  newDue: number;
  /** Dues collected from customers today. */
  collected: number;
  /** Paid to agents today (local cash out). */
  agentPaid: number;
  txns: Txn[];
}

export function daySummary(db: Db, date: string): DaySummary {
  return rangeSummary(db, date, date);
}

/** Totals for the days from..to (inclusive). */
export function rangeSummary(db: Db, from: string, to: string): DaySummary {
  const opening = balances(db, from, true).cash;
  const s: DaySummary = {
    from,
    to,
    openingCash: opening,
    cashIn: 0,
    cashOut: 0,
    closingCash: opening,
    sendCount: 0,
    sendLocal: 0,
    sendHome: 0,
    fees: 0,
    expenses: 0,
    paidNow: 0,
    newDue: 0,
    collected: 0,
    agentPaid: 0,
    txns: [],
  };
  for (const t of Object.values(db.txns)) {
    if (t.deleted || t.date < from || t.date > to) continue;
    s.txns.push(t);
    const e = txnEffects(t);
    if (e.cash > 0) s.cashIn += e.cash;
    else s.cashOut -= e.cash;
    s.fees += e.fee;
    s.expenses += e.expense;
    const kind = t.partyId ? db.parties[t.partyId]?.kind : undefined;
    if (t.type === 'send') {
      s.sendCount++;
      s.sendLocal += t.amount + (t.fee || 0);
      s.sendHome += t.homeAmount || 0;
      s.paidNow += t.paid || 0;
      s.newDue += t.amount + (t.fee || 0) - (t.paid || 0);
    } else if (t.type === 'receive' && kind === 'customer') {
      s.collected += t.amount;
    } else if (t.type === 'give' && kind === 'agent') {
      s.agentPaid += t.amount;
    }
  }
  s.closingCash = opening + s.cashIn - s.cashOut;
  s.txns.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  return s;
}

export interface LedgerLine {
  txn: Txn;
  /** Change to this party's balance. */
  delta: number;
  /** Balance after this line. */
  balance: number;
}

/** A party's statement, oldest first, with a running balance. */
export function partyLedger(db: Db, partyId: string): LedgerLine[] {
  let bal = 0;
  const out: LedgerLine[] = [];
  for (const t of liveTxns(db)) {
    const delta = txnEffects(t)
      .parties.filter((p) => p.id === partyId)
      .reduce((a, p) => a + p.delta, 0);
    if (!delta && t.partyId !== partyId && t.agentId !== partyId) continue;
    bal += delta;
    out.push({ txn: t, delta, balance: bal });
  }
  return out;
}

/** Local calendar day for a Date, YYYY-MM-DD. */
export function dayKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + days));
}

/** First and last day of the month that contains `key`. */
export function monthRange(key: string): [string, string] {
  const [y, m] = key.split('-').map(Number);
  return [dayKey(new Date(y, m - 1, 1)), dayKey(new Date(y, m, 0))];
}
