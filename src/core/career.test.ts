// career.ts loads localStorage at import: each case stubs storage and re-imports the module.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAREER } from '../config';

// achievements.ts only needs the F1 circuit count; the real F1Track builds canvas textures (no DOM in Node)
vi.mock('../world/F1Track', () => ({ F1_TRACKS: [{ id: 'monza' }, { id: 'spa' }] }));

function storage(career?: unknown) {
  const data = new Map<string, string>();
  if (career !== undefined) data.set('moto:career', typeof career === 'string' ? career : JSON.stringify(career));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}
async function load(s = storage()) {
  vi.resetModules();
  vi.stubGlobal('localStorage', s);
  return import('./career');
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('career storage', () => {
  it.each([['broken JSON', '{"level": 3'], ['null', 'null'], ['wrong types', { level: 'x', credits: -5, stats: { flips: 'many', themes: 7 } }]])('loads safely: %s', async (_l, raw) => {
    const { career } = await load(storage(raw));
    expect(career.level).toBe(1);
    expect(career.credits).toBe(0);
    expect(career.stats.flips).toBe(0);
    expect(career.stats.themes).toEqual([]);
    expect(career.stats.medals).toBe(0);
  });
  it('old saves without the new stats keep their progress', async () => {
    const { career } = await load(storage({ v: 1, level: 4, xp: 10, credits: 99, stats: { flips: 7 } }));
    expect(career.level).toBe(4);
    expect(career.stats.flips).toBe(7);
    expect(career.stats.challengeKeys).toEqual([]);
  });
});

describe('earning', () => {
  it('pays credits and levels up across several levels', async () => {
    const { career, earn, careerXpNeed, beginSession, sessionEarnings } = await load();
    beginSession();
    const need = careerXpNeed(1) + careerXpNeed(2);
    expect(earn(need + 5, 10)).toBe(2);
    expect(career.level).toBe(3);
    expect(career.xp).toBe(5);
    expect(career.credits).toBe(10);
    void sessionEarnings;
    const mod = await import('./career');
    expect(mod.sessionEarnings?.levels).toBe(2);
  });
});

describe('feats', () => {
  it('medals pay by medal and unlock Gold standard', async () => {
    const { career, recordFeat, checkAchievements } = await load();
    expect(recordFeat('medal', 3)).toBe(true);
    expect(career.credits).toBe(CAREER.medalCredits[2]);
    expect(career.stats.bestMedal).toBe(3);
    expect(checkAchievements([]).map((a) => a.id)).toContain('medal_gold');
    expect(recordFeat('medal', 0)).toBe(false);
    expect(recordFeat('medal', 9)).toBe(false);
  });
  it('a challenge pays once per board', async () => {
    const { career, recordFeat } = await load();
    expect(recordFeat('challenge', 1, 'daily:2026-11-03:race')).toBe(true);
    expect(recordFeat('challenge', 1, 'daily:2026-11-03:race')).toBe(false);
    expect(recordFeat('challenge', 1, '')).toBe(false);
    expect(career.stats.challengesDone).toBe(1);
    expect(career.credits).toBe(CAREER.challenge[0]);
  });
  it('keeps the best leaderboard rank and longest near-miss chain', async () => {
    const { career, recordFeat } = await load();
    recordFeat('lbRank', 14);
    recordFeat('lbRank', 3);
    recordFeat('lbRank', 20);
    expect(career.stats.bestRank).toBe(3);
    recordFeat('nearMiss', 4);
    recordFeat('nearMiss', 2);
    expect(career.stats.nearMisses).toBe(2);
    expect(career.stats.bestNearChain).toBe(4);
  });
  it('featNow saves and returns unlocked achievements', async () => {
    const s = storage();
    const { featNow } = await load(s);
    expect(featNow('chat').map((a) => a.id)).toEqual(['chatty']);
    expect(JSON.parse(s.data.get('moto:career')!).stats.chats).toBe(1);
    expect(featNow('chat')).toEqual([]);
  });
});
