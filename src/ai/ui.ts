// Small HTML pieces for the computer racers: the "AI level" setup chips, bot tags in the results table, the
// Racecraft rating line after a race and the Career screen block. Templates only; Menu routes the clicks.
import { AI } from '../config';
import { career } from '../core/career';
import { escapeHtml } from '../utils/math';
import type { LobbySettings } from '../../shared/protocol';
import type { Standing } from '../systems/Race';
import { AI_LEVEL_IDS, levelForPace, paceForRating, type AiLevel } from './personality';
import { lastRacecraft } from './racecraft';
import { DISCIPLINES, type Discipline } from './rating';

const LABEL: Record<AiLevel, string> = {
  rookie: `${AI.levels.rookie.icon} Rookie`, amateur: `${AI.levels.amateur.icon} Amateur`, pro: `${AI.levels.pro.icon} Pro`, legend: `${AI.levels.legend.icon} Legend`, adaptive: '🎯 Adaptive',
};
const HINT: Record<AiLevel, string> = {
  rookie: 'Gentle rivals: slower, nervous, more mistakes. A little catch-up keeps them in sight.',
  amateur: 'Club racers: decent pace, the odd mistake. A little catch-up keeps the race close.',
  pro: 'Fast and clean, no catch-up help: they race you for real.',
  legend: 'At the limit of the car, almost no mistakes, no catch-up. Good luck.',
  adaptive: 'Matches your Racecraft rating so races stay close; it learns from every result. Gentle, fair catch-up (±3 %).',
};
const DISC_LABEL: Record<Discipline, string> = { race: '🏁 Circuit race', f1: '🏎 Formula 1', elim: '🪓 Elimination' };

/** Setup row (race, Elimination, F1 when rivals are on). */
export function aiLevelRow(s: LobbySettings, online: boolean) {
  if (online || !s.ai || (s.mode !== 'race' && s.mode !== 'f1') || (s.mode === 'race' && s.variant === 'attack') || (s.mode === 'f1' && s.session === 'quali')) return '';
  const cur = s.aiLevel ?? 'adaptive';
  return `<div class="opt"><span>AI level</span><div class="chips">${AI_LEVEL_IDS.map((l) => `<button class="chip ${l === cur ? 'on' : ''}" data-opt="aiLevel" data-val="${l}">${LABEL[l]}</button>`).join('')}</div></div><p class="hint">${HINT[cur]}</p>`;
}
export const isAiLevel = (v: string): v is AiLevel => (AI_LEVEL_IDS as string[]).includes(v);

/** Personality tag after a bot's name in the results table. */
export function botTag(r: Standing) {
  if (!r.icon) return '';
  const lv = r.level && r.level in AI.levels ? AI.levels[r.level as keyof typeof AI.levels].label : '';
  return `<small title="${escapeHtml(r.persona ?? '')}">${r.icon} ${escapeHtml(r.persona ?? '')}</small>${lv ? `<span class="lvl">${lv}</span>` : ''}${r.tyre ? `<span class="lvl">${r.stops ?? 0} stop${r.stops === 1 ? '' : 's'}</span>` : ''}`;
}

const tierOf = (r: number) => AI.levels[levelForPace(paceForRating(r))];

/** "Racecraft rating 1043 (+18)" under the results table (only after a rated race). */
export function racecraftResultHtml() {
  const l = lastRacecraft();
  if (!l) return '';
  const d = Math.round(l.delta), t = tierOf(l.after);
  return `<p class="rc-line">${DISC_LABEL[l.d]} · Racecraft rating <b>${Math.round(l.after)}</b> <b class="${d >= 0 ? 'up' : 'down'}">(${d >= 0 ? '+' : ''}${d})</b> · ${t.icon} ${t.label} pace${l.n < 5 ? ' · provisional' : ''}</p>`;
}

/** Career screen block. */
export function racecraftCareerHtml() {
  const rows = DISCIPLINES.map((d) => {
    const v = career.racecraft?.[d];
    if (!v) return `<div class="cr-stat"><span>${DISC_LABEL[d]}</span><b class="dim">not rated yet</b></div>`;
    const t = tierOf(v.r);
    return `<div class="cr-stat"><span>${DISC_LABEL[d]}</span><b>${Math.round(v.r)} · ${t.icon} ${t.label}${v.n < 5 ? ' (provisional)' : ''} · ${v.n} race${v.n === 1 ? '' : 's'}</b></div>`;
  }).join('');
  return `<section><h3>🎯 Racecraft rating</h3><p class="hint">Your racing skill against the computer racers, per discipline. It moves after every race (finishing position against each rival's level, the gap, your lap pace against the ideal, crashes and off-tracks). Adaptive AI races at this level.</p><div class="cr-stats">${rows}</div></section>`;
}
