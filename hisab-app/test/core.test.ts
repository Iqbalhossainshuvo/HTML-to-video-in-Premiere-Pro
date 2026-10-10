/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalMinor, evaluate, fracToString, isExpression } from '../src/core/calc.ts';
import { formatMinor, homeToLocal, localToHome, minorToInput, parseDecimal, parseRate, rateToString } from '../src/core/money.ts';
import { balances, daySummary, monthRange, partyLedger, rangeSummary, shiftDay, totals } from '../src/core/ledger.ts';
import { fingerprint, mergeDb } from '../src/core/merge.ts';
import { emptyDb, type Db, type Party, type Txn } from '../src/core/types.ts';

test('calculator: exact arithmetic', () => {
  assert.equal(evalMinor('0.1+0.2'), 30);
  assert.equal(evalMinor('1500+250*2'), 200000);
  assert.equal(evalMinor('1500+250×2'), 200000);
  assert.equal(evalMinor('(1500+250)×2'), 350000);
  assert.equal(evalMinor('10÷3'), 333);
  assert.equal(evalMinor('20÷3'), 667);
  assert.equal(evalMinor('10÷3×3'), 1000); // exact fractions, no 9.99
  assert.equal(evalMinor('-5+2'), -300);
  assert.equal(evalMinor('1,250.50'), 125050);
  assert.equal(evalMinor('১২০০+৩০০'), 150000);
  assert.equal(evalMinor('200+10%'), 22000);
  assert.equal(evalMinor('200-10%'), 18000);
  assert.equal(evalMinor('200×10%'), 2000);
  assert.equal(evalMinor('50%'), 50);
  assert.equal(evalMinor('5÷0'), null);
  assert.equal(evalMinor('5+'), null);
  assert.equal(evalMinor('(5'), null);
  assert.equal(evalMinor(''), null);
  assert.equal(fracToString(evaluate('1÷8')), '0.125');
  assert.equal(fracToString(evaluate('2÷3')), '0.66666667');
  assert.equal(fracToString(evaluate('0-7')), '-7');
  assert.ok(isExpression('5+3'));
  assert.ok(!isExpression('-50'));
  assert.ok(!isExpression('1,250'));
});

test('money: parse, convert, format', () => {
  assert.equal(parseDecimal('1,250.505', 2), 125051);
  assert.equal(parseDecimal('.5', 2), 50);
  assert.equal(parseDecimal('abc', 2), null);
  assert.equal(parseRate('32.45'), 324500);
  assert.equal(parseRate('0'), null);
  assert.equal(rateToString(324500), '32.45');
  assert.equal(rateToString(320000), '32');
  // 1000 SAR at 32.45 = 32,450 BDT
  assert.equal(localToHome(100000, 324500), 3245000);
  // 50,000 BDT at 32.45 = 1540.83 SAR (1540.8320…)
  assert.equal(homeToLocal(5000000, 324500), 154083);
  assert.equal(homeToLocal(-5000000, 324500), -154083);
  // half rounds away from zero
  assert.equal(homeToLocal(5, 20000), 3);
  assert.equal(formatMinor(123456789), '12,34,567.89');
  assert.equal(formatMinor(100000), '1,000');
  assert.equal(formatMinor(-5), '-0.05');
  assert.equal(formatMinor(1200, { sign: true }), '+12');
  assert.equal(formatMinor(1234500, { bangla: true }), '১২,৩৪৫');
  assert.equal(minorToInput(125050), '1250.5');
  assert.equal(minorToInput(125005), '1250.05');
});

function party(id: string, kind: Party['kind']): Party {
  return { id, kind, name: id, createdAt: 1, updatedAt: 1 };
}
let n = 0;
function txn(t: Partial<Txn> & Pick<Txn, 'type' | 'amount'>): Txn {
  n++;
  return { id: 't' + n, date: '2026-10-10', createdAt: n, updatedAt: n, ...t } as Txn;
}

function book(): Db {
  const db = emptyDb();
  db.settings.localCurrency = 'SAR';
  db.settings.homeCurrency = 'BDT';
  db.settings.defaultRateE4 = 320000;
  for (const p of [party('karim', 'customer'), party('rahim', 'customer'), party('agent', 'agent'), party('salam', 'partner')])
    db.parties[p.id] = p;
  const list: Txn[] = [
    txn({ type: 'opening', amount: 500000, date: '2026-10-09' }), // 5000 cash yesterday
    txn({ type: 'opening', partyId: 'rahim', amount: 30000, date: '2026-10-09' }), // rahim owed 300
    txn({ type: 'opening', partyId: 'agent', amount: -1000000, homeAmount: -1000000, date: '2026-10-09' }), // owe agent 10,000 BDT
    // Karim sends 32,000 BDT at 32 = 1000 SAR + 10 fee, pays 700 now
    txn({ type: 'send', partyId: 'karim', agentId: 'agent', amount: 100000, homeAmount: 3200000, rateE4: 320000, fee: 1000, paid: 70000 }),
    // Rahim clears his old due
    txn({ type: 'receive', partyId: 'rahim', amount: 30000 }),
    // Karim pays 200 in the afternoon
    txn({ type: 'receive', partyId: 'karim', amount: 20000 }),
    // pay the agent 1000 SAR = 32,000 BDT
    txn({ type: 'give', partyId: 'agent', amount: 100000, homeAmount: 3200000, rateE4: 320000 }),
    // partner Salam gives me 500, then I give him 200
    txn({ type: 'receive', partyId: 'salam', amount: 50000 }),
    txn({ type: 'give', partyId: 'salam', amount: 20000 }),
    txn({ type: 'expense', amount: 1500 }),
    txn({ type: 'cash_out', amount: 10000 }),
    txn({ type: 'receive', partyId: 'salam', amount: 99999, deleted: true }),
  ];
  for (const t of list) db.txns[t.id] = t;
  return db;
}

