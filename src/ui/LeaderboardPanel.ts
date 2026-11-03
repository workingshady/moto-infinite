// Daily/weekly challenge card on the landing page, the full leaderboard overlay (daily, weekly, all-time per track),
// the end-of-run card for timed drift runs and the leaderboard line on the race results screen.
// Plain DOM like Menu.ts; all clicks go through data-lb attributes on its own roots.
import '../styles/leaderboard.css';
import type { Game } from '../core/Game';
import type { Setup } from './Menu';
import { DEFAULT_GEN, DEFAULT_SETTINGS } from '../../shared/protocol';
import { LB, LB_CIRCUITS, LB_DRIFT, LB_F1, boardIsTime, challengeFor, type Challenge, type LbTop, type VehicleClass } from '../../shared/leaderboard';
import { fetchGhost, fetchTop, localBest } from '../net/leaderboard';
import { LbSession, fmtValue, lastLbRun, type LbRunInfo } from '../systems/LbSession';
import { TRACKS, WEATHER_DEFS } from '../config';
import { F1_TRACKS } from '../world/F1Track';
import { DRIFT_TRACKS } from '../world/DriftTrack';
import { vehicleById } from '../data/vehicles';
import { escapeHtml } from '../utils/math';
import { isUnlocked } from '../core/career';

/** What App needs to start a leaderboard run. */
export interface LbStart { setup: Setup; vehicle: string; challenge: Challenge | null; ghost: { time: number; s: number[] } | null }
export interface LbActions {
  play(start: LbStart): void;
  again(): void;
  quit(): void;
  profile(): { vehicle?: string; f1car?: string };
  /** Watch the run that just ended (instant replay; closing it goes back to riding). */
  replay(): boolean;
}

let actions: LbActions | null = null;
export function configureLeaderboards(a: LbActions) {
  actions = a;
}

const MODE_ICON = { race: '🏁', f1: '🏎', drift: '🌀' } as const;
const TIME_ICON = { day: '☀️ Day', dawn: '🌅 Dawn', sunset: '🌇 Sunset', night: '🌙 Night', cycle: '🔄 Cycle' } as const;

