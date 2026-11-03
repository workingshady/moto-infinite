// Cloud save: keeps the signed-in player's career, settings, touch layout, profile and Time Attack bests in their
// account (worker/Account.ts). localStorage stays the working copy, so playing offline or signed out works as before.
//
//  - Sign-in: fetch the cloud save, merge it with this device's (src/net/saveMerge.ts), apply, upload.
//  - Afterwards every local save (core/syncBus.ts) schedules a debounced upload; leaving the page sends a keepalive
//    upload. Uploads carry the revision they are based on: 409 = another device saved first → refetch, merge, retry.
//  - Offline: changes stay local (moto:sync:dirty) and go up on the next 'online' event or page load.
//  - Each write has an id (wid); the server lists recent ones, so a write whose answer was lost (keepalive, dropped
//    connection) is recognised later instead of being merged twice.
//  - Accounts never mix: local data belongs to the account in moto:sync:owner (or to nobody before the first sign-in,
//    then the first account adopts it). Signing in with a different account parks the previous owner's local copy
//    under moto:acct:<uid> and loads the new account's. Signing out keeps the local copy (you can keep playing).
import type { PublicUser } from '../../shared/auth';
import { sanitizeSave, stableJson, type CareerData, type SaveData, type SaveEnvelope, type SavePutResult, type SectionName, type TaBest } from '../../shared/cloudSave';
import { career, careerXpNeed, replaceCareer, saveCareer } from '../core/career';
import { applyBindings } from '../core/bindings';
import { prefs, savePrefs } from '../core/prefs';
import { settings, saveSettings } from '../core/settings';
import { onLocalChange, quietly, sectionTime, setSectionTime } from '../core/syncBus';
import { saveTouchSettings, touchSettings } from '../ui/TouchLayout';
import { mergeSaved } from '../utils/store';
import { api, deleteAccount, devSignIn, fetchMe, gsiSignedOut, logout, setCredentialHandler, signInWithGoogle } from './auth';
import { mergeSave } from './saveMerge';
import { setAdminAccount } from '../admin/state';

export type SyncState = 'off' | 'syncing' | 'synced' | 'offline' | 'error';
export interface CloudStatus { user: PublicUser | null; state: SyncState; msg: string }

/** Graphics settings that depend on the device (a phone and a desktop want different ones): never synced. */
const DEVICE_SETTINGS = ['renderScale', 'fpsCap', 'showFps'] as const;
const PUSH_DELAY = 15_000;
const KEEPALIVE_MAX = 60_000;

const K = {
  user: 'moto:auth:user', owner: 'moto:sync:owner', base: 'moto:sync:base', rev: 'moto:sync:rev', pending: 'moto:sync:pending',
  dirty: 'moto:sync:dirty', oneTap: 'moto:auth:onetap', stash: (uid: string) => `moto:acct:${uid}`,
};
function get<T>(k: string): T | null {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function set(k: string, v: unknown) {
  try {
    if (v === null || v === undefined) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* not persisted */
  }
}

// ---------------------------------------------------------------- status
const status: CloudStatus = { user: null, state: 'off', msg: '' };
const listeners = new Set<(s: CloudStatus) => void>();
export const cloudStatus = (): Readonly<CloudStatus> => status;
export function onCloudStatus(cb: (s: CloudStatus) => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function setStatus(state: SyncState, msg = '', user: PublicUser | null = status.user) {
  status.state = state;
  status.msg = msg;
  status.user = user;
  listeners.forEach((cb) => cb(status));
}

export const oneTapEnabled = () => get<boolean>(K.oneTap) === true;
export function setOneTap(on: boolean) {
  set(K.oneTap, on || null);
}

// ---------------------------------------------------------------- local snapshot
interface ProfileHooks { get(): Record<string, unknown>; set(data: Record<string, unknown>): void; applied(): void }
let hooks: ProfileHooks = { get: () => ({}), set: () => {}, applied: () => {} };

function readTa(): Record<string, TaBest> {
  const out: Record<string, TaBest> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith('moto:ta:')) continue;
      const v = get<Partial<TaBest>>(k);
      if (v && typeof v.best === 'number') out[k.slice(5)] = { best: v.best, medal: typeof v.medal === 'number' ? v.medal : 0 };
    }
  } catch {
    /* storage blocked */
  }
  return out;
}

/** This device's save, as it would be uploaded. */
export function collectLocal(): SaveData {
  const s = { ...settings } as Record<string, unknown>;
  for (const k of DEVICE_SETTINGS) delete s[k];
  const sec = (name: SectionName, data: object) => ({ at: sectionTime(name), data: JSON.parse(JSON.stringify(data)) as Record<string, unknown> });
  return {
    v: 1,
    career: JSON.parse(JSON.stringify(career)) as CareerData,
    sections: { settings: sec('settings', s), prefs: sec('prefs', prefs), touch: sec('touch', touchSettings), profile: sec('profile', hooks.get()) },
    ta: readTa(),
  };
}

