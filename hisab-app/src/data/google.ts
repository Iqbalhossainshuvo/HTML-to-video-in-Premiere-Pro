/*
 * Google sign-in and the Google Drive copy of the book.
 *
 * The book is stored in the user's own Google Drive, in the hidden
 * "app data" folder (scope drive.appdata): only this app can see it, it does
 * not clutter Drive, and it comes back on any phone after signing in with
 * the same Google account.
 */
import Constants from 'expo-constants';
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
  type User,
} from '@react-native-google-signin/google-signin';
import { sanitizeDb } from '../core/merge';
import type { Db } from '../core/types';
import type { Session } from './storage';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'hisab-khata.json';

let configured = false;
export function configureGoogle() {
  if (configured) return;
  const extra = (Constants.expoConfig?.extra || {}) as Record<string, string | undefined>;
  GoogleSignin.configure({
    scopes: [DRIVE_SCOPE],
    webClientId: extra.googleWebClientId || undefined,
    iosClientId: extra.googleIosClientId || undefined,
  });
  configured = true;
}

export type GoogleUser = NonNullable<Session['user']>;

function toUser(u: User): GoogleUser {
  return { id: u.user.id, name: u.user.name || u.user.email, email: u.user.email, photo: u.user.photo };
}

async function ensureScope(u: User): Promise<User> {
  if (u.scopes?.includes(DRIVE_SCOPE)) return u;
  const added = await GoogleSignin.addScopes({ scopes: [DRIVE_SCOPE] });
  if (!added || !isSuccessResponse(added)) throw new Error('Google Drive-এ রাখার অনুমতি দেওয়া হয়নি');
  return added.data;
}

/** Interactive sign-in. Returns null when the user cancels. */
export async function googleSignIn(): Promise<GoogleUser | null> {
  configureGoogle();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) return null;
    return toUser(await ensureScope(res.data));
  } catch (e) {
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) return null;
      if (e.code === statusCodes.IN_PROGRESS) return null;
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) throw new Error('এই ফোনে Google Play Services নেই');
      if (String(e.code) === '10' || /DEVELOPER_ERROR/.test(String(e.message)))
        throw new Error('Google লগইন সেটআপ সম্পূর্ণ হয়নি (OAuth client / SHA-1)। README দেখুন।');
    }
    throw e;
  }
}

/** Restores the previous sign-in without UI. */
export async function googleSilent(): Promise<GoogleUser | null> {
  configureGoogle();
  try {
    const res = await GoogleSignin.signInSilently();
    return res.type === 'success' ? toUser(res.data) : null;
  } catch {
    return null;
  }
}

export async function googleSignOut() {
  configureGoogle();
  try {
    await GoogleSignin.signOut();
  } catch {
    /* already signed out */
  }
}

async function accessToken(): Promise<string> {
  configureGoogle();
  if (!GoogleSignin.getCurrentUser()) {
    const res = await GoogleSignin.signInSilently();
    if (res.type !== 'success') throw new Error('Google-এ আবার লগইন করুন');
  }
  return (await GoogleSignin.getTokens()).accessToken;
}

async function drive(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await accessToken();
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401 && retry) {
    await GoogleSignin.clearCachedAccessToken(token);
    return drive(url, init, false);
  }
  if (!res.ok) throw new Error(`Google Drive ত্রুটি (${res.status})`);
  return res;
}

export async function findBookFile(): Promise<string | null> {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const res = await drive(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime%20desc`,
  );
  const body = (await res.json()) as { files?: { id: string }[] };
  return body.files?.[0]?.id || null;
}

export async function downloadBook(fileId: string): Promise<Db> {
  const res = await drive(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return sanitizeDb(await res.json());
}

/** Writes the book to Drive, creating the file the first time. Returns the file id. */
export async function uploadBook(db: Db, fileId: string | null): Promise<string> {
  const body = JSON.stringify(db);
  if (fileId) {
    await drive(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return fileId;
  }
  const boundary = 'hisab' + Date.now();
  const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const res = await drive('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  return ((await res.json()) as { id: string }).id;
}