function timeLeft(t: number) {
  const s = Math.max(0, Math.floor((t - Date.now()) / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

// ---------------------------------------------------------------- run setups
function challengeSetup(c: Challenge): Setup {
  return {
    ...DEFAULT_SETTINGS, split: false, mode: c.mode, trackId: c.trackId, laps: c.mode === 'drift' ? 3 : c.laps, seed: c.seed, time: c.time,
    weather: c.weather, weathers: [c.weather], theme: c.theme, gen: { ...DEFAULT_GEN }, ai: 0, session: 'quali', tyre: 'soft', pvp: false,
  };
}

type TrackKind = 'circuit' | 'f1' | 'drift';
const trackKind = (id: string): TrackKind => (LB_F1[id] ? 'f1' : LB_DRIFT[id] ? 'drift' : 'circuit');

function trackSetup(id: string): Setup {
  const k = trackKind(id), base = { ...DEFAULT_SETTINGS, split: false, trackId: id, laps: 3, ai: 0, session: 'quali' as const, pvp: false, gen: { ...DEFAULT_GEN } };
  if (k === 'f1') {
    const t = F1_TRACKS.find((x) => x.id === id)!;
    return { ...base, mode: 'f1', laps: t.laps, time: t.time, weather: t.weather, weathers: undefined, theme: t.theme, tyre: 'soft' };
  }
  if (k === 'drift') {
    const t = DRIFT_TRACKS.find((x) => x.id === id)!;
    return { ...base, mode: 'drift', time: t.time, weather: t.weather, weathers: undefined, theme: t.theme };
  }
  const t = TRACKS.find((x) => x.id === id)!;
  return { ...base, mode: 'race', seed: t.seed, time: t.time, weather: t.weather, weathers: undefined, theme: t.theme };
}

/** Your vehicle if it fits the board's class, otherwise a sensible default of that class. */
function vehicleFor(cls: VehicleClass, preferred?: string) {
  const fits = (id?: string) => {
    if (!id) return false;
    const v = vehicleById(id);
    return v.id === id && (cls === 'f1' ? !!v.f1 : !v.f1 && v.kind === (cls === 'bike' ? 'bike' : 'car'));
  };
  const P = actions?.profile() ?? {};
  if (fits(preferred)) return preferred!;
  if (cls === 'f1') return fits(P.f1car) ? P.f1car! : 'f1_2026';
  return fits(P.vehicle) ? P.vehicle! : cls === 'bike' ? 'street' : 'gt';
}

const ghostOf = (g: { value: number; s: number[] } | null) => (g ? { time: g.value, s: g.s } : null);

async function playChallenge(c: Challenge, withGhost: boolean, btn?: HTMLElement) {
  if (!actions) return;
  let ghost = null;
  if (withGhost) {
    if (btn) { btn.textContent = 'Loading ghost…'; btn.setAttribute('disabled', ''); }
    ghost = ghostOf(await fetchGhost(c.board));
  }
  closeOverlay();
  actions.play({ setup: challengeSetup(c), vehicle: c.vehicle, challenge: c, ghost });
}

async function playTrack(id: string, cls: VehicleClass, withGhost: boolean, btn?: HTMLElement) {
  if (!actions) return;
  let ghost = null, preferred: string | undefined;
  if (withGhost && trackKind(id) !== 'drift') {
    if (btn) { btn.textContent = 'Loading ghost…'; btn.setAttribute('disabled', ''); }
    const g = await fetchGhost(boardOf(id, cls));
    ghost = ghostOf(g);
    preferred = g?.vehicle;
  }
  closeOverlay();
  actions.play({ setup: trackSetup(id), vehicle: vehicleFor(trackKind(id) === 'f1' ? 'f1' : cls, preferred), challenge: null, ghost });
}

const boardOf = (id: string, cls: VehicleClass) => (trackKind(id) === 'drift' ? `drift:${id}` : trackKind(id) === 'f1' ? `track:${id}:f1` : `track:${id}:${cls === 'f1' ? 'car' : cls}`);

// ---------------------------------------------------------------- shared bits
function rowsHtml(top: LbTop | null | 'loading', board: string, max = 10) {
  if (top === 'loading') return '<div class="lb-empty">Loading…</div>';
  const time = boardIsTime(board), mine = localBest(board);
  if (!top) return `<div class="lb-empty">📴 Leaderboard offline.${mine !== null ? ` Your best here: <b>${fmtValue(mine, time)}</b>` : ''}</div>`;
  if (!top.rows.length) return `<div class="lb-empty">No results yet. Be the first!</div>`;
  const row = (r: LbTop['rows'][number]) => `<li class="${r.me ? 'me' : ''}"><i>${['🥇', '🥈', '🥉'][r.rank - 1] ?? r.rank}</i><span class="nm">${escapeHtml(r.name)}${r.ghost ? ' <small title="ghost lap available">👻</small>' : ''}</span><span class="veh">${escapeHtml(vehicleById(r.vehicle).name)}</span><b>${fmtValue(r.value, time)}</b></li>`;
  const you = top.you && top.you.rank > max ? `<li class="gap">⋯</li>${row(top.you)}` : '';
  return `<ol class="lb-rows">${top.rows.slice(0, max).map(row).join('')}${you}</ol><div class="lb-count">${top.total} rider${top.total === 1 ? '' : 's'}</div>`;
}

function challengeLine(c: Challenge) {
  const v = vehicleById(c.vehicle), w = WEATHER_DEFS[c.weather];
  const what = c.mode === 'drift' ? `${LB.driftSeconds / 60}-minute score run` : `best lap of ${c.laps}`;
  return `<div class="lb-ch-title">${MODE_ICON[c.mode]} ${escapeHtml(c.trackName)}</div>
    <div class="lb-tags"><span>🚘 ${escapeHtml(v.name)}${isUnlocked(v.id) ? '' : ' <em title="Everyone rides the same vehicle: yours for this run, it stays locked in the garage">🔑 loaner</em>'}</span><span>${w.icon} ${w.label}</span><span>${TIME_ICON[c.time]}</span><span>⏱ ${what}</span></div>`;
}

function youLine(top: LbTop | null | 'loading', board: string) {
  const time = boardIsTime(board), mine = top && top !== 'loading' && top.you ? top.you : null, local = localBest(board);
  if (mine) return `Your best: <b>${fmtValue(mine.value, time)}</b> · #${mine.rank} of ${(top as LbTop).total}`;
  return local !== null ? `Your best: <b>${fmtValue(local, time)}</b>` : 'No run yet today';
}

// ---------------------------------------------------------------- landing card
/** Today's challenge on the landing page: what, time left, your best, top 10, play buttons. */
export function mountDailyCard(host: HTMLElement) {
  const c = challengeFor('daily');
  let top: LbTop | null | 'loading' = 'loading', open = false;
  const paint = () => {
    const ghost = c.mode !== 'drift' && top && top !== 'loading' && top.rows.some((r) => r.ghost);
    host.innerHTML = `
    <div class="lb-card">
      <div class="lb-card-head"><b>📅 DAILY CHALLENGE</b><span data-lb-left>resets in ${timeLeft(c.endsAt)}</span></div>
      ${challengeLine(c)}
      <div class="lb-you">${youLine(top, c.board)}</div>
      <details class="lb-fold" ${open ? 'open' : ''}><summary>🏆 Top 10 today</summary>${rowsHtml(top, c.board)}</details>
      <div class="lb-btns">
        <button class="btn primary" data-lb="play">▶ Play daily</button>
        ${ghost ? '<button class="btn" data-lb="ghost">👻 Race top ghost</button>' : ''}
        <button class="btn ghost" data-lb="boards">🏆 Boards</button>
      </div>
    </div>`;
    host.querySelector('details')?.addEventListener('toggle', (e) => (open = (e.target as HTMLDetailsElement).open));
  };
  paint();
  host.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-lb]');
    if (!b) return;
    if (b.dataset.lb === 'play') void playChallenge(c, false);
    else if (b.dataset.lb === 'ghost') void playChallenge(c, true, b);
    else if (b.dataset.lb === 'boards') openLeaderboards('daily');
  });
  void fetchTop(c.board, 10).then((t) => { top = t; if (host.isConnected) paint(); });
  const timer = setInterval(() => {
    if (!host.isConnected) return clearInterval(timer);
    const el = host.querySelector('[data-lb-left]');
    if (el) el.textContent = Date.now() >= c.endsAt ? 'new challenge ready: reopen the menu' : `resets in ${timeLeft(c.endsAt)}`;
  }, 1000);
}

