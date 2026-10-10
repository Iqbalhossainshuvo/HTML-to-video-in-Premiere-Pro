import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { evalMinor, evaluate, fracToString, isExpression } from '../../core/calc';
import { homeToLocal, localToHome, minorToInput, parseRate, rateToString } from '../../core/money';
import { useStore } from '../../data/store';
import { AmountField, Card, Field, Page, Segmented, T, tap } from '../../ui/kit';
import { useMoney, useTheme } from '../../ui/theme';

type Mode = 'calc' | 'rate';

export default function Calculator() {
  const [mode, setMode] = useState<Mode>('calc');
  return (
    <Page title="ক্যালকুলেটর" scroll={false}>
      <Segmented
        style={{ marginHorizontal: 16, marginBottom: 8 }}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'calc', label: 'ক্যালকুলেটর' },
          { value: 'rate', label: 'রেট কনভার্টার' },
        ]}
      />
      {mode === 'calc' ? <Calc /> : <Converter />}
    </Page>
  );
}

const KEYS = [
  ['AC', '⌫', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['(', '0', '.', '='],
];
const OPS = ['÷', '×', '−', '+', '='];

function preview(expr: string): string | null {
  if (!expr || !isExpression(expr)) return null;
  try {
    return fracToString(evaluate(expr));
  } catch {
    return null;
  }
}

function group(s: string): string {
  return s.replace(/\d+(?:\.\d+)?/g, (n) => {
    const [i, d] = n.split('.');
    const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return d !== undefined ? `${g}.${d}` : g;
  });
}

function Calc() {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const [expr, setExpr] = useState('');
  const [history, setHistory] = useState<{ expr: string; result: string }[]>([]);
  const [error, setError] = useState('');
  const size = Math.min(84, (width - 32 - 36) / 4);
  const live = preview(expr);

  const press = (k: string) => {
    tap();
    setError('');
    if (k === 'AC') return setExpr('');
    if (k === '⌫') return setExpr((e) => e.slice(0, -1));
    if (k === '(') {
      // one key for both brackets: close if there is an open one waiting
      const open = (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length;
      const last = expr.slice(-1);
      return setExpr(expr + (open > 0 && /[\d)%]/.test(last) ? ')' : '('));
    }
    if (k === '=') {
      if (!expr) return;
      try {
        const r = fracToString(evaluate(expr));
        setHistory((h) => [{ expr, result: r }, ...h].slice(0, 30));
        setExpr(r);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'ভুল হিসাব');
      }
      return;
    }
    if (OPS.includes(k) || k === '%') {
      if (!expr && k !== '−') return;
      // replace a trailing operator instead of stacking two
      if (/[+\−×÷]$/.test(expr) && k !== '%') return setExpr(expr.slice(0, -1) + k);
    }
    setExpr(expr + k);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ justifyContent: 'flex-end', flexGrow: 1, paddingHorizontal: 20 }}>
        {history
          .slice()
          .reverse()
          .map((h, i) => (
            <Pressable key={i} onPress={() => setExpr(h.result)} style={{ alignItems: 'flex-end', paddingVertical: 4 }}>
              <T size={14} dim={1}>
                {group(h.expr)} =
              </T>
              <T size={18} dim={1} weight="600">
                {group(h.result)}
              </T>
            </Pressable>
          ))}
        <View style={{ alignItems: 'flex-end', paddingTop: 10 }}>
          <T size={expr.length > 14 ? 32 : 50} weight="300" numberOfLines={2} style={{ textAlign: 'right' }}>
            {group(expr) || '0'}
          </T>
          <T size={22} color={error ? t.red : t.text2} weight="500" style={{ minHeight: 28 }}>
            {error || (live !== null ? '= ' + group(live) : '')}
          </T>
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 16, paddingBottom: 100, gap: 12 }}>
        {KEYS.map((row, ri) => (
          <View key={ri} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {row.map((k) => {
              const op = OPS.includes(k);
              const fn = ri === 0 && !op;
              const bg = op ? t.orange : fn ? (t.dark ? '#A5A5A5' : '#D4D4D2') : t.dark ? '#333333' : t.card;
              const fg = op ? '#fff' : fn ? '#000' : t.text;
              return (
                <Pressable
                  key={k}
                  onPress={() => press(k)}
                  style={({ pressed }) => [
                    styles.key,
                    { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  {k === '⌫' ? (
                    <Ionicons name="backspace-outline" size={26} color={fg} />
                  ) : (
                    <T size={k === '(' ? 24 : 30} weight={op ? '500' : '400'} color={fg}>
                      {k === '(' ? '( )' : k}
                    </T>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

function Converter() {
  const t = useTheme();
  const m = useMoney();
  const { db } = useStore();
  const [rate, setRate] = useState(rateToString(db.settings.defaultRateE4));
  const [local, setLocal] = useState('');
  const [home, setHome] = useState('');
  const r = parseRate(rate);

  const onLocal = (s: string) => {
    setLocal(s);
    const v = evalMinor(s);
    setHome(v !== null && r ? minorToInput(localToHome(v, r)) : '');
  };
  const onHome = (s: string) => {
    setHome(s);
    const v = evalMinor(s);
    setLocal(v !== null && r ? minorToInput(homeToLocal(v, r)) : '');
  };
  const onRate = (s: string) => {
    setRate(s);
    const nr = parseRate(s);
    const v = evalMinor(local);
    if (nr && v !== null) setHome(minorToInput(localToHome(v, nr)));
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 10, paddingBottom: 120 }}>
      <Card pad={0}>
        <Field
          label={`রেট (১ ${m.localCurrency} = ? ${m.homeCurrency})`}
          value={rate}
          onChangeText={onRate}
          keyboardType="decimal-pad"
        />
        <View style={[styles.sep, { backgroundColor: t.sep }]} />
        <AmountField label={m.localCurrency} currency={m.localCurrency} text={local} onText={onLocal} big />
        <View style={[styles.sep, { backgroundColor: t.sep }]} />
        <AmountField label={m.homeCurrency} currency={m.homeCurrency} text={home} onText={onHome} big />
      </Card>
      <T size={13} dim={1} style={{ marginHorizontal: 32, marginTop: 8 }}>
        যেকোনো ঘরে লিখলে অন্যটি নিজে থেকে হিসাব হবে। পয়সা পর্যন্ত সঠিকভাবে রাউন্ড করা হয়।
      </T>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  key: { alignItems: 'center', justifyContent: 'center' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
});
