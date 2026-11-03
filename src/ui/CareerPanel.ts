// Career screen (level, credits, lifetime stats, achievement grid) and the small career bits other screens embed:
// home strip, end-of-session summary, garage lock badges and buy box. Templates only; Menu routes the clicks
// (data-go="career", data-buy="<vehicle id>").
import '../styles/career.css';
import { career, careerXpNeed, isUnlocked, lockState, ownedCount, sessionEarnings } from '../core/career';
import { ACHIEVEMENTS, ACHIEVEMENT_CATS } from '../data/achievements';
import { VEHICLES, vehicleById } from '../data/vehicles';
import { escapeHtml } from '../utils/math';

const n = (v: number) => Math.floor(v).toLocaleString();
const cr = (v: number) => `${n(v)} cr`;
const km = (m: number) => (m >= 10000 ? `${Math.round(m / 1000).toLocaleString()} km` : `${(m / 1000).toFixed(1)} km`);
function dur(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
const date = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function levelBlock(compact = false) {
  const need = careerXpNeed(career.level), pct = Math.min(100, Math.round((career.xp / need) * 100));
  return `<div class="cr-level${compact ? ' compact' : ''}">
    <div class="cr-badge"><small>LEVEL</small><b>${career.level}</b></div>
    <div class="cr-prog"><div class="cr-bar"><i style="width:${pct}%"></i></div><span>${n(career.xp)} / ${n(need)} XP to level ${career.level + 1}</span></div>
    <div class="cr-credits"><small>CREDITS</small><b>💰 ${n(career.credits)}</b></div>
  </div>`;
}

/** The cheapest vehicle still locked, as a goal hint. */
function nextUnlock() {
  const left = VEHICLES.filter((v) => v.unlock && !isUnlocked(v.id)).sort((a, b) => a.unlock!.level - b.unlock!.level || a.unlock!.price - b.unlock!.price);
  const v = left[0];
  if (!v) return 'Every vehicle in the garage is yours.';
  const st = lockState(v.id);
  return st === 'buy' ? `<b>${escapeHtml(v.name)}</b> is ready to buy in the garage (${cr(v.unlock!.price)}).`
    : `Next unlock: <b>${escapeHtml(v.name)}</b> · level ${v.unlock!.level} · ${cr(v.unlock!.price)}`;
}

/** Full Career screen. */
export function careerPanelHtml() {
  const s = career.stats, got = ACHIEVEMENTS.filter((a) => career.achievements[a.id]).length;
  const stat = (icon: string, label: string, val: string) => `<div class="cr-stat"><span>${icon} ${label}</span><b>${val}</b></div>`;
  const stats = [
    stat('🛣', 'Distance', km(s.distance)), stat('💨', 'Top speed', `${Math.round(s.topSpeed)} km/h`), stat('⏱', 'Play time', dur(s.playTime)),
    stat('🎮', 'Sessions', n(s.sessions)), stat('🚦', 'Races started', n(s.racesStarted)), stat('🏆', 'Races won', n(s.racesWon)),
    stat('🥉', 'Podiums', n(s.podiums)), stat('🏎', 'F1 wins', n(s.f1Won)), stat('🌀', 'Best drift', n(s.bestDrift)),
    stat('🏍', 'Longest wheelie', `${s.longestWheelie.toFixed(1)} s`), stat('🤸', 'Flips', n(s.flips)), stat('🔄', 'Spins', n(s.spins)),
    stat('🦅', 'Best air', `${s.bestAir.toFixed(1)} s`), stat('🛸', 'Drones destroyed', n(s.drones)), stat('💎', 'Gems', n(s.gems)),
    stat('⬆', 'Best run level', n(s.bestRunLevel)), stat('💰', 'Credits earned', n(career.earned)), stat('🔑', 'Garage', `${ownedCount()} / ${VEHICLES.length}`),
  ].join('');
  const cats = ACHIEVEMENT_CATS.map((c) => {
    const list = ACHIEVEMENTS.filter((a) => a.cat === c);
    if (!list.length) return '';
    return `<div class="cr-cat"><div class="label">${c.toUpperCase()}</div><div class="cr-ach-grid">${list.map((a) => {
      const t = career.achievements[a.id], p = t ? 1 : a.prog?.(s, career) ?? 0;
      return `<div class="cr-ach ${t ? 'got' : ''}" title="${escapeHtml(a.desc)}">
        <span class="cr-ach-ic">${t ? a.icon : '🔒'}</span>
        <span class="cr-ach-tx"><b>${escapeHtml(a.name)}</b><em>${escapeHtml(a.desc)}</em>
        ${t ? `<small>✓ ${date(t)}</small>` : `<span class="cr-mini"><i style="width:${Math.round(p * 100)}%"></i></span><small>+${a.credits} cr${a.xp ? ` · +${a.xp} XP` : ''}</small>`}</span>
      </div>`;
    }).join('')}</div></div>`;
  }).join('');
  return `
    <div class="career">
      <h2>🏆 Career</h2>
      ${levelBlock()}
      <p class="hint">${nextUnlock()} Earn credits and career XP from gems, distance, drifts, wheelies, drones, race podiums and achievements. In-run levels and upgrades still reset every ride.</p>
      ${sessionSummaryHtml('Last ride')}
      <div class="cr-cols">
        <section><h3>📊 Lifetime stats</h3><div class="cr-stats">${stats}</div></section>
        <section><h3>🎖 Achievements <span class="dim small">${got} / ${ACHIEVEMENTS.length}</span></h3><div class="cr-achs">${cats}</div></section>
      </div>
      <div class="row-buttons"><button class="btn ghost" data-go="home">← Back</button><button class="btn" data-go="garage">🏁 Garage</button></div>
    </div>`;
}

/** Strip under the home screen buttons: level, credits and a way into the Career screen. */
export function careerHomeHtml() {
  const need = careerXpNeed(career.level), pct = Math.min(100, Math.round((career.xp / need) * 100));
  return `<button class="cr-home" data-go="career">
    <span class="cr-badge sm"><b>${career.level}</b></span>
    <span class="cr-home-mid"><b>🏆 Career</b><span class="cr-bar"><i style="width:${pct}%"></i></span></span>
    <span class="cr-home-cr">💰 ${n(career.credits)}</span>
  </button>${sessionSummaryHtml('Last ride')}`;
}

/** What the current / last session earned (credits, career XP, levels, achievements). */
export function sessionSummaryHtml(title = 'This ride') {
  const e = sessionEarnings;
  if (!e || (e.credits < 1 && e.xp < 1 && !e.achievements.length)) return '';
  const names = e.achievements.map((id) => ACHIEVEMENTS.find((a) => a.id === id)).filter(Boolean).map((a) => `${a!.icon} ${escapeHtml(a!.name)}`);
  return `<div class="cr-session"><span class="label">${escapeHtml(title.toUpperCase())}</span>
    <b>+${n(e.credits)} cr</b><b>+${n(e.xp)} career XP</b>${e.levels ? `<b class="up">⭐ +${e.levels} level${e.levels > 1 ? 's' : ''}</b>` : ''}
    ${names.length ? `<span class="cr-session-ach">${names.join(' · ')}</span>` : ''}</div>`;
}

/** Badge on a garage card for a locked vehicle. */
export function vehicleLockHtml(id: string) {
  const u = vehicleById(id).unlock, st = lockState(id);
  if (st === 'owned' || !u) return '';
  return `<div class="veh-lock ${st}">🔒 ${st === 'level' ? `Level ${u.level} · ` : ''}${cr(u.price)}</div>`;
}

/** Garage detail box for a locked vehicle: requirement + buy button. */
export function garageLockBox(id: string, canBuy: boolean) {
  const u = vehicleById(id).unlock, st = lockState(id);
  if (st === 'owned' || !u) return '';
  const why = st === 'level' ? `Reach career level ${u.level} (you are ${career.level})` : st === 'credits' ? `Need ${cr(u.price - Math.floor(career.credits))} more` : 'Ready to unlock';
  return `<div class="garage-lock">
    <div><b>🔒 Locked</b><span>Level ${u.level} · ${cr(u.price)} · you have ${cr(career.credits)}</span><em>${why}</em></div>
    ${canBuy ? `<button class="btn primary" data-buy="${id}" ${st === 'buy' ? '' : 'disabled'}>Unlock · ${cr(u.price)}</button>` : ''}
  </div>`;
}