// ---------------------------------------------------------------- full overlay
type Tab = 'daily' | 'weekly' | 'track';
const ov = { root: null as HTMLDivElement | null, tab: 'daily' as Tab, track: 'coast', cls: 'bike' as VehicleClass, top: 'loading' as LbTop | null | 'loading', board: '' };

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && ov.root) { e.stopPropagation(); closeOverlay(); }
}

export function openLeaderboards(tab: Tab = 'daily', track?: string) {
  if (!ov.root) {
    ov.root = document.createElement('div');
    ov.root.className = 'lb-overlay';
    ov.root.addEventListener('click', overlayClick);
    document.body.appendChild(ov.root);
    addEventListener('keydown', onKey, true);
  }
  ov.tab = tab;
  if (track) ov.track = track;
  loadBoard();
}

function closeOverlay() {
  ov.root?.remove();
  ov.root = null;
  removeEventListener('keydown', onKey, true);
}

function currentBoard() {
  return ov.tab === 'track' ? boardOf(ov.track, ov.cls) : challengeFor(ov.tab).board;
}

function loadBoard() {
  const board = currentBoard();
  ov.board = board;
  ov.top = 'loading';
  paintOverlay();
  void fetchTop(board, 25).then((t) => {
    if (ov.board !== board) return; // switched tabs meanwhile
    ov.top = t;
    paintOverlay();
  });
}

