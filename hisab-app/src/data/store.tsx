/*
 * App state: the book, the sign-in session, display preferences and Google
 * sync. Every change is saved to the phone at once and pushed to Google Drive
 * a moment later; on start-up and whenever the app comes back to the front the
 * Drive copy is pulled and merged in.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fingerprint, mergeDb } from '../core/merge';
import { emptyDb, newId, type Db, type Party, type Settings, type Txn } from '../core/types';
import { downloadBook, findBookFile, googleSignIn, googleSignOut, googleSilent, uploadBook } from './google';
import {
  clearDb,
  loadDb,
  loadPrefs,
  loadSession,
  saveDb,
  savePrefs,
  saveSession,
  type Prefs,
  type Session,
} from './storage';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'ok' | 'error';

interface Store {
  db: Db;
  session: Session | null;
  prefs: Prefs;
  sync: { status: SyncStatus; error?: string; lastSync?: number };
  saveParty(p: Partial<Party> & Pick<Party, 'kind' | 'name'>): Party;
  deleteParty(id: string): void;
  saveTxn(t: Omit<Txn, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<Txn, 'id' | 'createdAt'>>): Txn;
  deleteTxn(id: string): void;
  saveSettings(s: Partial<Settings>): void;
  setPrefs(p: Partial<Prefs>): void;
  signInWithGoogle(): Promise<boolean>;
  continueAsGuest(): void;
  /** Pushes everything to Google first; returns false if that failed. */
  syncNow(): Promise<boolean>;
  signOut(): Promise<void>;
  importBook(db: Db): void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<Db>(loadDb);
  const [session, setSession] = useState<Session | null>(loadSession);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [sync, setSync] = useState<Store['sync']>(() => ({
    status: session?.mode === 'google' ? 'idle' : 'off',
    lastSync: session?.lastSync,
  }));

  const dbRef = useRef(db);
  const sessionRef = useRef(session);
  const syncing = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback((next: Db) => {
    dbRef.current = next;
    setDb(next);
    try {
      saveDb(next);
    } catch {
      /* the in-memory copy still syncs to Google */
    }
  }, []);

  const updateSession = useCallback((s: Session | null) => {
    sessionRef.current = s;
    setSession(s);
    saveSession(s);
  }, []);

  const runSync = useCallback(async (): Promise<boolean> => {
    const s = sessionRef.current;
    if (s?.mode !== 'google') return false;
    setSync((v) => ({ ...v, status: 'syncing', error: undefined }));
    try {
      let fileId = s.driveFileId || (await findBookFile());
      let remote: Db | null = null;
      if (fileId) {
        try {
          remote = await downloadBook(fileId);
        } catch {
          // the remembered file may have been removed; look it up again
          fileId = await findBookFile();
          remote = fileId ? await downloadBook(fileId) : null;
        }
      }
      const merged = remote ? mergeDb(remote, dbRef.current) : dbRef.current;
      if (!remote || fingerprint(merged) !== fingerprint(remote)) fileId = await uploadBook(merged, fileId);
      // keep anything typed while we were talking to Google
      const now = mergeDb(merged, dbRef.current);
      if (fingerprint(now) !== fingerprint(dbRef.current)) commit(now);
      const lastSync = Date.now();
      if (sessionRef.current?.mode === 'google')
        updateSession({ ...sessionRef.current, driveFileId: fileId || undefined, lastSync });
      setSync({ status: 'ok', lastSync });
      return true;
    } catch (e) {
      setSync((v) => ({ ...v, status: 'error', error: e instanceof Error ? e.message : String(e) }));
      return false;
    }
  }, [commit, updateSession]);

  const syncNow = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    // never run two syncs at once; queue one more after the running one
    while (syncing.current) await syncing.current;
    syncing.current = runSync().finally(() => {
      syncing.current = null;
    });
    return syncing.current;
  }, [runSync]);

  const scheduleSync = useCallback(() => {
    if (sessionRef.current?.mode !== 'google') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void syncNow(), 2500);
  }, [syncNow]);

  const change = useCallback(
    (fn: (d: Db) => Db) => {
      commit(fn(dbRef.current));
      scheduleSync();
    },
    [commit, scheduleSync],
  );

  // start-up: restore Google, pull; then again each time the app is opened
  useEffect(() => {
    if (sessionRef.current?.mode === 'google') {
      void googleSilent().then(() => syncNow());
    }
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void syncNow();
      if (st === 'background' && timer.current) void syncNow();
    });
    return () => sub.remove();
  }, [syncNow]);

  const store = useMemo<Store>(
    () => ({
      db,
      session,
      prefs,
      sync,
      saveParty(p) {
        const now = Date.now();
        const old = p.id ? dbRef.current.parties[p.id] : undefined;
        const party: Party = {
          ...old,
          ...p,
          id: p.id || newId(),
          name: p.name.trim(),
          createdAt: old?.createdAt || now,
          updatedAt: now,
        } as Party;
        change((d) => ({ ...d, parties: { ...d.parties, [party.id]: party } }));
        return party;
      },
      deleteParty(id) {
        change((d) => {
          const p = d.parties[id];
          if (!p) return d;
          return { ...d, parties: { ...d.parties, [id]: { ...p, deleted: true, updatedAt: Date.now() } } };
        });
      },
      saveTxn(t) {
        const now = Date.now();
        const txn = { ...t, id: t.id || newId(), createdAt: t.createdAt || now, updatedAt: now } as Txn;
        // drop empty optional fields so the stored record stays clean
        for (const k of Object.keys(txn) as (keyof Txn)[]) if (txn[k] === undefined || txn[k] === '') delete txn[k];
        change((d) => ({ ...d, txns: { ...d.txns, [txn.id]: txn } }));
        return txn;
      },
      deleteTxn(id) {
        change((d) => {
          const t = d.txns[id];
          if (!t) return d;
          return { ...d, txns: { ...d.txns, [id]: { ...t, deleted: true, updatedAt: Date.now() } } };
        });
      },
      saveSettings(s) {
        change((d) => ({ ...d, settings: { ...d.settings, ...s, updatedAt: Date.now() } }));
      },
      setPrefs(p) {
        setPrefsState((old) => {
          const next = { ...old, ...p };
          savePrefs(next);
          return next;
        });
      },
      async signInWithGoogle() {
        const user = await googleSignIn();
        if (!user) return false;
        updateSession({ mode: 'google', user });
        setSync({ status: 'idle' });
        await syncNow();
        return true;
      },
      continueAsGuest() {
        updateSession({ mode: 'guest' });
        setSync({ status: 'off' });
      },
      syncNow,
      async signOut() {
        if (timer.current) clearTimeout(timer.current);
        if (sessionRef.current?.mode === 'google') await googleSignOut();
        clearDb();
        commit(emptyDb());
        updateSession(null);
        setSync({ status: 'off' });
      },
      importBook(incoming) {
        change((d) => mergeDb(d, incoming));
      },
    }),
    [db, session, prefs, sync, change, commit, updateSession, syncNow],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}
