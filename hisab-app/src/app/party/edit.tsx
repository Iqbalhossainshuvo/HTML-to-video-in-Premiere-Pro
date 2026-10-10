import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { evalMinor } from '../../core/calc';
import { dayKey, partyLedger } from '../../core/ledger';
import type { PartyKind } from '../../core/types';
import { useStore } from '../../data/store';
import { AmountField, Button, Field, Section, Segmented } from '../../ui/kit';
import { KIND_META } from '../../ui/meta';
import { Sheet } from '../../ui/sheet';
import { useMoney, useTheme } from '../../ui/theme';

export default function EditParty() {
  const t = useTheme();
  const m = useMoney();
  const { db, saveParty, deleteParty, saveTxn } = useStore();
  const params = useLocalSearchParams<{ id?: string; kind?: PartyKind }>();
  const old = params.id ? db.parties[params.id] : undefined;
  const [kind, setKind] = useState<PartyKind>(old?.kind || params.kind || 'customer');
  const [name, setName] = useState(old?.name || '');
  const [phone, setPhone] = useState(old?.phone || '');
  const [note, setNote] = useState(old?.note || '');
  const [opening, setOpening] = useState('');
  const [sign, setSign] = useState<'plus' | 'minus'>(kind === 'agent' ? 'minus' : 'plus');
  const hasTxns = old ? partyLedger(db, old.id).length > 0 : false;
  const cur = kind === 'agent' ? m.homeCurrency : m.localCurrency;

  const save = () => {
    if (!name.trim()) return;
    const p = saveParty({ id: old?.id, kind, name, phone: phone.trim() || undefined, note: note.trim() || undefined });
    const v = evalMinor(opening);
    if (!old && v) {
      const s = sign === 'minus' ? -1 : 1;
      saveTxn({
        type: 'opening',
        date: dayKey(),
        partyId: p.id,
        amount: s * v,
        homeAmount: kind === 'agent' ? s * v : undefined,
        note: 'আগের জের',
      });
    }
    router.back();
  };

  const remove = () => {
    if (!old) return;
    if (hasTxns) {
      Alert.alert('মোছা যাবে না', 'এই নামে লেনদেন আছে। আগে লেনদেনগুলো মুছুন।');
      return;
    }
    Alert.alert(`${old.name} মুছবেন?`, undefined, [
      { text: 'বাতিল', style: 'cancel' },
      {
        text: 'মুছে ফেলুন',
        style: 'destructive',
        onPress: () => {
          deleteParty(old.id);
          router.dismissAll();
        },
      },
    ]);
  };

  return (
    <Sheet title={old ? 'সম্পাদনা' : `নতুন ${KIND_META[kind].label}`} onSave={save} canSave={!!name.trim()}>
      {!old || !hasTxns ? (
        <View style={{ marginHorizontal: 16, marginBottom: 18 }}>
          <Segmented
            value={kind}
            onChange={setKind}
            options={(['customer', 'agent', 'partner'] as PartyKind[]).map((k) => ({ value: k, label: KIND_META[k].label }))}
          />
        </View>
      ) : null}
      <Section footer={KIND_META[kind].hint}>
        <Field label="নাম" placeholder="পূর্ণ নাম" value={name} onChangeText={setName} autoFocus={!old} />
        <Field label="মোবাইল" placeholder="ঐচ্ছিক" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field label="নোট / ঠিকানা" placeholder="ঐচ্ছিক" value={note} onChangeText={setNote} />
      </Section>

      {!old ? (
        <Section title="আগের জের" footer="আগে থেকে কোনো বাকি / দেনা থাকলে লিখুন, না থাকলে খালি রাখুন।">
          <AmountField label="পরিমাণ" currency={cur} text={opening} onText={setOpening} />
          <View style={{ padding: 12 }}>
            <Segmented
              value={sign}
              onChange={setSign}
              options={[
                { value: 'plus', label: kind === 'agent' ? 'এজেন্ট আমাকে দেবে' : 'সে আমাকে দেবে' },
                { value: 'minus', label: kind === 'agent' ? 'আমি এজেন্টকে দেব' : 'আমি তাকে দেব' },
              ]}
            />
          </View>
        </Section>
      ) : null}

      {old ? (
        <View style={{ marginHorizontal: 16 }}>
          <Button title="মুছে ফেলুন" icon="trash-outline" kind="tinted" color={t.red} onPress={remove} />
        </View>
      ) : null}
    </Sheet>
  );
}
