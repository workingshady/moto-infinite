// Small additions to the menu screens rendered by Menu.ts, added after each render so Menu stays untouched:
//  - home:   "Install app" button (browser prompt or iOS instructions) and an offline note
//  - online / join room: clear message that rooms need a connection (single-player keeps working)
//  - pause:  "Report a bug" button
import { installMode, onPwaChange, promptInstall } from '../core/pwa';
import { openBugReport } from './bugReport';

const OFFLINE_MSG = '📴 You are offline. Online rooms need an internet connection. Solo, split screen and the training ride work offline.';

function button(label: string, cls: string, onClick: () => void) {
  const b = document.createElement('button');
  b.className = `btn ${cls}`;
  b.textContent = label;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function iosHelp(anchor: HTMLElement) {
  const old = anchor.parentElement?.querySelector('.pwa-ios-help');
  if (old) { old.remove(); return; }
  const p = document.createElement('p');
  p.className = 'hint pwa-ios-help';
  p.innerHTML = 'On iPhone / iPad: tap <b>Share</b> <span aria-hidden="true">⎙</span> in Safari, then <b>Add to Home Screen</b>. Turn the phone sideways to ride.';
  anchor.insertAdjacentElement('afterend', p);
}

function decorate(root: HTMLElement) {
  const wrap = root.querySelector<HTMLElement>('.card-wrap');
  if (!wrap) return;
  const screen = wrap.className.match(/scr-(\w+)/)?.[1];
  const offline = !navigator.onLine;

  if (screen === 'home') {
    const row = wrap.querySelector<HTMLElement>('.hero-left .row-buttons') ?? wrap.querySelector<HTMLElement>('.row-buttons');
    const mode = installMode();
    if (row && mode && !row.querySelector('.pwa-install')) {
      const b = button('📲 Install app', 'ghost pwa-install', () => {
        if (mode === 'prompt') void promptInstall();
        else iosHelp(row);
      });
      b.title = 'Play full screen from your home screen, also offline';
      row.appendChild(b);
    }
    const online = wrap.querySelector<HTMLElement>('[data-go="online"]');
    if (online) online.classList.toggle('pwa-needs-net', offline);
  }

  if (screen === 'online' || screen === 'joinroom') {
    if (offline && !wrap.querySelector('.pwa-offline')) {
      const p = document.createElement('p');
      p.className = 'pwa-offline';
      p.textContent = OFFLINE_MSG;
      wrap.querySelector('h2')?.insertAdjacentElement('afterend', p);
    }
  }

  if (screen === 'pause') {
    const list = wrap.querySelector<HTMLElement>('.big-buttons');
    if (list && !list.querySelector('.pwa-bug')) list.appendChild(button('🐞 Report a bug', 'ghost pwa-bug', openBugReport));
  }
}

/** Starts watching the menu. Call once after the App (and its #menu) exists. */
export function installMenuExtras() {
  const root = document.getElementById('menu');
  if (!root) return;
  // Menu replaces the whole card on every screen change: one childList observer on the root is enough
  new MutationObserver(() => decorate(root)).observe(root, { childList: true });
  decorate(root);
  onPwaChange(() => {
    root.querySelectorAll('.pwa-install, .pwa-ios-help, .pwa-offline').forEach((el) => el.remove());
    decorate(root);
  });
  // Joining a room while offline would only time out: say why straight away instead.
  addEventListener('click', (e) => {
    if (navigator.onLine) return;
    const b = (e.target as HTMLElement | null)?.closest<HTMLElement>('#menu button[data-go]');
    const go = b?.dataset.go;
    if (go !== 'create' && go !== 'join' && go !== 'joinnow') return;
    e.stopPropagation();
    e.preventDefault();
    const note = root.querySelector<HTMLElement>('.pwa-offline');
    if (note) { note.classList.remove('flash'); void note.offsetWidth; note.classList.add('flash'); }
  }, true);
}
