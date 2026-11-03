// Installable app + offline play: registers the service worker built by scripts/vite-pwa.ts, shows an
// "Update available" toast when a new version is waiting, and keeps the browser's install prompt.
import '../styles/pwa.css';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
/** A service worker already controlled the page at load: a later controller change means an update. */
let hadController = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

/** Called whenever install availability or online state changes (menu buttons re-render). */
export function onPwaChange(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

export const isStandalone = () =>
  matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iPhone / iPad Safari: no install prompt, the player adds it from the Share menu. */
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 'prompt' = we can show the browser dialog, 'ios' = show instructions, null = nothing to offer. */
export function installMode(): 'prompt' | 'ios' | null {
  if (isStandalone()) return null;
  if (deferred) return 'prompt';
  return isIos() ? 'ios' : null;
}

export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  changed();
  return outcome === 'accepted';
}

export function toast(html: string, action?: { label: string; run: () => void }, ms = 0) {
  document.querySelector('.pwa-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'pwa-toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${html}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn primary';
    b.textContent = action.label;
    b.onclick = () => { el.remove(); action.run(); };
    el.appendChild(b);
  }
  const close = document.createElement('button');
  close.className = 'btn ghost';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '✕';
  close.onclick = () => el.remove();
  el.appendChild(close);
  document.body.appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}

function updateReady(reg: ServiceWorkerRegistration) {
  const w = reg.waiting;
  if (!w || !navigator.serviceWorker.controller) return; // first install: nothing to replace
  toast('<b>Update available</b> New version of Moto Infinite.', { label: 'Reload', run: () => w.postMessage({ type: 'SKIP_WAITING' }) });
}

async function register() {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  updateReady(reg);
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    sw?.addEventListener('statechange', () => { if (sw.state === 'installed') updateReady(reg); });
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
  // long sessions: look for a new version every 30 min and when the tab comes back
  setInterval(() => void reg.update().catch(() => undefined), 30 * 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update().catch(() => undefined); });
}

export function installPwa() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own "Install app" button in the main menu
    deferred = e as InstallPromptEvent;
    changed();
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    changed();
  });
  addEventListener('online', changed);
  addEventListener('offline', changed);
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  hadController = !!navigator.serviceWorker.controller;
  const go = () => void register().catch((err) => console.warn('Service worker registration failed', err));
  if (document.readyState === 'complete') go();
  else addEventListener('load', go, { once: true });
}
