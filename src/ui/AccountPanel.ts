// Account UI: the sign-in strip on the home screen (under the career strip) and Settings → Account.
// Both are `.acct-host` placeholders filled after each Menu render (Menu rebuilds its screens from template strings),
// and repainted when the sync status or the admin state changes. The Google button is Google's own (GIS renderButton).
import { cloudStatus, deleteCloudData, devSignInForTests, oneTapEnabled, onCloudStatus, setOneTap, signOut, syncCloud, type CloudStatus } from '../net/cloudSave';
import { promptOneTap, renderGoogleButton } from '../net/auth';
import { crashFx, fullPower, isAdmin, onAdminChange, setCrashFx, setFullPower } from '../admin/state';
import { giveCredits, setCareerLevel, unlockAllAchievements } from '../admin/tools';
import { escapeHtml } from '../utils/math';
import { toast } from './toast';
import '../styles/account.css';

type Where = 'home' | 'settings';
const PRIVACY = '<a href="/privacy.html" target="_blank" rel="noopener">Privacy</a>';
let oneTapTried = false;
let gsiFailed = false;

const STATE_LABEL: Record<CloudStatus['state'], string> = { off: '', syncing: 'Syncing…', synced: 'Synced ✓', offline: 'Offline', error: 'Sync problem' };

function stateChip(s: CloudStatus) {
  return `<span class="acct-state s-${s.state}" title="${escapeHtml(s.msg)}">${STATE_LABEL[s.state]}</span>`;
}

function avatar(s: CloudStatus) {
  const u = s.user!, letter = escapeHtml([...u.name][0] ?? '?');
  return u.picture ? `<img class="acct-pic" src="${escapeHtml(u.picture)}" alt="" referrerpolicy="no-referrer" width="32" height="32">` : `<span class="acct-pic acct-letter">${letter}</span>`;
}

function powerSwitch() {
  if (!isAdmin()) return '';
  const on = fullPower();
  return `<span class="acct-power" role="group" aria-label="Admin play mode">
    <button class="chip ${on ? '' : 'on'}" data-acct-power="0">🎮 Regular</button><button class="chip ${on ? 'on' : ''} fp" data-acct-power="1">⚡ Full Power</button></span>`;
}

function homeHtml(s: CloudStatus) {
  if (!s.user) {
    return `<div class="acct acct-out"><div class="acct-gsi" data-gsi></div>
      <span class="acct-why">☁ Sign in to keep your career on every device · ${PRIVACY}</span>
      ${devButton()}${s.msg ? `<span class="acct-msg">${escapeHtml(s.msg)}</span>` : ''}</div>`;
  }
  return `<div class="acct acct-in">${avatar(s)}<span class="acct-name"><b>${escapeHtml(s.user.name)}</b>${stateChip(s)}</span>${powerSwitch()}
    <button class="btn ghost small" data-acct-go="settings">Account</button></div>
    ${fullPower() ? '<p class="acct-fp-note">⚡ Full Power: every vehicle, endless nitro, no damage (local games; online = unlocks only). Career, achievements and leaderboards are paused.</p>' : ''}`;
}

function settingsHtml(s: CloudStatus) {
  const tap = oneTapEnabled();
  const intro = `<p class="hint">Signing in with Google keeps your career, garage, settings, touch layout and Time Attack bests in the cloud, so they follow you to every device. Playing without an account works exactly the same (saved on this device only). We store your Google account id, name and picture: never your e-mail or password. ${PRIVACY}.</p>`;
  if (!s.user) {
    return `${intro}<div class="acct acct-out"><div class="acct-gsi" data-gsi></div>${devButton()}</div>
      ${s.msg ? `<p class="acct-msg">${escapeHtml(s.msg)}</p>` : ''}
      <div class="opt"><span>Quick sign-in</span><div class="chips"><button class="chip ${tap ? '' : 'on'}" data-acct-onetap="0">Off</button><button class="chip ${tap ? 'on' : ''}" data-acct-onetap="1">Google One Tap</button></div></div>
      <p class="hint">One Tap shows Google's small sign-in prompt on the home screen.</p>`;
  }
  return `${intro}
    <div class="acct acct-in">${avatar(s)}<span class="acct-name"><b>${escapeHtml(s.user.name)}</b>${stateChip(s)}</span></div>
    ${s.msg ? `<p class="acct-msg">${escapeHtml(s.msg)}</p>` : ''}
    <div class="row-buttons left"><button class="btn small" data-acct-sync>⟳ Sync now</button><button class="btn ghost small" data-acct-signout>Sign out</button><button class="btn ghost small danger" data-acct-delete>🗑 Delete my cloud data</button></div>
    <p class="hint">Sign out keeps a copy on this device. Delete removes your account and cloud save from our server for good (this device keeps its copy).</p>
    ${isAdmin() ? adminHtml() : ''}`;
}

function adminHtml() {
  return `<h3 class="set-h">🛠 Admin</h3>
    <div class="opt"><span>Play mode</span><div class="chips">${powerSwitch()}</div></div>
    <p class="hint">Full Power: every vehicle usable (nothing is bought), endless nitro / N2, no damage or wrecks, 5× in-run XP. Online rooms get the unlocks only. Career progress, achievements and leaderboard posts are paused while it is on.</p>
    <div class="opt"><span>Crash effects</span><div class="chips"><button class="chip ${crashFx() ? 'on' : ''}" data-acct-crash="1">Show</button><button class="chip ${crashFx() ? '' : 'on'}" data-acct-crash="0">Skip</button></div></div>
    <div class="opt"><span>Career (writes)</span><div class="chips"><button class="chip" data-acct-admin="credits">💰 +10,000 credits</button><button class="chip" data-acct-admin="level">⭐ Set level…</button><button class="chip" data-acct-admin="ach">🏆 Unlock all achievements</button></div></div>
    <p class="hint">These change your real saved career (and cloud save); each asks first.</p>`;
}