function paintOverlay() {
  if (!ov.root) return;
  const tabs = ([['daily', '📅 Daily'], ['weekly', '🗓 Weekly'], ['track', '♾ All-time']] as const)
    .map(([k, l]) => `<button class="chip ${ov.tab === k ? 'on' : ''}" data-lb="tab" data-v="${k}">${l}</button>`).join('');
  let body: string;
  const top = ov.top, ghost = top && top !== 'loading' && top.rows.some((r) => r.ghost);
  if (ov.tab === 'track') {
    const k = trackKind(ov.track);
    const chip = (id: string, name: string) => `<button class="chip ${ov.track === id ? 'on' : ''}" data-lb="track" data-v="${id}">${escapeHtml(name)}</button>`;
    body = `
      <div class="lb-pick"><span>🏁 Circuits</span><div class="chips">${Object.entries(LB_CIRCUITS).map(([id, t]) => chip(id, t.name)).join('')}</div></div>
      <div class="lb-pick"><span>🏎 Formula 1</span><div class="chips">${Object.entries(LB_F1).map(([id, t]) => chip(id, t.name)).join('')}</div></div>
      <div class="lb-pick"><span>🌀 Drift</span><div class="chips">${Object.entries(LB_DRIFT).map(([id, n]) => chip(id, n)).join('')}</div></div>
      ${k === 'circuit' ? `<div class="lb-pick"><span>Class</span><div class="chips">${(['bike', 'car'] as const).map((c) => `<button class="chip ${ov.cls === c ? 'on' : ''}" data-lb="cls" data-v="${c}">${c === 'bike' ? '🏍 Bikes' : '🚗 Cars'}</button>`).join('')}</div></div>` : ''}
      <p class="lb-hint">${k === 'drift' ? 'Best 2-minute score run (starts when you enter the venue).' : 'Fastest single lap. Solo races on this track post here automatically.'}</p>
      <div class="lb-you">${youLine(top, ov.board)}</div>
      ${rowsHtml(top, ov.board, 25)}
      <div class="lb-btns">
        <button class="btn primary" data-lb="ride">▶ Ride this track</button>
        ${ghost && k !== 'drift' ? '<button class="btn" data-lb="rideghost">👻 Race top ghost</button>' : ''}
      </div>`;
  } else {
    const c = challengeFor(ov.tab);
    body = `
      <div class="lb-card-head"><b>${ov.tab === 'daily' ? `TODAY · ${c.key}` : `THIS WEEK · ${c.key}`}</b><span>resets in ${timeLeft(c.endsAt)}</span></div>
      ${challengeLine(c)}
      <p class="lb-hint">Same seed for everyone: same track, weather, time and vehicle. ${c.mode === 'drift' ? 'Bank as many drift points as you can in 2 minutes.' : 'Your fastest lap counts; your lap is uploaded as a ghost.'}</p>
      <div class="lb-you">${youLine(top, ov.board)}</div>
      ${rowsHtml(top, ov.board, 25)}
      <div class="lb-btns">
        <button class="btn primary" data-lb="playch">▶ Play ${ov.tab}</button>
        ${ghost && c.mode !== 'drift' ? '<button class="btn" data-lb="ghostch">👻 Race top ghost</button>' : ''}
      </div>`;
  }
  ov.root.innerHTML = `
    <div class="lb-panel" role="dialog" aria-label="Leaderboards">
      <div class="lb-head"><h2>🏆 Leaderboards</h2><button class="lb-x" data-lb="close" aria-label="Close">✕</button></div>
      <div class="chips lb-tabsrow">${tabs}</div>
      ${body}
    </div>`;
}

function overlayClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (t === ov.root) return closeOverlay(); // tap outside the panel
  const b = t.closest<HTMLElement>('[data-lb]');
  if (!b || b.hasAttribute('disabled')) return;
  const v = b.dataset.v ?? '';
  switch (b.dataset.lb) {
    case 'close': return closeOverlay();
    case 'tab': ov.tab = v as Tab; return loadBoard();
    case 'track': ov.track = v; return loadBoard();
    case 'cls': ov.cls = v as VehicleClass; return loadBoard();
    case 'ride': return void playTrack(ov.track, ov.cls, false);
    case 'rideghost': return void playTrack(ov.track, ov.cls, true, b);
    case 'playch': return void playChallenge(challengeFor(ov.tab as 'daily' | 'weekly'), false);
    case 'ghostch': return void playChallenge(challengeFor(ov.tab as 'daily' | 'weekly'), true, b);
  }
}