/** Writes a (merged or restored) save into the live game objects and localStorage, without echoing it back up. */
function applyLocal(save: SaveData, replaceTa = false) {
  quietly(() => {
    replaceCareer(save.career);
    saveCareer();
    const sec = save.sections;
    if (sec.settings) {
      const keep = Object.fromEntries(DEVICE_SETTINGS.map((k) => [k, settings[k]]));
      Object.assign(settings, mergeSaved(settings, sec.settings.data), keep);
      applyBindings();
      saveSettings();
    }
    if (sec.prefs) { Object.assign(prefs, mergeSaved(prefs, sec.prefs.data)); savePrefs(); }
    if (sec.touch) { Object.assign(touchSettings, mergeSaved(touchSettings, sec.touch.data)); saveTouchSettings(); }
    if (sec.profile) hooks.set(sec.profile.data);
    for (const [n, s] of Object.entries(sec)) setSectionTime(n as SectionName, s.at);
    if (replaceTa) for (const k of Object.keys(readTa())) set('moto:' + k, null);
    for (const [k, v] of Object.entries(save.ta)) set('moto:' + k, v);
  });
  hooks.applied();
}

// ---------------------------------------------------------------- sync
let changeSeq = 0;
let timer = 0;
let running: Promise<void> | null = null;
const dirty = () => get<boolean>(K.dirty) === true;
const newWid = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20);
};
const offlineMsg = 'Offline · saved on this device, will sync later';

function signedOutLocally(msg = '') {
  set(K.user, null);
  setAdminAccount(null, false);
  clearTimeout(timer);
  setStatus('off', msg, null);
}

async function putSave(rev: number, save: SaveData): Promise<{ status: number; body: SavePutResult | null }> {
  const wid = newWid();
  set(K.pending, { wid, career: save.career });
  const r = await api<SavePutResult>('/api/save', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rev, wid, save }) });
  if (r.status === 200 && r.body?.ok) {
    set(K.base, save.career);
    set(K.rev, r.body.rev);
    set(K.pending, null);
  } else if (r.status !== 0) set(K.pending, null); // the server answered: that write did not happen
  return r;
}

/** Pull, merge, apply, push. Retries on conflicts. */
async function syncNow(): Promise<void> {
  if (!status.user) return;
  setStatus('syncing');
  for (let attempt = 0; attempt < 4; attempt++) {
    const g = await api<SaveEnvelope>('/api/save');
    if (g.status === 401) return signedOutLocally('Session ended: sign in again to sync');
    if (g.status === 0 || !g.body) { set(K.dirty, true); return setStatus('offline', offlineMsg); }
    const env = g.body, pending = get<{ wid: string; career: CareerData }>(K.pending);
    if (pending) {
      if (env.wids.includes(pending.wid)) set(K.base, pending.career); // an earlier write landed after all
      set(K.pending, null);
    }
    const cloud = env.save ? sanitizeSave(env.save) : null;
    const seq = changeSeq, local = collectLocal();
    const merged = mergeSave(local, cloud, get<CareerData>(K.base), careerXpNeed);
    if (stableJson(merged) !== stableJson(local)) applyLocal(merged);
    if (cloud && stableJson(merged) === stableJson(cloud)) {
      set(K.base, merged.career);
      set(K.rev, env.rev);
    } else {
      const p = await putSave(env.rev, merged);
      if (p.status === 409) continue; // someone saved in between: merge again
      if (p.status === 401) return signedOutLocally('Session ended: sign in again to sync');
      if (p.status === 0) { set(K.dirty, true); return setStatus('offline', offlineMsg); }
      if (p.status !== 200) return setStatus('error', p.body?.error ?? `Sync failed (${p.status})`);
    }
    if (changeSeq === seq) set(K.dirty, null);
    return setStatus('synced');
  }
  setStatus('error', 'Sync conflict: will retry');
}

/** Upload the local save on top of the last known cloud revision (a full sync on conflict). */
async function pushNow(): Promise<void> {
  if (!status.user) return;
  const rev = get<number>(K.rev);
  if (rev === null || get(K.pending)) return syncNow(); // unknown cloud state: merge first
  setStatus('syncing');
  const seq = changeSeq;
  const p = await putSave(rev, collectLocal());
  if (p.status === 409) return syncNow();
  if (p.status === 401) return signedOutLocally('Session ended: sign in again to sync');
  if (p.status === 0) return setStatus('offline', offlineMsg);
  if (p.status !== 200) return setStatus('error', p.body?.error ?? `Sync failed (${p.status})`);
  if (changeSeq === seq) set(K.dirty, null);
  setStatus('synced');
}

function run(fn: () => Promise<void>) {
  running = (running ?? Promise.resolve()).then(fn, fn).finally(() => (running = null));
  return running;
}
export const syncCloud = () => run(syncNow);

