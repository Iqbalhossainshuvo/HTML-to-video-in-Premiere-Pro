/*
 * The book lives in a JSON file on the phone (works offline, opens instantly)
 * and is mirrored to the user's Google Drive by store.tsx.
 */
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { sanitizeDb } from '../core/merge';
import type { Db } from '../core/types';

const file = (name: string) => new File(Paths.document, name);

// the web preview keeps the book in localStorage
const web = Platform.OS === 'web' ? globalThis.localStorage : undefined;

function readJson<T>(name: string): T | null {
  try {
    if (web) {
      const v = web.getItem(name);
      return v ? (JSON.parse(v) as T) : null;
    }
    const f = file(name);
    if (!f.exists) return null;
    return JSON.parse(f.textSync()) as T;
  } catch {
    return null;
  }
}

function writeJson(name: string, value: unknown) {
  if (web) return web.setItem(name, JSON.stringify(value));
  const tmp = file(name + '.tmp');
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.write(JSON.stringify(value));
  const f = file(name);
  if (f.exists) f.delete();
  tmp.move(f);
}

function remove(name: string) {
  try {
    if (web) return web.removeItem(name);
    const f = file(name);
    if (f.exists) f.delete();
  } catch {
    /* already gone */
  }
}

export const loadDb = (): Db => sanitizeDb(readJson('hisab-db.json'));
export const saveDb = (db: Db) => writeJson('hisab-db.json', db);
export const clearDb = () => remove('hisab-db.json');

export interface Session {
  mode: 'google' | 'guest';
  user?: { id: string; name: string; email: string; photo: string | null };
  lastSync?: number;
  driveFileId?: string;
}

export const loadSession = () => readJson<Session>('hisab-session.json');
export const saveSession = (s: Session | null) =>
  s ? writeJson('hisab-session.json', s) : remove('hisab-session.json');

export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  hideAmounts: boolean;
  banglaDigits: boolean;
}

export const DEFAULT_PREFS: Prefs = { theme: 'system', hideAmounts: false, banglaDigits: false };
export const loadPrefs = (): Prefs => ({ ...DEFAULT_PREFS, ...(readJson<Partial<Prefs>>('hisab-prefs.json') || {}) });
export const savePrefs = (p: Prefs) => writeJson('hisab-prefs.json', p);
