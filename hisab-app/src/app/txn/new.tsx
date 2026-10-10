import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { evalMinor } from '../../core/calc';
import { dayKey, liveParties, shiftDay } from '../../core/ledger';
import { homeToLocal, localToHome, minorToInput, parseRate, rateToString } from '../../core/money';
import type { Party, PartyKind, TxnType } from '../../core/types';
import { useStore } from '../../data/store';
import { AmountField, Avatar, Card, Field, Row, Section, Segmented, T, tap } from '../../ui/kit';
import { KIND_META, TXN_META } from '../../ui/meta';
import { PartyPicker } from '../../ui/parts';
import { Sheet } from '../../ui/sheet';
import { dateLabel, useMoney, useTheme } from '../../ui/theme';

const TYPES: TxnType[] = ['send', 'receive', 'give', 'expense', 'cash_in', 'cash_out', 'opening'];
type PaidMode = 'full' | 'partial' | 'none';

export default function NewTxn() {
  const t = useTheme();
  const m = useMoney();
  const { db, saveTxn } = useStore();
  const params = useLocalSearchParams<{ type?: TxnType; partyId?: string; id?: string }>();
  const editing = params.id ? db.txns[params.id] : undefined;
  const same = db.settings.localCurrency === db.settings.homeCurrency;

  const [type, setType] = useState<TxnType>(editing?.type || params.type || 'send');
  const [date, setDate] = useState(editing?.date || dayKey());
  const [partyId, setPartyId] = useState(editing?.partyId || params.partyId || '');
  const [agentId, setAgentId] = useState(
    editing?.agentId || (editing ? '' : liveParties(db, 'agent').length === 1 ? liveParties(db, 'agent')[0].id : ''),
  );
  const [amount, setAmount] = useState(editing ? minorToInput(Math.abs(editing.amount)) : '');
  const [home, setHome] = useState(editing?.homeAmount !== undefined ? minorToInput(Math.abs(editing.homeAmount)) : '');
  const [rate, setRate] = useState(rateToString(editing?.rateE4 || db.settings.defaultRateE4));
  const [lastEdited, setLastEdited] = useState<'local' | 'home'>('home');
  const [fee, setFee] = useState(editing?.fee ? minorToInput(editing.fee) : '');
  const [paidMode, setPaidMode] = useState<PaidMode>(() => {
    if (!editing || editing.type !== 'send') return 'full';
    const bill = editing.amount + (editing.fee || 0);
    return !editing.paid ? 'none' : editing.paid === bill ? 'full' : 'partial';
  });
  const [paid, setPaid] = useState(editing?.paid ? minorToInput(editing.paid) : '');
  const [receiver, setReceiver] = useState(editing?.receiver || '');
  const [note, setNote] = useState(editing?.note || '');
  const [sign, setSign] = useState<'plus' | 'minus'>(editing && editing.amount < 0 ? 'minus' : 'plus');
  const [picker, setPicker] = useState<null | 'party' | 'agent'>(null);

  const party: Party | undefined = partyId ? db.parties[partyId] : undefined;
  const agent: Party | undefined = agentId ? db.parties[agentId] : undefined;
  const rateE4 = same ? 10000 : parseRate(rate);
  const isAgentParty = party?.kind === 'agent';
  /** Does this form need both currencies? */
  const twoCur = !same && (type === 'send' || ((type === 'give' || type === 'receive') && isAgentParty));

  const setLocalText = (s: string) => {
    setAmount(s);
    setLastEdited('local');
    const v = evalMinor(s);
    if (twoCur) setHome(v !== null && rateE4 ? minorToInput(localToHome(v, rateE4)) : '');
  };
  const setHomeText = (s: string) => {
    setHome(s);
    setLastEdited('home');
    const v = evalMinor(s);
    setAmount(v !== null && rateE4 ? minorToInput(homeToLocal(v, rateE4)) : '');
  };
  const setRateText = (s: string) => {
    setRate(s);
    const r = parseRate(s);
    if (!r) return;
    if (lastEdited === 'home') {
      const v = evalMinor(home);
      if (v !== null) setAmount(minorToInput(homeToLocal(v, r)));
    } else {
      const v = evalMinor(amount);
      if (v !== null) setHome(minorToInput(localToHome(v, r)));
    }
  };

  const local = evalMinor(amount);
  const homeV = twoCur ? evalMinor(home) : local;
  const feeV = type === 'send' ? evalMinor(fee) || 0 : 0;
  const bill = (local || 0) + feeV;
  const paidV = paidMode === 'full' ? bill : paidMode === 'none' ? 0 : evalMinor(paid) || 0;
  const due = bill - paidV;

  const needsParty = type === 'send' || type === 'receive' || type === 'give';
  const problem = useMemo(() => {
    if (needsParty && !party) return type === 'send' ? 'কাস্টমার বাছাই করুন' : 'কার সাথে লেনদেন বাছাই করুন';
    if (twoCur && !rateE4) return 'রেট ঠিক করুন';
    if (type === 'opening' && isAgentParty && !same) {
      if (!homeV) return 'টাকার পরিমাণ লিখুন';
    } else if (!local || local <= 0) return 'টাকার পরিমাণ লিখুন';
    if (type === 'send' && paidMode === 'partial' && evalMinor(paid) === null) return 'কত দিয়েছে লিখুন';
    return '';
  }, [needsParty, party, type, twoCur, rateE4, isAgentParty, same, homeV, local, paidMode, paid]);

  const pickerKinds: PartyKind[] =
    picker === 'agent'
      ? ['agent']
      : type === 'send'
        ? ['customer', 'partner']
        : ['customer', 'partner', 'agent'];

  const save = () => {
    if (problem) {
      Alert.alert('তথ্য অসম্পূর্ণ', problem);
      return;
    }
    const base = {
      id: editing?.id,
      createdAt: editing?.createdAt,
      type,
      date,
      note: note.trim() || undefined,
    };
    const s = sign === 'minus' ? -1 : 1;
    if (type === 'send') {
      saveTxn({
        ...base,
        partyId,
        agentId: agentId || undefined,
        amount: local!,
        homeAmount: homeV ?? undefined,
        rateE4: rateE4 || undefined,
        fee: feeV || undefined,
        paid: paidV || undefined,
        receiver: receiver.trim() || undefined,
      });
    } else if (type === 'receive' || type === 'give') {
      saveTxn({
        ...base,
        partyId,
        amount: local!,
        homeAmount: isAgentParty ? (homeV ?? undefined) : undefined,
        rateE4: isAgentParty && !same ? rateE4 || undefined : undefined,
      });
    } else if (type === 'opening') {
      const agentOpening = isAgentParty && !same;
      const v = agentOpening ? homeV! : local!;
      saveTxn({
        ...base,
        partyId: partyId || undefined,
        amount: s * v,
        homeAmount: isAgentParty ? s * v : undefined,
      });
    } else {
      saveTxn({ ...base, amount: local! });
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.back();
  };

  const meta = TXN_META[type];

  return (
    <Sheet title={editing ? 'হিসাব সম্পাদনা' : meta.label} onSave={save} canSave={!problem}>
      {/* type chips */}
      {!editing ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 16 }}>
          {TYPES.map((ty) => {
            const on = ty === type;
            const c = TXN_META[ty].color(t);
            return (
              <Pressable
                key={ty}
                onPress={() => {
                  tap();
                  setType(ty);
                }}
                style={[styles.chip, { backgroundColor: on ? c : t.card }]}
              >
                <Ionicons name={TXN_META[ty].icon} size={15} color={on ? '#fff' : c} />
                <T size={14} weight="600" color={on ? '#fff' : t.text} style={{ marginLeft: 6 }}>
                  {TXN_META[ty].short}
                </T>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {/* who */}
      {needsParty || type === 'opening' ? (
        <Section>
          <Row
            left={party ? <Avatar name={party.name} size={36} /> : <Ionicons name="person-circle" size={36} color={t.text3} />}
            title={party ? party.name : type === 'send' ? 'কাস্টমার বাছাই করুন' : type === 'opening' ? 'কার জের? (খালি = নিজের ক্যাশ)' : 'কার সাথে?'}
            subtitle={party ? KIND_META[party.kind].label : 'ট্যাপ করুন'}
            onPress={() => setPicker('party')}
            right={
              party && type === 'opening' ? (
                <Pressable onPress={() => setPartyId('')} hitSlop={10}>
                  <Ionicons name="close-circle" size={20} color={t.text3} />
                </Pressable>
              ) : undefined
            }
          />
          {type === 'send' ? (
            <Row
              left={agent ? <Avatar name={agent.name} size={36} /> : <Ionicons name="business" size={30} color={t.text3} />}
              title={agent ? agent.name : 'দেশের এজেন্ট বাছাই করুন'}
              subtitle={agent ? 'দেশে যে টাকা দেবে' : 'ঐচ্ছিক'}
              onPress={() => setPicker('agent')}
            />
          ) : null}
        </Section>
      ) : null}

      {/* amounts */}
      <Section>
        {twoCur ? (
          <Field
            label={`রেট (১ ${m.localCurrency} = ? ${m.homeCurrency})`}
            value={rate}
            onChangeText={setRateText}
            keyboardType="decimal-pad"
          />
        ) : null}
        {twoCur && type === 'send' ? (
          <AmountField label="দেশে পাঠাবে" currency={m.homeCurrency} text={home} onText={setHomeText} big autoFocus={!editing} />
        ) : null}
        {type === 'opening' && isAgentParty && !same ? (
          <AmountField label="আগের জের" currency={m.homeCurrency} text={home} onText={setHomeText} big />
        ) : (
          <AmountField
            label={type === 'send' ? (twoCur ? 'টাকার পরিমাণ (এখানের)' : 'পাঠানোর পরিমাণ') : type === 'opening' ? 'আগের জের' : 'টাকার পরিমাণ'}
            currency={m.localCurrency}
            text={amount}
            onText={setLocalText}
            big={!(twoCur && type === 'send')}
            autoFocus={!editing && !(twoCur && type === 'send')}
          />
        )}
        {twoCur && (type === 'give' || type === 'receive') ? (
          <AmountField
            label={type === 'give' ? 'এজেন্টের খাতায় জমা হবে' : 'এজেন্টের খাতা থেকে কমবে'}
            currency={m.homeCurrency}
            text={home}
            onText={setHomeText}
          />
        ) : null}
        {type === 'send' ? (
          <AmountField label="সার্ভিস চার্জ" currency={m.localCurrency} text={fee} onText={setFee} hint="না থাকলে খালি রাখুন" />
        ) : null}
      </Section>

      {type === 'opening' ? (
        <Section footer={party ? undefined : 'কোনো নাম না দিলে এটা আপনার হাতের আগের ক্যাশ হিসেবে ধরা হবে।'}>
          <View style={{ padding: 12 }}>
            <Segmented
              value={sign}
              onChange={setSign}
              options={
                party
                  ? [
                      { value: 'plus', label: party.kind === 'agent' ? 'এজেন্ট দেবে' : 'সে দেবে (পাবো)' },
                      { value: 'minus', label: party.kind === 'agent' ? 'আমি এজেন্টকে দেব' : 'আমি দেব' },
                    ]
                  : [
                      { value: 'plus', label: 'হাতে ক্যাশ আছে' },
                      { value: 'minus', label: 'ক্যাশ ঘাটতি' },
                    ]
              }
            />
          </View>
        </Section>
      ) : null}

      {/* payment for a send */}
      {type === 'send' ? (
        <>
          <Section title="টাকা কি দিয়েছে?">
            <View style={{ padding: 12 }}>
              <Segmented
                value={paidMode}
                onChange={setPaidMode}
                options={[
                  { value: 'full', label: 'পুরো দিয়েছে' },
                  { value: 'partial', label: 'কিছু দিয়েছে' },
                  { value: 'none', label: 'পরে দেবে' },
                ]}
              />
            </View>
            {paidMode === 'partial' ? (
              <AmountField label="এখন দিয়েছে" currency={m.localCurrency} text={paid} onText={setPaid} />
            ) : null}
          </Section>
          <Card style={{ marginBottom: 22 }}>
            <Line label="টাকা" value={m.local(local || 0)} />
            {feeV ? <Line label="+ সার্ভিস চার্জ" value={m.local(feeV)} /> : null}
            <Line label="মোট বিল" value={m.local(bill)} bold />
            <Line label="দিয়েছে" value={m.local(paidV)} color={t.green} />
            <Line
              label={due >= 0 ? 'বাকি থাকলো' : 'অগ্রিম/বেশি দিয়েছে'}
              value={m.local(Math.abs(due))}
              color={due > 0 ? t.orange : due < 0 ? t.indigo : t.green}
              bold
            />
            {twoCur && homeV ? <Line label="দেশে পাবে" value={m.home(homeV)} color={t.tint} /> : null}
          </Card>
        </>
      ) : null}

      {/* details */}
      <Section>
        {type === 'send' ? (
          <Field label="প্রাপক (দেশে কে পাবে)" placeholder="নাম / মোবাইল / বিকাশ নম্বর" value={receiver} onChangeText={setReceiver} />
        ) : null}
        <Field label="নোট" placeholder="ঐচ্ছিক" value={note} onChangeText={setNote} />
        <View style={styles.dateRow}>
          <T size={13} dim={1} weight="500" style={{ flex: 1 }}>
            তারিখ
          </T>
          <Pressable onPress={() => setDate(shiftDay(date, -1))} hitSlop={10}>
            <Ionicons name="chevron-back-circle" size={28} color={t.tint} />
          </Pressable>
          <Pressable onPress={() => setDate(dayKey())} style={{ marginHorizontal: 10, alignItems: 'center', minWidth: 130 }}>
            <T size={16} weight="600">
              {dateLabel(date)}
            </T>
            {date === dayKey() ? (
              <T size={11} dim={1}>
                আজ
              </T>
            ) : (
              <T size={11} color={t.tint}>
                আজকে করুন
              </T>
            )}
          </Pressable>
          <Pressable onPress={() => setDate(shiftDay(date, 1))} hitSlop={10}>
            <Ionicons name="chevron-forward-circle" size={28} color={t.tint} />
          </Pressable>
        </View>
      </Section>

      {problem ? (
        <T size={13} color={t.orange} center style={{ marginHorizontal: 32 }}>
          {problem}
        </T>
      ) : null}

      <PartyPicker
        visible={picker !== null}
        kinds={pickerKinds}
        title={picker === 'agent' ? 'দেশের এজেন্ট' : type === 'send' ? 'কাস্টমার' : 'কার সাথে লেনদেন'}
        onClose={() => setPicker(null)}
        onPick={(p) => {
          if (picker === 'agent') setAgentId(p.id);
          else setPartyId(p.id);
          setPicker(null);
        }}
      />
    </Sheet>
  );
}

function Line({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
      <T size={15} dim={bold ? undefined : 1} weight={bold ? '700' : '400'} style={{ flex: 1 }}>
        {label}
      </T>
      <T size={bold ? 17 : 15} weight={bold ? '800' : '600'} color={color} style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  dateRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
});