function schedule() {
  changeSeq++;
  set(K.dirty, true);
  if (!status.user) return;
  clearTimeout(timer);
  timer = window.setTimeout(() => void run(pushNow), PUSH_DELAY);
}

/** Leaving the page: one keepalive upload of whatever has not gone up yet. */
function flushOnExit() {
  if (!status.user || !dirty() || running) return;
  const rev = get<number>(K.rev);
  if (rev === null || get(K.pending)) return;
  const wid = newWid(), save = collectLocal(), body = JSON.stringify({ rev, wid, save });
  if (body.length > KEEPALIVE_MAX) return;
  set(K.pending, { wid, career: save.career }); // the next sync checks whether it landed
  clearTimeout(timer);
  try {
    void fetch('/api/save', { method: 'PUT', headers: { 'content-type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' }).catch(() => {});
  } catch {
    /* page is going away */
  }
}

// ---------------------------------------------------------------- accounts
function stashFor(uid: string) {
  set(K.stash(uid), { save: collectLocal(), base: get(K.base) });
}

/** Local data now belongs to `user`: park another owner's copy and bring back this account's own (if any). */
function takeOwnership(user: PublicUser): boolean {
  const owner = get<string>(K.owner);
  if (owner === user.uid) return false;
  if (owner) {
    stashFor(owner);
    const mine = get<{ save: unknown; base: CareerData | null }>(K.stash(user.uid));
    const restored = mine ? sanitizeSave(mine.save) : null;
    const blank = collectLocal();
    blank.career = { v: 1, level: 1, xp: 0, credits: 0, earned: 0, stats: {}, unlocked: [], achievements: {}, racecraft: {} };
    blank.ta = {};
    for (const s of Object.values(blank.sections)) s.at = 0; // the account's own settings (cloud) win
    applyLocal(restored ?? blank, true);
    set(K.base, restored ? mine!.base : null);
    set(K.stash(user.uid), null);
    set(K.rev, null);
    set(K.pending, null);
  }
  set(K.owner, user.uid);
  return !!owner;
}

/** `user` always comes straight from the server (sign-in or /api/me): only then is the admin flag believed. */
async function signedIn(user: PublicUser) {
  setAdminAccount(user.uid, user.admin === true);
  const switched = takeOwnership(user);
  set(K.user, user);
  setStatus('syncing', switched ? 'Loaded this account’s progress; the previous rider’s stays on this device' : '', user);
  await syncCloud();
}

async function credential(token: string) {
  setStatus('syncing', 'Signing in…');
  const r = await signInWithGoogle(token);
  if (r.status === 200 && r.body?.user) return signedIn(r.body.user);
  setStatus(status.user ? status.state : 'off', r.status === 0 ? 'Offline: sign-in needs a connection' : r.body?.error ?? 'Sign-in failed');
}

/** Local automated tests only (see worker/auth.ts /api/auth/dev). */
export async function devSignInForTests(sub: string, name: string) {
  const r = await devSignIn(sub, name);
  if (r.status === 200 && r.body?.user) await signedIn(r.body.user);
  return r.status;
}

/** Sign out: upload what's pending, end the session; the local copy stays and keeps working signed out. */
export async function signOut() {
  if (status.user && dirty()) await run(pushNow);
  await logout();
  gsiSignedOut();
  set(K.rev, null);
  signedOutLocally('Signed out · your progress stays on this device');
}

/** "Delete my cloud data": wipes the account on the server; this device keeps its local copy as a guest. */
export async function deleteCloudData(): Promise<boolean> {
  const r = await deleteAccount();
  if (r.status !== 200 && r.status !== 401) {
    setStatus(status.state, r.status === 0 ? 'Offline: try again with a connection' : 'Could not delete, try again');
    return false;
  }
  gsiSignedOut();
  for (const k of [K.base, K.rev, K.pending, K.owner]) set(k, null);
  signedOutLocally('Cloud data deleted · the copy on this device was kept');
  return true;
}

/** Starts cloud save. `profile`: how to read / apply the rider profile (owned by App); `applied`: refresh the UI. */
export function initCloudSave(h: ProfileHooks) {
  hooks = h;
  setCredentialHandler((c) => void credential(c));
  onLocalChange(() => schedule());
  addEventListener('online', () => { if (status.user && (dirty() || status.state === 'offline')) void syncCloud(); });
  addEventListener('pagehide', flushOnExit);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushOnExit(); });
  const cached = get<PublicUser>(K.user);
  if (!cached || typeof cached.uid !== 'string') return; // never signed in here: no network call at all
  setStatus('syncing', '', cached);
  void fetchMe().then(({ status: code, user }) => {
    if (code === 0) return setStatus('offline', offlineMsg, cached);
    if (!user) return signedOutLocally('Session ended: sign in again to sync');
    return signedIn(user);
  });
}
