/* iOS system colours, light and dark. */
import { useColorScheme } from 'react-native';
import { useStore } from '../data/store';
import { formatMinor } from '../core/money';

export const light = {
  dark: false,
  bg: '#F2F2F7',
  card: '#FFFFFF',
  card2: '#F2F2F7',
  text: '#000000',
  text2: '#3C3C4399',
  text3: '#3C3C434D',
  sep: '#C6C6C8',
  fill: '#7878801F',
  tint: '#007AFF',
  green: '#34C759',
  red: '#FF3B30',
  orange: '#FF9500',
  indigo: '#5856D6',
  teal: '#30B0C7',
  pink: '#FF2D55',
  purple: '#AF52DE',
  hero: ['#0A84FF', '#5E5CE6'] as const,
  tabBar: '#F9F9F9F0',
};

export const dark: typeof light = {
  dark: true,
  bg: '#000000',
  card: '#1C1C1E',
  card2: '#2C2C2E',
  text: '#FFFFFF',
  text2: '#EBEBF599',
  text3: '#EBEBF54D',
  sep: '#38383A',
  fill: '#7878805C',
  tint: '#0A84FF',
  green: '#30D158',
  red: '#FF453A',
  orange: '#FF9F0A',
  indigo: '#5E5CE6',
  teal: '#40C8E0',
  pink: '#FF375F',
  purple: '#BF5AF2',
  hero: ['#0A84FF', '#5E5CE6'] as const,
  tabBar: '#161618F0',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  const system = useColorScheme();
  const { prefs } = useStore();
  const mode = prefs.theme === 'system' ? system : prefs.theme;
  return mode === 'dark' ? dark : light;
}

/** Money formatter that follows the user's display preferences. */
export function useMoney() {
  const { prefs, db } = useStore();
  const { localCurrency, homeCurrency } = db.settings;
  return moneyFormat(prefs.hideAmounts, prefs.banglaDigits, localCurrency, homeCurrency);
}

function moneyFormat(hide: boolean, bangla: boolean, local: string, home: string) {
  const fmt = (minor: number, opts: { sign?: boolean; cur?: string; abs?: boolean } = {}) => {
    if (hide) return '••••';
    const v = opts.abs ? Math.abs(minor) : minor;
    const s = formatMinor(v, { sign: opts.sign, bangla });
    return opts.cur ? `${s} ${opts.cur}` : s;
  };
  return {
    fmt,
    local: (m: number, o: { sign?: boolean; abs?: boolean } = {}) => fmt(m, { ...o, cur: local }),
    home: (m: number, o: { sign?: boolean; abs?: boolean } = {}) => fmt(m, { ...o, cur: home }),
    localCurrency: local,
    homeCurrency: home,
    bangla,
  };
}

const BN_MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const BN_DAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
const BN = '০১২৩৪৫৬৭৮৯';

export const bnNum = (s: string | number) => String(s).replace(/\d/g, (d) => BN[Number(d)]);

/** "১০ অক্টোবর ২০২৬" */
export function dateLabel(key: string, withDay = false): string {
  const [y, m, d] = key.split('-').map(Number);
  const day = BN_DAYS[new Date(y, m - 1, d).getDay()];
  const s = `${bnNum(d)} ${BN_MONTHS[m - 1]} ${bnNum(y)}`;
  return withDay ? `${day}, ${s}` : s;
}

export const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return `${BN_MONTHS[m - 1]} ${bnNum(y)}`;
};

export function timeLabel(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}
