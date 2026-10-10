/*
 * A small calculator: + − × ÷ %, brackets and decimals, evaluated with exact
 * fractions (BigInt numerator / denominator). Used by the calculator tab and by
 * every amount box, so "1500+250×2" can be typed straight into a form.
 */
import { normalizeDigits, pow10, roundDiv } from './money.ts';

interface Frac {
  n: bigint;
  d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

function frac(n: bigint, d: bigint = 1n): Frac {
  if (d === 0n) throw new CalcError('শূন্য দিয়ে ভাগ করা যায় না');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

const add = (a: Frac, b: Frac) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Frac, b: Frac) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Frac, b: Frac) => frac(a.n * b.n, a.d * b.d);
const div = (a: Frac, b: Frac) => {
  if (b.n === 0n) throw new CalcError('শূন্য দিয়ে ভাগ করা যায় না');
  return frac(a.n * b.d, a.d * b.n);
};

export class CalcError extends Error {}

type Tok = { t: 'num'; v: Frac } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const s = normalizeDigits(src)
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const raw = s.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1 || raw === '.') throw new CalcError('ভুল সংখ্যা');
      const [w, f = ''] = raw.split('.');
      out.push({ t: 'num', v: frac(BigInt((w || '0') + f), pow10(f.length)) });
      i = j;
    } else if ('+-*/()%'.includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
    } else {
      throw new CalcError('ভুল চিহ্ন: ' + ch);
    }
  }
  return out;
}

/** Recursive descent: expr = term (('+'|'-') term)*, term = unary (('*'|'/') unary)*. */
function parse(tokens: Tok[]): Frac {
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => {
    const t = peek();
    return !!t && t.t === 'op' && t.v === v;
  };

  function expr(): Frac {
    let v = term().f;
    while (isOp('+') || isOp('-')) {
      const op = (tokens[pos++] as { v: string }).v;
      const rhs = term();
      // iOS-style percent: 200 + 10% = 220
      v = op === '+' ? add(v, rhs.pct ? mul(v, rhs.f) : rhs.f) : sub(v, rhs.pct ? mul(v, rhs.f) : rhs.f);
    }
    return v;
  }

  function term(): { f: Frac; pct: boolean } {
    let r = unary();
    let pct = r.pct;
    let v = r.f;
    while (isOp('*') || isOp('/')) {
      const op = (tokens[pos++] as { v: string }).v;
      r = unary();
      v = op === '*' ? mul(v, r.f) : div(v, r.f);
      pct = false;
    }
    return { f: v, pct };
  }

  function unary(): { f: Frac; pct: boolean } {
    if (isOp('-')) {
      pos++;
      const r = unary();
      return { f: frac(-r.f.n, r.f.d), pct: r.pct };
    }
    if (isOp('+')) {
      pos++;
      return unary();
    }
    let v: Frac;
    const t = peek();
    if (!t) throw new CalcError('অসম্পূর্ণ হিসাব');
    if (t.t === 'num') {
      pos++;
      v = t.v;
    } else if (t.v === '(') {
      pos++;
      v = expr();
      if (!isOp(')')) throw new CalcError('বন্ধনী বন্ধ হয়নি');
      pos++;
    } else {
      throw new CalcError('অসম্পূর্ণ হিসাব');
    }
    let pct = false;
    while (isOp('%')) {
      pos++;
      v = div(v, frac(100n));
      pct = true;
    }
    return { f: v, pct };
  }

  const v = expr();
  if (pos !== tokens.length) throw new CalcError('অসম্পূর্ণ হিসাব');
  return v;
}

/** Evaluates an expression into an exact fraction. Throws CalcError. */
export function evaluate(src: string): Frac {
  const tokens = tokenize(src);
  if (!tokens.length) throw new CalcError('খালি');
  return parse(tokens);
}

/** Evaluates and rounds to minor units (2 decimals). null when empty or invalid. */
export function evalMinor(src: string): number | null {
  if (!src.trim()) return null;
  try {
    const f = evaluate(src);
    const v = roundDiv(f.n * 100n, f.d);
    if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(v);
  } catch {
    return null;
  }
}

/** True when the text holds an operator, i.e. it is a sum and not just a number. */
export function isExpression(src: string): boolean {
  return /\d\s*[-+*/×÷x%−]|[()]/.test(normalizeDigits(src).replace(/^\s*-/, ''));
}

/** Formats a fraction for the calculator display (up to `places` decimals, trailing zeros cut). */
export function fracToString(f: Frac, places = 8): string {
  const scaled = roundDiv(f.n * pow10(places), f.d);
  const neg = scaled < 0n;
  const abs = (neg ? -scaled : scaled).toString().padStart(places + 1, '0');
  const int = abs.slice(0, abs.length - places);
  const dec = abs.slice(abs.length - places).replace(/0+$/, '');
  const s = dec ? `${int}.${dec}` : int;
  return neg && s !== '0' ? '-' + s : s;
}
