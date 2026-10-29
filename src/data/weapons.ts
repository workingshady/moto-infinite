import type { SfxName } from '../core/Audio';

export interface WeaponDef {
  id: string;
  name: string;
  unlock: number; // player level that unlocks it
  rate: number; // shots per second
  dmg: number;
  speed: number;
  life: number; // seconds a projectile lives
  color: number;
  pellets: number;
  spread: number;
  splash?: number; // explosion radius
  homing?: number; // turn rate toward target
  beam?: boolean; // instant hitscan, pierces
  mine?: boolean; // dropped behind the bike
  drop?: number; // gravity on the projectile
  size?: number;
  shake?: number;
  sfx: SfxName;
}

export const WEAPONS: WeaponDef[] = [
  { id: 'blaster', name: 'Blaster', unlock: 1, rate: 8, dmg: 20, speed: 130, life: 1.1, color: 0x55e8ff, pellets: 1, spread: 0.012, sfx: 'blaster' },
  { id: 'scatter', name: 'Scatter', unlock: 1, rate: 1.7, dmg: 11, speed: 105, life: 0.45, color: 0xffe066, pellets: 8, spread: 0.12, sfx: 'scatter' },
  { id: 'rocket', name: 'Rocket', unlock: 2, rate: 1.1, dmg: 70, speed: 62, life: 2.5, color: 0xff7a2e, pellets: 1, spread: 0, splash: 8, drop: 2, shake: 0.15, sfx: 'rocket' },
  { id: 'rail', name: 'Railgun', unlock: 3, rate: 0.8, dmg: 95, speed: 0, life: 0.35, color: 0xc77dff, pellets: 1, spread: 0, beam: true, shake: 0.2, sfx: 'rail' },
  { id: 'swarm', name: 'Swarm', unlock: 4, rate: 1.2, dmg: 22, speed: 48, life: 3, color: 0x7cffb2, pellets: 4, spread: 0.35, splash: 3.5, homing: 3.2, sfx: 'swarm' },
  { id: 'mine', name: 'Mine', unlock: 5, rate: 1, dmg: 65, speed: 0, life: 25, color: 0xff3355, pellets: 1, spread: 0, splash: 7, mine: true, sfx: 'mine' },
];