// ---------------------------------------------------------------- in-game
/** Hook a solo session up to the boards (null when it can't post anywhere). */
export function attachLeaderboards(game: Game, challenge: Challenge | null) {
  return LbSession.create(game, challenge, (info) => showRunCard(game, info));
}

/** End of a timed drift run: score, ranks, top 5, and what to do next. Sits under the menu so pause still works. */
function showRunCard(game: Game, info: LbRunInfo) {
  const root = document.createElement('div');
  root.className = 'lb-overlay lb-run';
  const main = info.boards[0];
  root.innerHTML = `
    <div class="lb-panel">
      <div class="lb-head"><h2>🌀 Score run complete</h2></div>
      <div class="lb-ch-title">${escapeHtml(info.title)}</div>
      <div class="lb-big">${fmtValue(info.value, info.time)}<small>points</small></div>
      ${boardsLine(info)}
      <div data-lb-top>${main ? rowsHtml('loading', main.board, 5) : ''}</div>
      <div class="lb-btns">
        <button class="btn ghost" data-lb="menu">Menu</button>
        <button class="btn" data-lb="replay">🎬 Replay</button>
        <button class="btn" data-lb="keep">Keep drifting</button>
        <button class="btn primary" data-lb="again">↻ Run again</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  game.setMenuPaused(true);
  const close = () => { root.remove(); game.input.reset(); };
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-lb]');
    if (!b) return;
    close();
    if (b.dataset.lb === 'replay') { if (!actions?.replay()) game.setMenuPaused(false); }
    else if (b.dataset.lb === 'keep') game.setMenuPaused(false);
    else if (b.dataset.lb === 'again') actions?.again();
    else actions?.quit();
  });
  if (main) void fetchTop(main.board, 5).then((t) => { const el = root.querySelector('[data-lb-top]'); if (el) el.innerHTML = rowsHtml(t, main.board, 5); });
}

function boardsLine(info: LbRunInfo) {
  if (!info.boards.length) return '';
  return `<div class="lb-tags lb-ranks">${info.boards.map((b) => {
    const r = b.res;
    return `<span class="${r?.ok && r.improved ? 'up' : ''}">${b.label}: ${r?.ok ? `#${r.rank} of ${r.total}${r.improved ? ' ★' : ''}` : r ? escapeHtml(r.error ?? 'not accepted') : 'offline, queued'}</span>`;
  }).join('')}</div>`;
}

/** Race results screen: your best lap of this session and where it ranks. */
export function mountRunResult(host: HTMLElement) {
  const p = lastLbRun();
  if (!p) return;
  host.innerHTML = '<div class="lb-result dim small">Uploading lap…</div>';
  void p.then((info) => {
    if (!host.isConnected || !info) return;
    const main = info.boards[0];
    host.innerHTML = `
      <div class="lb-result">
        <div>🏆 <b>${escapeHtml(info.title)}</b> · best lap <b>${fmtValue(info.value, info.time)}</b></div>
        ${boardsLine(info)}
        ${main ? `<button class="chip" data-lb="open">View leaderboard</button>` : ''}
      </div>`;
    host.querySelector('[data-lb="open"]')?.addEventListener('click', () => {
      const b = main.board;
      if (b.startsWith('daily:')) openLeaderboards('daily');
      else if (b.startsWith('weekly:')) openLeaderboards('weekly');
      else { const [, id, cls] = b.split(':'); if (cls === 'bike' || cls === 'car') ov.cls = cls; openLeaderboards('track', id); }
    });
  });
}

/** Menu hook: fills the leaderboard spots of whatever screen was just drawn. */
export function mountLeaderboardHosts(root: HTMLElement) {
  const daily = root.querySelector<HTMLElement>('#lbDaily'), result = root.querySelector<HTMLElement>('#lbResult');
  if (daily) mountDailyCard(daily);
  if (result) mountRunResult(result);
}