test('ledger: balances and totals', () => {
  const db = book();
  const b = balances(db);
  assert.equal(b.party.karim, 100000 + 1000 - 70000 - 20000); // 110 SAR due
  assert.equal(b.party.rahim, 0);
  assert.equal(b.party.agent, -1000000 - 3200000 + 3200000); // still owe 10,000 BDT
  assert.equal(b.party.salam, -50000 + 20000); // I owe Salam 300
  // cash: 5000 + 700 + 300 + 200 − 1000 + 500 − 200 − 15 − 100
  assert.equal(b.cash, 500000 + 70000 + 30000 + 20000 - 100000 + 50000 - 20000 - 1500 - 10000);
  const t = totals(db, b);
  assert.equal(t.receivable, 11000);
  assert.equal(t.payable, 30000);
  assert.equal(t.agentPayable, 1000000);
  // net = cash + 110 − 300 − 10,000/32 (=312.50)
  assert.equal(t.net, b.cash + 11000 - 30000 - 31250);
  assert.ok(t.netConverted);
});

test('ledger: day summary', () => {
  const db = book();
  const d = daySummary(db, '2026-10-10');
  assert.equal(d.openingCash, 500000);
  assert.equal(d.cashIn, 70000 + 30000 + 20000 + 50000);
  assert.equal(d.cashOut, 100000 + 20000 + 1500 + 10000);
  assert.equal(d.closingCash, balances(db).cash);
  assert.equal(d.sendCount, 1);
  assert.equal(d.sendLocal, 101000);
  assert.equal(d.sendHome, 3200000);
  assert.equal(d.fees, 1000);
  assert.equal(d.newDue, 31000);
  assert.equal(d.collected, 50000);
  assert.equal(d.agentPaid, 100000);
  assert.equal(d.expenses, 1500);
  assert.equal(d.txns.length, 8);
  const y = daySummary(db, shiftDay('2026-10-10', -1));
  assert.equal(y.from, '2026-10-09');
  assert.equal(y.openingCash, 0);
  assert.equal(y.closingCash, 500000);
});

test('ledger: party statement runs to the balance', () => {
  const db = book();
  const lines = partyLedger(db, 'karim');
  assert.deepEqual(lines.map((l) => l.balance), [31000, 11000]);
  const agent = partyLedger(db, 'agent');
  assert.deepEqual(agent.map((l) => l.balance), [-1000000, -4200000, -1000000]);
});

test('merge: newer record wins, tombstones kept, order independent', () => {
  const a = book();
  const b: Db = JSON.parse(JSON.stringify(a));
  b.txns.t_new = txn({ type: 'cash_in', amount: 5 });
  a.parties.karim = { ...a.parties.karim, name: 'Karim Uddin', updatedAt: 50 };
  b.parties.karim = { ...b.parties.karim, name: 'Old', updatedAt: 40 };
  const firstId = Object.keys(a.txns)[0];
  b.txns[firstId] = { ...b.txns[firstId], deleted: true, updatedAt: 999 };
  const m1 = mergeDb(a, b);
  const m2 = mergeDb(b, a);
  assert.equal(fingerprint(m1), fingerprint(m2));
  assert.equal(m1.parties.karim.name, 'Karim Uddin');
  assert.ok(m1.txns.t_new);
  assert.equal(m1.txns[firstId].deleted, true);
  assert.equal(fingerprint(mergeDb(m1, m1)), fingerprint(m1));
});

test('ledger: month range and summary', () => {
  assert.deepEqual(monthRange('2026-02-14'), ['2026-02-01', '2026-02-28']);
  assert.deepEqual(monthRange('2028-02-03'), ['2028-02-01', '2028-02-29']);
  const db = book();
  const m = rangeSummary(db, ...monthRange('2026-10-10'));
  assert.equal(m.openingCash, 0);
  assert.equal(m.closingCash, balances(db).cash);
  assert.equal(m.txns.length, 11);
  assert.equal(m.txns[0].date, '2026-10-10');
});
