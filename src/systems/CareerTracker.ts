// Feeds one play session into the persistent career: lifetime stats, credits, career XP and achievements.
// Listens to Game 'progress' events and samples players a few times per second; nothing allocates per frame.
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import type { ChallengeId } from '../data/challenges';
import type { AchievementDef } from '../data/achievements';
import { CAREER } from '../config';
import { addUnique, beginSession, career, checkAchievements, earn, recordFeat, saveCareer, type Feat } from '../core/career';

interface Seen { score: number; wheelie: number; finished: boolean }

export class CareerTracker {
  private seen: Seen[];
  private rivals: number;
  private pendXp = 0;
  private pendCredits = 0;
  private tickT = 0;
  private saveT = CAREER.saveEvery;
  private fresh: AchievementDef[] = [];
  private off: () => void;

  constructor(private game: Game) {
    beginSession();
    const o = game.opts, st = career.stats;
    this.seen = game.players.map((p) => ({ score: p.s.score, wheelie: 0, finished: false }));
    this.rivals = (game.ai?.list.length ?? 0) + game.players.length - 1 + (game.net ? Math.max(0, game.net.players.length - 1) : 0);
    st.sessions++;
    if (o.mode === 'open' && !o.tutorial) addUnique(st.themes, o.theme);
    if (o.mode === 'drift') addUnique(st.driftVenues, o.trackId);
    if (o.mode === 'f1') addUnique(st.f1Tracks, o.trackId);
    if ((o.mode === 'race' || o.mode === 'f1') && o.session !== 'quali' && this.rivals > 0) {
      st.racesStarted++;
      if (o.mode === 'f1') st.f1Started++;
      this.pendCredits += CAREER.raceStart;
    }
    this.off = game.events.on('progress', (e) => this.progress(e.player, e.id, e.value));
  }

  private progress(p: Player, id: ChallengeId, v: number) {
    const st = career.stats, env = this.game.env;
    switch (id) {
      case 'dist':
        st.distance += v;
        this.pendCredits += (v / 1000) * CAREER.creditsPerKm;
        if (env.night > 0.6) st.nightDist += v;
        for (let i = 0; i < env.weathers.length; i++) {
          const w = env.weathers[i];
          st.weatherDist[w] = (st.weatherDist[w] ?? 0) + v;
        }
        break;
      case 'gem': st.gems += v; this.pendCredits += CAREER.creditsPerGem * v; break;
      case 'drone': st.drones += v; this.pendCredits += CAREER.creditsPerDrone * v; break;
      case 'crate': st.crates += v; break;
      case 'barrel': st.barrels += v; break;
      case 'powerup': st.powerups += v; break;
      case 'ramp': st.ramps += v; break;
      case 'flip': st.flips += v; break;
      case 'spin': st.spins += v; break;
      case 'style': st.styleTricks += v; break;
      case 'air': st.bestAir = Math.max(st.bestAir, v); break;
      case 'combo': st.bestCombo = Math.max(st.bestCombo, v); break;
      case 'drift':
        st.bestDrift = Math.max(st.bestDrift, v);
        st.driftTotal += v;
        this.pendCredits += v * CAREER.creditsPerDrift;
        break;
      case 'wheelie': {
        // emitted every step while the front is up, with the running time
        const seen = this.seen[p.index];
        const d = seen && v > seen.wheelie ? v - seen.wheelie : v;
        if (seen) seen.wheelie = v;
        st.wheelieTime += d;
        st.longestWheelie = Math.max(st.longestWheelie, v);
        this.pendCredits += d * CAREER.creditsPerWheelieSec;
        break;
      }
    }
  }

  update(dt: number) {
    const st = career.stats;
    st.playTime += dt;
    for (const p of this.game.players) {
      const seen = this.seen[p.index];
      if (!seen) continue;
      if (p.riding && !p.s.dead) st.topSpeed = Math.max(st.topSpeed, Math.abs(p.B.v) * 3.6);
      if (p.s.score > seen.score) {
        const d = p.s.score - seen.score;
        this.pendXp += d * CAREER.xpPerScore;
        this.pendCredits += d * CAREER.creditsPerScore;
      }
      seen.score = p.s.score;
      st.bestRunLevel = Math.max(st.bestRunLevel, p.s.level);
      if (p.race.finished && !seen.finished) {
        seen.finished = true;
        this.raceFinished(p.race.place);
      }
    }
    this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = 0.5;
      this.flush();
    }
    this.saveT -= dt;
    if (this.saveT <= 0) {
      this.saveT = CAREER.saveEvery;
      saveCareer();
    }
  }

  /** Mode / leaderboard / replay / online feats (see recordFeat). Nothing counts while a replay or photo mode is open,
   *  except opening them; online spectating never reaches here (only local players' own results do). */
  feat(f: Feat, v = 1, key = '') {
    if (this.game.view && f !== 'replay' && f !== 'photo') return;
    if (recordFeat(f, v, key)) this.flush();
  }

  private raceFinished(place: number) {
    const o = this.game.opts, st = career.stats;
    if (this.rivals <= 0 || o.session === 'quali' || (o.mode !== 'race' && o.mode !== 'f1')) return;
    const i = place - 1;
    if (this.game.net) {
      st.onlineRaces++;
      if (i === 0) st.onlineWins++;
    }
    if (i < 0 || i > 2) return;
    st.podiums++;
    if (i === 0) {
      st.racesWon++;
      if (o.mode === 'f1') st.f1Won++;
    }
    this.pendCredits += CAREER.racePlace[i];
    this.pendXp += CAREER.raceXp[i];
  }

  /** Pay out what built up, then look for newly met achievements and celebrate them on the HUD. */
  private flush() {
    const ups = earn(this.pendXp, this.pendCredits);
    this.pendXp = this.pendCredits = 0;
    if (ups > 0) this.toast('⭐', `Level ${career.level}`, 'Check the garage for new unlocks', 'CAREER');
    for (const a of checkAchievements(this.fresh)) this.toast(a.icon, a.name, `${a.desc} · +${a.credits} cr${a.xp ? ` · +${a.xp} XP` : ''}`, 'ACHIEVEMENT');
  }

  private toast(icon: string, title: string, sub: string, label: string) {
    for (const p of this.game.players) p.hud.toast(icon, title, sub, label);
  }

  dispose() {
    this.off();
    this.flush();
    saveCareer();
  }
}
