/*
 * Merging two copies of the book (this phone and Google Drive). Every record
 * carries updatedAt; the newer copy of each record wins and deletions are
 * kept as tombstones, so nothing entered on either side is lost.
 */
import { DEFAULT_SETTINGS, emptyDb, type Db } from './types.ts';

type Rec = { updatedAt: number };

function pick<T extends Rec>(a: T | undefined, b: T | undefined): T {
  if (!a) return b as T;
  if (!b) return a;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  // same time: pick deterministically so both sides agree
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

function mergeMap<T extends Rec>(a: Record<string, T>, b: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) out[id] = pick(a[id], b[id]);
  return out;
}

export function mergeDb(a: Db, b: Db): Db {
  return {
    version: 1,
    parties: mergeMap(a.parties, b.parties),
    txns: mergeMap(a.txns, b.txns),
    settings: pick(a.settings, b.settings),
  };
}

/** Accepts whatever was stored and returns a well-formed Db. */
export function sanitizeDb(raw: unknown): Db {
  const db = emptyDb();
  if (!raw || typeof raw !== 'object') return db;
  const r = raw as Partial<Db>;
  if (r.parties && typeof r.parties === 'object') db.parties = r.parties;
  if (r.txns && typeof r.txns === 'object') db.txns = r.txns;
  if (r.settings && typeof r.settings === 'object') db.settings = { ...DEFAULT_SETTINGS, ...r.settings };
  return db;
}

/** Order-independent JSON of a Db, for "did anything change?" checks. */
export function fingerprint(db: Db): string {
  return JSON.stringify(db, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v,
  );
}