function devButton() {
  return import.meta.env.DEV ? '<button class="btn ghost small" data-acct-dev title="Local test sign-in (dev server with DEV_AUTH=1 only)">🧪 Dev sign-in</button>' : '';
}

function paint(host: HTMLElement) {
  const where = (host.dataset.acct as Where) ?? 'home', s = cloudStatus();
  host.innerHTML = where === 'settings' ? settingsHtml(s) : homeHtml(s);
  const gsi = host.querySelector<HTMLElement>('[data-gsi]');
  if (gsi) {
    if (!navigator.onLine) gsi.innerHTML = '<span class="acct-msg">📴 Sign-in needs a connection</span>';
    else void renderGoogleButton(gsi, where === 'home' ? 220 : 260).then((ok) => {
      if (!ok && gsi.isConnected) gsi.innerHTML = '<span class="acct-msg">Google sign-in could not load (offline or blocked)</span>';
      gsiFailed = !ok;
    });
    if (where === 'home' && oneTapEnabled() && !oneTapTried && !gsiFailed) {
      oneTapTried = true;
      void promptOneTap();
    }
  }
  if (!host.dataset.wired) {
    host.dataset.wired = '1';
    host.addEventListener('click', (e) => void click(e, host));
  }
}

async function click(e: MouseEvent, host: HTMLElement) {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!b) return;
  const d = b.dataset;
  if (d.acctGo) { e.stopPropagation(); return openSettingsAccount(); }
  if (d.acctPower !== undefined) { setFullPower(d.acctPower === '1'); return; }
  if (d.acctCrash !== undefined) { setCrashFx(d.acctCrash === '1'); return repaintAll(); }
  if (d.acctOnetap !== undefined) { setOneTap(d.acctOnetap === '1'); return paint(host); }
  if (d.acctSync !== undefined) return void syncCloud();
  if (d.acctSignout !== undefined) return void signOut();
  if (import.meta.env.DEV && d.acctDev !== undefined) { // dropped from production builds
    const name = prompt('Dev sign-in: test account id (letters/digits)', 'tester') ?? '';
    if (name) {
      const code = await devSignInForTests(name, 'Dev ' + name);
      if (code !== 200) toast('Dev sign-in needs DEV_AUTH=1 in .dev.vars', true);
    }
    return;
  }
  if (d.acctDelete !== undefined) {
    if (!confirm('Delete your Moto Infinite cloud data? Your account, sessions and cloud save are removed for good. This device keeps its local copy.')) return;
    if (await deleteCloudData()) toast('Cloud data deleted');
    return;
  }
  if (d.acctAdmin === 'credits' && confirm('Write +10,000 credits into your career?')) { giveCredits(10_000); toast('+10,000 credits'); }
  if (d.acctAdmin === 'level') {
    const v = Number(prompt('Set career level (1-999). This writes to your career.', '20'));
    if (v >= 1 && setCareerLevel(v)) toast(`Career level ${Math.floor(v)}`);
  }
  if (d.acctAdmin === 'ach' && confirm('Write every achievement into your career as unlocked (no rewards paid)?')) toast(`${unlockAllAchievements()} achievements unlocked`);
}

/** Settings → Account (the Settings panel owns its tab state; this just clicks its way there). */
function openSettingsAccount() {
  const menu = document.getElementById('menu');
  menu?.querySelector<HTMLElement>('[data-go="settings"]')?.click();
  menu?.querySelector<HTMLElement>('[data-stab="account"]')?.click();
}

function repaintAll() {
  document.querySelectorAll<HTMLElement>('#menu .acct-host').forEach(paint);
  badge();
}

/** "⚡ FULL POWER" badge over menus and the HUD whenever the mode is on. */
let badgeEl: HTMLDivElement | null = null;
function badge() {
  const on = fullPower();
  if (on && !badgeEl) {
    badgeEl = document.createElement('div');
    badgeEl.className = 'fp-badge';
    badgeEl.textContent = '⚡ FULL POWER';
    badgeEl.title = 'Admin Full Power: career and leaderboards paused';
    document.body.appendChild(badgeEl);
  }
  badgeEl?.classList.toggle('on', on);
}

function decorate(root: HTMLElement) {
  const wrap = root.querySelector<HTMLElement>('.card-wrap');
  if (wrap?.classList.contains('scr-home') && !wrap.querySelector('.acct-host')) {
    const host = document.createElement('div');
    host.className = 'acct-host';
    host.dataset.acct = 'home';
    const anchor = wrap.querySelector('.cr-home');
    if (anchor) anchor.insertAdjacentElement('afterend', host);
    else wrap.querySelector('.big-buttons')?.insertAdjacentElement('afterend', host);
  }
  root.querySelectorAll<HTMLElement>('.acct-host').forEach((h) => { if (!h.dataset.wired) paint(h); });
}

/** Starts watching the menu (call once, after the App exists). */
export function installAccountUi(onAdminToggle: () => void) {
  const root = document.getElementById('menu');
  if (!root) return;
  new MutationObserver(() => decorate(root)).observe(root, { childList: true, subtree: true });
  decorate(root);
  onCloudStatus(repaintAll);
  onAdminChange(() => { repaintAll(); onAdminToggle(); });
  badge();
}
