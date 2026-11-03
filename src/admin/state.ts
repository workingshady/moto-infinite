// Admin "Full Power" mode state. No imports, so career.ts, Player.ts, leaderboard.ts can read it without cycles.
//
// Admin status comes only from a fresh GET /api/me (cloudSave.ts calls setAdminAccount); a cached or edited
// localStorage value never makes anyone admin. The Regular / Full Power choice is remembered per account
// (moto:admin:fp:<uid>). Full Power is for the admin's own play:
//  - every vehicle usable (isUnlocked override; nothing is written into the career),
//  - infinite nitro / N2 tank, god mode (no damage, no wrecks; crash effects optional), 5x in-run XP,
//  - career progress, achievements and leaderboard posts are paused while it is on.
// Online rooms get the unlocks only (godPlay() is false there), so an admin can't god-mode other players.

let account: { uid: string; admin: boolean } | null = null;
const listeners = new Set<() => void>();

const fpKey = (uid: string) => `moto:admin:fp:${uid}`;
const CRASH_KEY = 'moto:admin:crashfx';
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* not persisted */
  }
};
const changed = () => listeners.forEach((cb) => cb());

/** Called with the server's answer about the signed-in account (null = signed out / unknown). */
export function setAdminAccount(uid: string | null, admin: boolean) {
  const next = uid ? { uid, admin } : null;
  if (JSON.stringify(next) === JSON.stringify(account)) return;
  account = next;
  changed();
}

export const isAdmin = () => !!account?.admin;
/** Full Power is on: admin + their saved choice. */
export const fullPower = () => !!account?.admin && read(fpKey(account.uid)) === '1';
export function setFullPower(on: boolean) {
  if (!account?.admin) return;
  write(fpKey(account.uid), on ? '1' : null);
  changed();
}
/** Career XP / credits / achievements and leaderboard posts are paused. */
export const progressPaused = fullPower;
/** God mode, infinite nitro, fast levels: local games only (online gets unlocks only). */
export const godPlay = (game: { net?: unknown }) => fullPower() && !game.net;
/** Keep the crash banner / slow-down in god mode (no damage either way). Default on. */
export const crashFx = () => read(CRASH_KEY) !== '0';
export function setCrashFx(on: boolean) {
  write(CRASH_KEY, on ? null : '0');
  changed();
}

export function onAdminChange(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
