// Career achievements: tested against lifetime stats (src/core/career.ts) whenever they change.
// Each pays career XP + credits once, with a HUD toast.
import type { Career, CareerStats } from '../core/career';
import { THEMES } from '../../shared/protocol';
import { F1_TRACKS } from '../world/f1Circuits';

export type AchievementCat = 'Riding' | 'Tricks' | 'Drift' | 'Racing' | 'Formula 1' | 'Modes' | 'Combat' | 'Exploration' | 'Weather' | 'Online' | 'Career';

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
  { id: 'kickflip', cat: 'Tricks', icon: '🛹', name: 'Kickflip', desc: 'Land a thruster kickflip in the Tesla Roadster', xp: 300, credits: 90, test: (s) => s.kickflips >= 1 },
  { id: 'rocket_man', cat: 'Tricks', icon: '🚀', name: 'Rocket man', desc: 'Fly the Tesla Roadster on its thrusters for 8 s', xp: 500, credits: 150, test: (s) => s.bestFlight >= 8, prog: (s) => ratio(s.bestFlight, 8) },
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
  { id: 'f1_tour', cat: 'Formula 1', icon: '🌐', name: 'World tour', desc: 'Race on 6 different F1 circuits', xp: 1200, credits: 400, test: (s) => s.f1Tracks.length >= 6, prog: (s) => ratio(s.f1Tracks.length, 6) },
  { id: 'f1_calendar', cat: 'Formula 1', icon: '🗺', name: 'Full calendar', desc: `Race on all ${F1_TRACKS.length} F1 circuits`, xp: 2500, credits: 900, test: (s) => F1_TRACKS.every((t) => s.f1Tracks.includes(t.id)), prog: (s) => ratio(F1_TRACKS.filter((t) => s.f1Tracks.includes(t.id)).length, F1_TRACKS.length) },
  // modes, leaderboards, replay (stats fed by recordFeat in core/career.ts)
  { id: 'medal_gold', cat: 'Modes', icon: '🥇', name: 'Gold standard', desc: 'Win a gold medal in Time Attack', xp: 500, credits: 150, test: (s) => s.bestMedal >= 3, prog: (s) => ratio(s.bestMedal, 3) },
  { id: 'medal_ace', cat: 'Modes', icon: '💎', name: 'Ace', desc: 'Beat an Ace time in Time Attack', xp: 1000, credits: 350, test: (s) => s.bestMedal >= 4 },
  { id: 'elim_win', cat: 'Modes', icon: '🪓', name: 'Last one standing', desc: 'Win an Elimination race', xp: 500, credits: 150, test: (s) => s.elimWins >= 1 },
  { id: 'near_chain', cat: 'Modes', icon: '🚗', name: 'Thread the needle', desc: 'Chain 10 near misses in traffic', xp: 600, credits: 180, test: (s) => s.bestNearChain >= 10, prog: (s) => ratio(s.bestNearChain, 10) },
  { id: 'near_100', cat: 'Modes', icon: '💨', name: 'Rush hour', desc: 'Pass 100 cars with a near miss', xp: 700, credits: 220, test: (s) => s.nearMisses >= 100, prog: (s) => ratio(s.nearMisses, 100) },
  { id: 'daily_1', cat: 'Modes', icon: '📅', name: 'Daily driver', desc: 'Finish a daily or weekly challenge', xp: 300, credits: 100, test: (s) => s.challengesDone >= 1 },
  { id: 'daily_7', cat: 'Modes', icon: '🗓', name: 'Regular', desc: 'Finish 7 daily or weekly challenges', xp: 900, credits: 300, test: (s) => s.challengesDone >= 7, prog: (s) => ratio(s.challengesDone, 7) },
  { id: 'lb_top10', cat: 'Modes', icon: '🏆', name: 'Top ten', desc: 'Reach the top 10 of any leaderboard', xp: 600, credits: 200, test: (s) => s.bestRank >= 1 && s.bestRank <= 10 },
  { id: 'director', cat: 'Modes', icon: '🎬', name: 'Director', desc: 'Watch a replay', xp: 80, credits: 20, test: (s) => s.replays >= 1 },
  { id: 'photographer', cat: 'Modes', icon: '📷', name: 'Say cheese', desc: 'Take a photo in photo mode', xp: 80, credits: 20, test: (s) => s.photos >= 1 },
  // online
  { id: 'chatty', cat: 'Online', icon: '💬', name: 'Say hi', desc: 'Send a chat message or quick chat in an online room', xp: 60, credits: 20, test: (s) => s.chats >= 1 },
  { id: 'online_race', cat: 'Online', icon: '🌐', name: 'Netcode', desc: 'Finish an online race', xp: 200, credits: 60, test: (s) => s.onlineRaces >= 1 },
  { id: 'online_win', cat: 'Online', icon: '👑', name: 'Room champion', desc: 'Win an online race', xp: 800, credits: 250, test: (s) => s.onlineWins >= 1 },
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

export const ACHIEVEMENT_CATS: AchievementCat[] = ['Riding', 'Tricks', 'Drift', 'Racing', 'Formula 1', 'Modes', 'Combat', 'Exploration', 'Weather', 'Online', 'Career'];
