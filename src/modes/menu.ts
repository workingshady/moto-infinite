// Setup-panel rows for the formats in src/modes (local games only: rooms don't sync them).
import type { LobbySettings, RaceVariant } from '../../shared/protocol';

const VARIANTS: { id: RaceVariant; label: string; hint: string }[] = [
  { id: 'classic', label: '🏁 Race', hint: 'Classic race: first over the line after the last lap wins.' },
  { id: 'attack', label: '⏱ Time attack', hint: 'Solo against the clock: beat 🥉 🥈 🥇 and 💎 medal times set for this track and your vehicle. Live split vs the next medal; best lap and medal saved. No AI.' },
  { id: 'elim', label: '🪓 Elimination', hint: 'Knockout: every few seconds the rider in last place is out. Last one standing wins. Needs AI rivals or a second player.' },
];
const TRAFFIC_LEVELS = ['🚫 Off', '🚗 Light', '🚙🚗 Heavy'];

const chip = (opt: string, val: string | number, on: boolean, label: string) => `<button class="chip ${on ? 'on' : ''}" data-opt="${opt}" data-val="${val}">${label}</button>`;

/** Race format chips + explanation (circuit race, not in online rooms). */
export function variantRow(s: LobbySettings, online: boolean) {
  if (online || s.mode !== 'race') return '';
  const cur = VARIANTS.find((v) => v.id === (s.variant ?? 'classic')) ?? VARIANTS[0];
  return `<div class="opt"><span>Format</span><div class="chips">${VARIANTS.map((v) => chip('variant', v.id, v === cur, v.label)).join('')}</div></div><p class="hint">${cur.hint}</p>`;
}

/** Open-world traffic density chips (not in online rooms). */
export function trafficRow(s: LobbySettings, online: boolean) {
  if (online || s.mode !== 'open') return '';
  const cur = s.traffic ?? 1;
  return `<div class="opt"><span>Traffic</span><div class="chips">${TRAFFIC_LEVELS.map((l, i) => chip('traffic', i, i === cur, l)).join('')}</div></div>
  <p class="hint">${cur ? 'Thread past cars at speed for <b>NEAR MISS</b> chains (oncoming pays double): XP + nitro. Tuck in behind a car to charge nitro from its slipstream. Don\'t hit them.' : 'Empty roads.'}</p>`;
}

/** Applies a format/traffic chip and keeps AI rivals consistent with the format. Returns false if the key isn't ours. */
export function setModeOpt(s: LobbySettings, key: string, val: string): boolean {
  if (key === 'variant') {
    s.variant = VARIANTS.some((v) => v.id === val) ? (val as RaceVariant) : 'classic';
    if (s.variant === 'attack') s.ai = 0;
    if (s.variant === 'elim' && !s.ai) s.ai = 5;
    return true;
  }
  if (key === 'traffic') { s.traffic = Math.max(0, Math.min(2, Math.round(+val) || 0)); return true; }
  if (key === 'ai' && s.variant === 'attack' && s.ai) s.variant = 'classic'; // picking rivals leaves time attack
  return false;
}
