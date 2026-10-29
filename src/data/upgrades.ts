import type { Player } from '../entities/Player';

export interface Upgrade {
  title: string;
  desc: string;
  apply(p: Player): void;
}

export const UPGRADES: Upgrade[] = [
  { title: 'Engine Tune', desc: '+10% top speed and acceleration', apply: (p) => { p.stats.top *= 1.1; p.stats.accel *= 1.1; } },
  { title: 'Bigger Tank', desc: '+40 nitro capacity', apply: (p) => { p.stats.nitroMax += 40; p.s.nitro = p.stats.nitroMax; } },
  { title: 'Nitro Recycler', desc: 'Nitro refills 2x faster', apply: (p) => { p.stats.nitroRegen *= 2; } },
  { title: 'Grip Tires', desc: '+15% steering', apply: (p) => { p.stats.grip *= 1.15; } },
  { title: 'Armor Plating', desc: '+30 max health, full heal', apply: (p) => { p.stats.hpMax += 30; p.s.hp = p.stats.hpMax; } },
  { title: 'Rapid Fire', desc: '+25% fire rate', apply: (p) => { p.stats.fire *= 1.25; } },
  { title: 'Hollow Points', desc: '+30% weapon damage', apply: (p) => { p.stats.dmg *= 1.3; } },
  { title: 'Gem Magnet', desc: 'Pull gems from 60% further away', apply: (p) => { p.stats.magnet *= 1.6; } },
  { title: 'Scholar', desc: '+20% XP from everything', apply: (p) => { p.stats.xpMul *= 1.2; } },
  { title: 'Reinforced Frame', desc: 'Crashes and walls hurt 40% less', apply: (p) => { p.stats.crashArmor = Math.min(0.8, p.stats.crashArmor + 0.4); } },
  { title: 'Kevlar Jacket', desc: 'Take 15% less damage from weapons', apply: (p) => { p.stats.armor = Math.min(0.6, p.stats.armor + 0.15); } },
  { title: 'Showboat', desc: '+30% XP and nitro from tricks', apply: (p) => { p.stats.trickMul *= 1.3; } },
];
