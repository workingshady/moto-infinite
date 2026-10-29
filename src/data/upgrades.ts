import type { Player } from '../entities/Player';

/** Card rarity: rarer cards roll bigger bonuses. */
export const TIERS = [
  { name: 'Common', color: '#cfd6de', weight: 68, mul: 1 },
  { name: 'Rare', color: '#3cc8ff', weight: 26, mul: 1.6 },
  { name: 'Epic', color: '#c77dff', weight: 6, mul: 2.5 },
];

export interface Upgrade {
  id: string;
  icon: string;
  title: string;
  /** Description for a given rarity multiplier. */
  desc(m: number): string;
  apply(p: Player, m: number): void;
  /** How many times it can be taken in one run. */
  max: number;
}

export interface Card { u: Upgrade; tier: number }

const pct = (x: number) => `+${Math.round(x * 100)}%`;

export const UPGRADES: Upgrade[] = [
  { id: 'engine', icon: '⚙️', title: 'Engine Tune', max: 6, desc: (m) => `${pct(0.08 * m)} top speed and acceleration`, apply: (p, m) => { p.stats.top *= 1 + 0.08 * m; p.stats.accel *= 1 + 0.08 * m; } },
  { id: 'tank', icon: '🛢️', title: 'Bigger Tank', max: 5, desc: (m) => `+${Math.round(35 * m)} nitro capacity`, apply: (p, m) => { p.stats.nitroMax += Math.round(35 * m); p.s.nitro = p.stats.nitroMax; } },
  { id: 'recycler', icon: '♻️', title: 'Nitro Recycler', max: 4, desc: (m) => `Nitro refills ${pct(0.6 * m)} faster`, apply: (p, m) => { p.stats.nitroRegen *= 1 + 0.6 * m; } },
  { id: 'grip', icon: '🛞', title: 'Grip Tires', max: 4, desc: (m) => `${pct(0.12 * m)} steering, less slide in rain`, apply: (p, m) => { p.stats.grip *= 1 + 0.12 * m; } },
  { id: 'armor', icon: '🛡️', title: 'Armor Plating', max: 5, desc: (m) => `+${Math.round(25 * m)} max health, full heal`, apply: (p, m) => { p.stats.hpMax += Math.round(25 * m); p.s.hp = p.stats.hpMax; } },
  { id: 'rapid', icon: '🔥', title: 'Rapid Fire', max: 5, desc: (m) => `${pct(0.2 * m)} fire rate`, apply: (p, m) => { p.stats.fire *= 1 + 0.2 * m; } },
  { id: 'hollow', icon: '💥', title: 'Hollow Points', max: 5, desc: (m) => `${pct(0.22 * m)} weapon damage`, apply: (p, m) => { p.stats.dmg *= 1 + 0.22 * m; } },
  { id: 'magnet', icon: '🧲', title: 'Gem Magnet', max: 4, desc: (m) => `Pull gems from ${pct(0.45 * m)} further`, apply: (p, m) => { p.stats.magnet *= 1 + 0.45 * m; } },
  { id: 'scholar', icon: '📚', title: 'Scholar', max: 4, desc: (m) => `${pct(0.15 * m)} XP from everything`, apply: (p, m) => { p.stats.xpMul *= 1 + 0.15 * m; } },
  { id: 'frame', icon: '🔩', title: 'Reinforced Frame', max: 3, desc: (m) => `Crashes and walls hurt ${pct(0.25 * m).slice(1)} less`, apply: (p, m) => { p.stats.crashArmor = Math.min(0.8, p.stats.crashArmor + 0.25 * m); } },
  { id: 'kevlar', icon: '🦺', title: 'Kevlar Jacket', max: 3, desc: (m) => `Take ${pct(0.1 * m).slice(1)} less weapon damage`, apply: (p, m) => { p.stats.armor = Math.min(0.6, p.stats.armor + 0.1 * m); } },
  { id: 'showboat', icon: '🤘', title: 'Showboat', max: 4, desc: (m) => `${pct(0.25 * m)} XP and nitro from tricks`, apply: (p, m) => { p.stats.trickMul *= 1 + 0.25 * m; } },
];

/** Exhaust colour unlocked at milestone levels. */
export const MILESTONES: { level: number; title: string; flame: number }[] = [
  { level: 5, title: 'GOLD FLAMES', flame: 0xffd23f },
  { level: 10, title: 'PLASMA FLAMES', flame: 0xc77dff },
  { level: 15, title: 'RAINBOW FLAMES', flame: -1 },
];
