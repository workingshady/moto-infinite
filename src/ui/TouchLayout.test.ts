import { describe, expect, it } from 'vitest';
import { TOUCH, TOUCH_BUTTONS, defaultCentre, stickCentre, type TouchCtx, type TouchScheme, type TouchSettings } from './TouchLayout';

const S = (o: Partial<TouchSettings> = {}): TouchSettings => ({ scheme: 'buttons', size: 1, opacity: 0.75, leftHanded: false, tiltRange: 22, tiltInvert: false, pos: {}, ...o });

/** Every context a session can produce (mode x vehicle x riding x weapons x cards x scheme). */
function* contexts(): Generator<TouchCtx> {
  for (const mode of ['open', 'race', 'f1', 'drift'])
    for (const scheme of ['buttons', 'stick', 'tilt'] as TouchScheme[])
      for (const kind of ['bike', 'car', 'f1'] as const)
        for (const riding of [true, false])
          for (const pvp of [false, true])
            for (const cards of [false, true])
            for (const thrusters of [false, true]) {
              if (thrusters && kind !== 'car') continue; // only the Tesla Roadster has thrusters
              const f1 = kind === 'f1' && mode === 'f1';
              if (kind === 'f1' && mode !== 'f1') continue;
              if (!riding && mode !== 'open') continue; // only the open world lets you get off
              yield { mode, scheme, f1, car: kind !== 'bike', riding, weapons: !f1 && (mode === 'open' || pvp), canWalk: mode === 'open', cards: cards && mode === 'open', thrusters };
            }
}

const shown = (c: TouchCtx) => TOUCH_BUTTONS.filter((b) => b.show(c));

describe('touch button table', () => {
  it('always shows gas and brake, and steering buttons only for the buttons scheme', () => {
    for (const c of contexts()) {
      const ids = shown(c).map((b) => b.id);
      expect(ids).toEqual(expect.arrayContaining(['gas', 'brake']));
      expect(ids.includes('left')).toBe(c.scheme === 'buttons');
    }
  });

  it('mode-aware: DRS / ERS in F1, wheelie only on bikes, drift for cars and drift venues, ride only in the open world', () => {
    for (const c of contexts()) {
      const ids = shown(c).map((b) => b.id);
      if (c.f1) { expect(ids).toContain('trick'); expect(ids).not.toContain('drift'); expect(ids).not.toContain('fire'); }
      if (c.riding && !c.car) expect(ids).toContain('trick');
      if (c.riding && c.car && !c.f1) expect(ids).not.toContain('trick');
      if (c.riding && !c.f1 && (c.car || c.mode === 'drift')) expect(ids).toContain('drift');
      expect(ids.includes('ride')).toBe(c.mode === 'open');
    }
  });

  it.each([[844, 390], [390, 844], [1180, 820]])('no two visible buttons overlap by default (%i x %i, both hands)', (w, h) => {
    for (const leftHanded of [false, true]) {
      const s = S({ leftHanded });
      for (const c of contexts()) {
        const pts = shown({ ...c, scheme: c.scheme }).map((b) => ({ id: b.id, ...defaultCentre(b, c, w, h, s) }));
        for (let i = 0; i < pts.length; i++)
          for (let j = i + 1; j < pts.length; j++) {
            const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
            expect(d, `${pts[i].id} / ${pts[j].id} in ${JSON.stringify(c)}`).toBeGreaterThanOrEqual(TOUCH.unit * 0.9);
          }
      }
    }
  });

  it.each([[844, 390], [390, 844], [740, 360], [360, 740], [568, 320]])('Roadster LIFT / FLIP stay clear of every other button and the joystick (%i x %i)', (w, h) => {
    for (const size of [0.8, 1, 1.3])
      for (const leftHanded of [false, true]) {
        const s = S({ leftHanded, size }), u = TOUCH.unit * size;
        for (const c of contexts()) {
          if (!c.thrusters || !c.riding) continue;
          const pts = shown(c).map((b) => ({ id: b.id, ...defaultCentre(b, c, w, h, s) }));
          for (const t of pts.filter((p) => p.id === 'hover' || p.id === 'kickflip')) {
            expect(t.x - u / 2, `${t.id} off screen`).toBeGreaterThanOrEqual(0);
            expect(t.y - u / 2, `${t.id} off screen`).toBeGreaterThanOrEqual(0);
            // the extra 4th row (FLIP) never reaches into the minimap / stats band
            if (t.id === 'kickflip') expect(t.y - u / 2, 'FLIP under the minimap band').toBeGreaterThanOrEqual(TOUCH.topBand - TOUCH.margin);
            for (const o of pts) if (o !== t) expect(Math.hypot(t.x - o.x, t.y - o.y), `${t.id} / ${o.id} size ${size} ${JSON.stringify(c)}`).toBeGreaterThanOrEqual(u * 0.9);
            if (c.scheme === 'stick') {
              const st = stickCentre(w, h, s);
              expect(Math.hypot(t.x - st.x, t.y - st.y), `${t.id} / joystick`).toBeGreaterThanOrEqual((TOUCH.stick * size) / 2 + u * 0.45);
            }
          }
        }
      }
  });

  it('left-handed mirrors the clusters', () => {
    const c = contexts().next().value as TouchCtx, gas = TOUCH_BUTTONS.find((b) => b.id === 'gas')!;
    const r = defaultCentre(gas, c, 844, 390, S()), l = defaultCentre(gas, c, 844, 390, S({ leftHanded: true }));
    expect(r.x).toBeGreaterThan(422);
    expect(l.x).toBeLessThan(422);
    expect(l.y).toBe(r.y);
  });
});
