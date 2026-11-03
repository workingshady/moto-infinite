// Career achievements: tested against lifetime stats (src/core/career.ts) whenever they change.
// Each pays career XP + credits once, with a HUD toast.
import type { Career, CareerStats } from '../core/career';
import { THEMES } from '../../shared/protocol';
import { F1_TRACKS } from '../world/F1Track';

export type AchievementCat = 'Riding' | 'Tricks' | 'Drift' | 'Racing' | 'Formula 1' | 'Combat' | 'Exploration' | 'Weather' | 'Career';

export interface AchievementDef {
  id: string;
  cat: AchievementCat;
  icon: string;
  name: string;
  desc: string;
  xp: number;
  credits: number;
  test: (s: CareerStats, c: Career) => boolean;
  /** 0..1 progress for the career screen (optional). */
  prog?: (s: CareerStats, c: Career) => number;
}

const W = (s: CareerStats, ...ws: string[]) => ws.reduce((t, w) => t + (s.weatherDist[w] ?? 0), 0);
const ratio = (v: number, target: number) => Math.min(1, v / target);

export const ACHIEVEMENTS: AchievementDef[] = [
  // riding
  { id: 'first_km', cat: 'Riding', icon: '🛣', name: 'First kilometre', desc: 'Ride 1 km', xp: 100, credits: 25, test: (s) => s.distance >= 1000, prog: (s) => ratio(s.distance, 1000) },
  { id: 'road_trip', cat: 'Riding', icon: '🗺', name: 'Road trip', desc: 'Ride 25 km in total', xp: 400, credits: 120, test: (s) => s.distance >= 25000, prog: (s) => ratio(s.distance, 25000) },
  { id: 'long_haul', cat: 'Riding', icon: '🌍', name: 'Long haul', desc: 'Ride 100 km in total', xp: 1200, credits: 400, test: (s) => s.distance >= 100000, prog: (s) => ratio(s.distance, 100000) },
  { id: 'ton_up', cat: 'Riding', icon: '💨', name: 'Ton up', desc: 'Hit 160 km/h', xp: 150, credits: 40, test: (s) => s.topSpeed >= 160, prog: (s) => ratio(s.topSpeed, 160) },
  { id: 'warp', cat: 'Riding', icon: '🚀', name: 'Warp speed', desc: 'Hit 300 km/h', xp: 600, credits: 200, test: (s) => s.topSpeed >= 300, prog: (s) => ratio(s.topSpeed, 300) },
  { id: 'dedicated', cat: 'Riding', icon: '⏱', name: 'Dedicated', desc: 'Play for 1 hour in total', xp: 800, credits: 250, test: (s) => s.playTime >= 3600, prog: (s) => ratio(s.playTime, 3600) },
  // tricks
  { id: 'first_flip', cat: 'Tricks', icon: '🤸', name: 'Head over heels', desc: 'Land your first flip', xp: 150, credits: 40, test: (s) => s.flips >= 1 },
  { id: 'flip_master', cat: 'Tricks', icon: '🌀', name: 'Flip master', desc: 'Land 50 flips', xp: 900, credits: 300, test: (s) => s.flips >= 50, prog: (s) => ratio(s.flips, 50) },
  { id: 'spin_doctor', cat: 'Tricks', icon: '🔄', name: 'Spin doctor', desc: 'Land 25 spins', xp: 600, credits: 180, test: (s) => s.spins >= 25, prog: (s) => ratio(s.spins, 25) },
  { id: 'hang_time', cat: 'Tricks', icon: '🦅', name: 'Hang time', desc: 'Stay airborne 3 s in one jump', xp: 400, credits: 120, test: (s) => s.bestAir >= 3, prog: (s) => ratio(s.bestAir, 3) },
  { id: 'combo_king', cat: 'Tricks', icon: '👑', name: 'Combo king', desc: 'Reach a x5 trick combo', xp: 700, credits: 220, test: (s) => s.bestCombo >= 5, prog: (s) => ratio(s.bestCombo, 5) },
  { id: 'wheelie_5', cat: 'Tricks', icon: '🏍', name: 'Wheelie', desc: 'Hold a 5 s wheelie', xp: 200, credits: 60, test: (s) => s.longestWheelie >= 5, prog: (s) => ratio(s.longestWheelie, 5) },
  { id: 'wheelie_20', cat: 'Tricks', icon: '🦄', name: 'One-wheel wonder', desc: 'Hold a 20 s wheelie', xp: 800, credits: 260, test: (s) => s.longestWheelie >= 20, prog: (s) => ratio(s.longestWheelie, 20) },
  // drift
  { id: 'sideways', cat: 'Drift', icon: '🌪', name: 'Sideways', desc: 'Bank a 2,000 point drift', xp: 250, credits: 70, test: (s) => s.bestDrift >= 2000, prog: (s) => ratio(s.bestDrift, 2000) },
  { id: 'drift_king', cat: 'Drift', icon: '🔥', name: 'Drift king', desc: 'Bank a 10,000 point drift', xp: 1000, credits: 350, test: (s) => s.bestDrift >= 10000, prog: (s) => ratio(s.bestDrift, 10000) },
  { id: 'tyre_smoke', cat: 'Drift', icon: '☁️', name: 'Tyre smoke', desc: 'Bank 100,000 drift points in total', xp: 1200, credits: 400, test: (s) => s.driftTotal >= 100000, prog: (s) => ratio(s.driftTotal, 100000) },
  // racing
  { id: 'first_race', cat: 'Racing', icon: '🚦', name: 'Lights out', desc: 'Start a race against rivals', xp: 100, credits: 30, test: (s) => s.racesStarted >= 1 },
  { id: 'first_win', cat: 'Racing', icon: '🏆', name: 'Winner', desc: 'Win a race', xp: 500, credits: 150, test: (s) => s.racesWon >= 1 },
  { id: 'podium_10', cat: 'Racing', icon: '🥉', name: 'Podium regular', desc: 'Finish on the podium 10 times', xp: 1000, credits: 350, test: (s) => s.podiums >= 10, prog: (s) => ratio(s.podiums, 10) },
  // formula 1
  { id: 'f1_debut', cat: 'Formula 1', icon: '🏎', name: 'Grand Prix debut', desc: 'Start a Formula 1 race', xp: 200, credits: 60, test: (s) => s.f1Started >= 1 },
  { id: 'f1_win', cat: 'Formula 1', icon: '🍾', name: 'Champagne', desc: 'Win a Formula 1 race', xp: 900, credits: 300, test: (s) => s.f1Won >= 1 },
  { id: 'f1_tour', cat: 'Formula 1', icon: '🌐', name: 'World tour', desc: `Race on all ${F1_TRACKS.length} F1 circuits`, xp: 1200, credits: 400, test: (s) => s.f1Tracks.length >= F1_TRACKS.length, prog: (s) => ratio(s.f1Tracks.length, F1_TRACKS.length) },
  // combat
  { id: 'first_drone', cat: 'Combat', icon: '🛸', name: 'Drone down', desc: 'Destroy a drone', xp: 120, credits: 40, test: (s) => s.drones >= 1 },
  { id: 'drone_50', cat: 'Combat', icon: '🎯', name: 'Sky cleaner', desc: 'Destroy 50 drones', xp: 1000, credits: 350, test: (s) => s.drones >= 50, prog: (s) => ratio(s.drones, 50) },
  { id: 'demolition', cat: 'Combat', icon: '💥', name: 'Demolition', desc: 'Blow up 25 barrels', xp: 400, credits: 120, test: (s) => s.barrels >= 25, prog: (s) => ratio(s.barrels, 25) },
  // exploration
  { id: 'globetrotter', cat: 'Exploration', icon: '🧭', name: 'Globetrotter', desc: `Ride all ${THEMES.length} open-world themes`, xp: 700, credits: 220, test: (s) => s.themes.length >= THEMES.length, prog: (s) => ratio(s.themes.length, THEMES.length) },
  { id: 'night_rider', cat: 'Exploration', icon: '🌙', name: 'Night rider', desc: 'Ride 5 km at night', xp: 400, credits: 120, test: (s) => s.nightDist >= 5000, prog: (s) => ratio(s.nightDist, 5000) },
  { id: 'gem_hoard', cat: 'Exploration', icon: '💎', name: 'Gem hoarder', desc: 'Collect 300 gems', xp: 700, credits: 200, test: (s) => s.gems >= 300, prog: (s) => ratio(s.gems, 300) },
  // weather
  { id: 'rain_rider', cat: 'Weather', icon: '🌧', name: 'Singing in the rain', desc: 'Ride 3 km in drizzle, rain or storm', xp: 300, credits: 90, test: (s) => W(s, 'drizzle', 'rain', 'storm') >= 3000, prog: (s) => ratio(W(s, 'drizzle', 'rain', 'storm'), 3000) },
  { id: 'snow_rider', cat: 'Weather', icon: '❄️', name: 'Ice road', desc: 'Ride 3 km in snow or a blizzard', xp: 300, credits: 90, test: (s) => W(s, 'snow', 'blizzard') >= 3000, prog: (s) => ratio(W(s, 'snow', 'blizzard'), 3000) },
  { id: 'storm_chaser', cat: 'Weather', icon: '🌪', name: 'Storm chaser', desc: 'Ride 2 km through a sandstorm, hail or strong wind', xp: 300, credits: 90, test: (s) => W(s, 'sandstorm', 'hail', 'wind') >= 2000, prog: (s) => ratio(W(s, 'sandstorm', 'hail', 'wind'), 2000) },
  { id: 'all_weather', cat: 'Weather', icon: '🌦', name: 'All-weather', desc: 'Ride 500 m in 8 different weathers', xp: 900, credits: 300, test: (s) => Object.values(s.weatherDist).filter((d) => d >= 500).length >= 8, prog: (s) => ratio(Object.values(s.weatherDist).filter((d) => d >= 500).length, 8) },
  // career
  { id: 'level_5', cat: 'Career', icon: '⭐', name: 'Rising star', desc: 'Reach career level 5', xp: 0, credits: 300, test: (_s, c) => c.level >= 5, prog: (_s, c) => ratio(c.level, 5) },
  { id: 'collector', cat: 'Career', icon: '🔑', name: 'Collector', desc: 'Unlock 5 vehicles in the garage', xp: 600, credits: 0, test: (_s, c) => c.unlocked.length >= 5, prog: (_s, c) => ratio(c.unlocked.length, 5) },
];

export const ACHIEVEMENT_CATS: AchievementCat[] = ['Riding', 'Tricks', 'Drift', 'Racing', 'Formula 1', 'Combat', 'Exploration', 'Weather', 'Career'];
