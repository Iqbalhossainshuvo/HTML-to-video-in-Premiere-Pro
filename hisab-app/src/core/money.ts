/*
 * Exact money arithmetic on integer minor units. Conversions that divide
 * go through BigInt and round half away from zero, so 1 paisa is never lost.
 */

export const RATE_SCALE = 10000;

/** round(a × b ÷ c), half away from zero, exact for any safe integers. */
export function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) throw new Error('division by zero');
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  return Number(roundDiv(n, d));
}

/** 10^n as a BigInt (no `**`, which some Babel setups turn into Math.pow). */
export function pow10(n: number): bigint {
  return BigInt('1' + '0'.repeat(n));
}

/** round(n ÷ d) for BigInts, half away from zero. */
export function roundDiv(n: bigint, d: bigint): bigint {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (a * 2n + d) / (d * 2n);
  return neg ? -q : q;
}

/** Local minor units -> home minor units at `rateE4` (home per local × 10,000). */
export function localToHome(localMinor: number, rateE4: number): number {
  return mulDiv(localMinor, rateE4, RATE_SCALE);
}

/** Home minor units -> local minor units at `rateE4`. */
export function homeToLocal(homeMinor: number, rateE4: number): number {
  if (!rateE4) return 0;
  return mulDiv(homeMinor, RATE_SCALE, rateE4);
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Turns Bangla / Arabic-Indic digits into ASCII digits. */
export function normalizeDigits(s: string): string {
  return s.replace(/[০-৯٠-٩۰-۹]/g, (ch) => {
    const c = ch.charCodeAt(0);
    if (c >= 0x09e6 && c <= 0x09ef) return String(c - 0x09e6);
    if (c >= 0x0660 && c <= 0x0669) return String(c - 0x0660);
    return String(c - 0x06f0);
  });
}

/** Parses a plain decimal ("1,250.5") into an integer scaled by 10^places, rounding the rest. */
export function parseDecimal(input: string, places: number): number | null {
  const s = normalizeDigits(input).replace(/[,\s]/g, '');
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) return null;
  const sign = m[1] === '-' ? -1n : 1n;
  const whole = BigInt(m[2] || '0');
  const frac = m[3] || '';
  const scale = pow10(places);
  const fracDen = pow10(frac.length);
  const n = whole * fracDen + BigInt(frac || '0');
  const v = roundDiv(n * scale, fracDen) * sign;
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(v);
}

export function parseRate(input: string): number | null {
  const v = parseDecimal(input, 4);
  return v !== null && v > 0 ? v : null;
}

export function rateToString(rateE4: number): string {
  const whole = Math.floor(rateE4 / RATE_SCALE);
  const frac = String(rateE4 % RATE_SCALE).padStart(4, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/** Groups an integer string the South-Asian way: 12,34,567. */
function groupLakh(int: string): string {
  if (int.length <= 3) return int;
  const last3 = int.slice(-3);
  let rest = int.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return parts.join(',') + ',' + last3;
}

export interface FormatOptions {
  /** Show "+" for positive values. */
  sign?: boolean;
  /** Always print two decimals (default: only when there are paisa). */
  decimals?: boolean;
  bangla?: boolean;
}

/** 123456789 -> "12,34,567.89" */
export function formatMinor(minor: number, opts: FormatOptions = {}): string {
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const int = groupLakh(String(Math.floor(abs / 100)));
  const cents = abs % 100;
  let s = int;
  if (cents !== 0 || opts.decimals) s += '.' + String(cents).padStart(2, '0');
  if (neg) s = '-' + s;
  else if (opts.sign && abs > 0) s = '+' + s;
  if (opts.bangla) s = s.replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
  return s;
}

/** Minor units -> editable text ("1250.5" style, no grouping). */
export function minorToInput(minor: number): string {
  if (!minor) return '';
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const cents = abs % 100;
  let s = String(Math.floor(abs / 100));
  if (cents) s += '.' + String(cents).padStart(2, '0').replace(/0$/, '');
  return neg ? '-' + s : s;
}
