// Google Identity Services (GIS) in the browser + the Worker's account endpoints (worker/auth.ts).
// The GIS script is loaded only when a sign-in button is about to be shown, and every failure (offline, blocked by
// an extension, unauthorised origin) just leaves a short note instead of the button: playing never depends on it.
import { GOOGLE_CLIENT_ID, type AuthResponse, type MeResponse, type PublicUser } from '../../shared/auth';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const TIMEOUT = 15_000; // sync runs in the background: a slow phone network is fine

interface GsiButtonOptions { type?: string; theme?: string; size?: string; text?: string; shape?: string; logo_alignment?: string; width?: number }
interface GsiId {
  initialize(o: Record<string, unknown>): void;
  renderButton(el: HTMLElement, o: GsiButtonOptions): void;
  prompt(): void;
  cancel(): void;
  disableAutoSelect(): void;
}
type GsiWindow = Window & { google?: { accounts?: { id?: GsiId } } };

let loading: Promise<GsiId | null> | null = null;
let initialised = false;
let onCredential: (credential: string) => void = () => {};

/** Called with each Google credential (ID token) the user hands over by clicking a button or One Tap. */
export function setCredentialHandler(fn: (credential: string) => void) {
  onCredential = fn;
}

/** Loads the GIS script once; resolves null when it can't load (offline, blocked, timeout). */
export function loadGsi(): Promise<GsiId | null> {
  const ready = () => (window as GsiWindow).google?.accounts?.id ?? null;
  if (ready()) return Promise.resolve(init(ready()!));
  loading ??= afterLoad().then(() => new Promise<GsiId | null>((resolve) => {
    const s = document.createElement('script');
    const done = (ok: boolean) => {
      clearTimeout(timer);
      const id = ok ? ready() : null;
      if (!id) { loading = null; s.remove(); } // allow a retry later (e.g. back online)
      resolve(id ? init(id) : null);
    };
    const timer = setTimeout(() => done(false), TIMEOUT);
    s.src = GSI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => done(true);
    s.onerror = () => done(false);
    document.head.appendChild(s);
  }));
  return loading;
}

/** The game's own start-up comes first: Google's script is only requested after the page's load event. */
const afterLoad = () => new Promise<void>((r) => (document.readyState === 'complete' ? r() : addEventListener('load', () => r(), { once: true })));

function init(id: GsiId) {
  if (!initialised) {
    initialised = true;
    id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (r: { credential?: string }) => { if (r.credential) onCredential(r.credential); },
      auto_select: false,
      cancel_on_tap_outside: true,
      itp_support: true,
      use_fedcm_for_prompt: true,
      context: 'signin',
    });
  }
  return id;
}

/** Renders Google's own button into `el` (re-rendering is cheap; Menu rebuilds its screens often). */
export async function renderGoogleButton(el: HTMLElement, width = 240): Promise<boolean> {
  const id = await loadGsi();
  if (!id || !el.isConnected) return false;
  el.textContent = '';
  id.renderButton(el, { type: 'standard', theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'pill', logo_alignment: 'left', width });
  return true;
}

/** One Tap / FedCM prompt (only when the player switched it on in Settings → Account). */
export async function promptOneTap() {
  (await loadGsi())?.prompt();
}

export function gsiSignedOut() {
  (window as GsiWindow).google?.accounts?.id?.disableAutoSelect();
}

// ---------------------------------------------------------------- Worker API
export async function api<T>(path: string, init: RequestInit = {}, timeout = TIMEOUT): Promise<{ status: number; body: T | null }> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(path, { credentials: 'same-origin', ...init, signal: ctl.signal });
    const body = res.headers.get('content-type')?.includes('json') ? ((await res.json()) as T) : null;
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null }; // offline / timeout
  } finally {
    clearTimeout(timer);
  }
}
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function fetchMe(): Promise<{ status: number; user: PublicUser | null }> {
  const r = await api<MeResponse>('/api/me');
  return { status: r.status, user: r.body?.user ?? null };
}
export const signInWithGoogle = (credential: string) => api<AuthResponse>('/api/auth/google', post({ credential }));
/** Local automated tests only (worker answers 404 unless DEV_AUTH=1 and the page is on localhost). */
export const devSignIn = (sub: string, name: string) => api<AuthResponse>('/api/auth/dev', post({ sub, name }));
export const logout = () => api<{ ok: boolean }>('/api/logout', { method: 'POST' });
export const deleteAccount = () => api<{ ok: boolean }>('/api/account', { method: 'DELETE' });
