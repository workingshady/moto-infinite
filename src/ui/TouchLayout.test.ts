import { describe, expect, it } from 'vitest';
import {
  TOUCH, TOUCH_BUTTONS, TOUCH_PRESETS, applyTouchPreset, cleanTouch, defaultCentre, keepOut, layoutButtons, loadTouchSlot, saveTouchSlot, snapPoint, stickCentre, stickSize,
  touchDefaults, visibleButtons, type TouchCtx, type TouchScheme, type TouchSettings,
} from './TouchLayout';

const S = (o: Partial<TouchSettings> = {}): TouchSettings => ({ ...touchDefaults(), ...o });

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
            // the extra 4th row (FLIP) never reaches into the minimap / stats band, as long as two rows fit below it
            // (smaller still, e.g. 568 x 320 at 130 %, it keeps row 2 of a 4th column rather than landing on ◀ ▶)
            const roomy = h - TOUCH.topBand >= TOUCH.margin + 2 * (u * 1.12 + TOUCH.gap * size);
            if (t.id === 'kickflip' && roomy) expect(t.y - u / 2, 'FLIP under the minimap band').toBeGreaterThanOrEqual(TOUCH.topBand - TOUCH.margin);
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

/** Bounding boxes of everything a context shows (buttons + joystick) with the given settings. */
function boxes(c: TouchCtx, w: number, h: number, s: TouchSettings) {
  const ctx = { ...c, scheme: s.scheme };
  const placed = layoutButtons(visibleButtons(ctx, s), ctx, w, h, s);
  const out = Object.entries(placed).map(([id, p]) => ({ id, l: p.x - p.w / 2, r: p.x + p.w / 2, t: p.y - p.h / 2, b: p.y + p.h / 2 }));
  if (s.scheme === 'stick') {
    const st = stickCentre(w, h, s), r = stickSize(s) / 2;
    out.push({ id: 'stick', l: st.x - r, r: st.x + r, t: st.y - r, b: st.y + r });
  }
  return out;
}
type Box = { l: number; r: number; t: number; b: number };
const overlap = (a: Box, b: Box) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1;

describe('presets and per-button sizes', () => {
  it.each([[915, 412], [800, 360], [891, 411], [412, 915], [390, 844]])('every preset fits without overlaps and on screen (%i x %i, both hands, sizes 0.8-1.3)', (w, h) => {
    for (const p of TOUCH_PRESETS)
      for (const leftHanded of [false, true])
        // portrait ("play anyway") is ~400 px wide: five columns of 130 % buttons cannot fit, so it is checked up to 100 %
        for (const size of h > w ? [0.8, 1] : [0.8, 1, 1.3]) {
          const s = S({ leftHanded, size });
          applyTouchPreset(s, p.id);
          for (const c of contexts()) {
            if (c.scheme !== 'buttons') continue; // the preset decides the scheme
            const bx = boxes(c, w, h, s);
            for (const a of bx) {
              expect(a.l, `${a.id} off screen (${p.id})`).toBeGreaterThanOrEqual(0);
              expect(a.r, `${a.id} off screen (${p.id})`).toBeLessThanOrEqual(w);
              expect(a.b, `${a.id} off screen (${p.id})`).toBeLessThanOrEqual(h);
              expect(a.t, `${a.id} under the system buttons (${p.id} size ${size})`).toBeGreaterThanOrEqual(TOUCH.sysBar);
            }
            for (let i = 0; i < bx.length; i++)
              for (let j = i + 1; j < bx.length; j++) expect(overlap(bx[i], bx[j]), `${bx[i].id} / ${bx[j].id} (${p.id} size ${size} ${JSON.stringify(c)})`).toBe(false);
          }
        }
  });

  it('an enlarged button pushes its neighbours out instead of overlapping them', () => {
    for (const big of ['gas', 'brake', 'nitro', 'left', 'fire'])
      for (const k of [1.3, 1.6]) {
        const s = S({ sizes: { [big]: k } });
        for (const c of contexts()) {
          if (c.scheme !== 'buttons' || !c.riding) continue;
          const bx = boxes(c, 915, 412, s);
          for (let i = 0; i < bx.length; i++)
            for (let j = i + 1; j < bx.length; j++) expect(overlap(bx[i], bx[j]), `${big} x${k}: ${bx[i].id} / ${bx[j].id}`).toBe(false);
          const b = bx.find((x) => x.id === big);
          if (b) expect(b.r - b.l).toBeGreaterThan(TOUCH.unit * k * 0.99);
        }
      }
  });

  it('racing has tall pedals; one-thumb drives with the joystick on the right and drops GAS / BRK', () => {
    const c = contexts().next().value as TouchCtx;
    const r = S();
    applyTouchPreset(r, 'racing');
    const gas = layoutButtons(visibleButtons(c, r), c, 915, 412, r).gas;
    expect(gas.h).toBeGreaterThan(gas.w * 1.4);
    const o = S();
    applyTouchPreset(o, 'onethumb');
    const ids = visibleButtons({ ...c, scheme: 'stick' }, o).map((b) => b.id);
    expect(ids).not.toContain('gas');
    expect(ids).not.toContain('brake');
    expect(stickCentre(915, 412, o).x).toBeGreaterThan(915 / 2);
    expect(stickCentre(915, 412, { ...o, leftHanded: true }).x).toBeLessThan(915 / 2);
  });

  it('saves and loads custom layouts in 3 slots', () => {
    const s = S({ pos: { 'land:gas': [0.9, 0.8] }, sizes: { gas: 1.4 } });
    applyTouchPreset(s, 'racing');
    saveTouchSlot(s, 2);
    Object.assign(s, { pos: {}, sizes: {}, scheme: 'tilt', style: 'classic' });
    expect(loadTouchSlot(s, 0)).toBe(false);
    expect(loadTouchSlot(s, 2)).toBe(true);
    expect(s).toMatchObject({ scheme: 'buttons', style: 'racing', sizes: { gas: 1.4 }, pos: { 'land:gas': [0.9, 0.8] } });
  });
});

describe('edit mode helpers', () => {
  it('keeps a dragged button on screen and out of HUD zones', () => {
    const zone = { l: 700, t: 0, r: 915, b: 200 }; // minimap
    const p = keepOut(800, 150, 62, 62, 915, 412, [zone]);
    expect(p.y - 31 >= zone.b || p.x + 31 <= zone.l).toBe(true);
    expect(keepOut(-50, 500, 62, 62, 915, 412, [])).toEqual({ x: 31, y: 412 - 31 });
  });
  it('snaps to the grid or to another button centre line', () => {
    expect(snapPoint(101, 203, [])).toMatchObject({ x: 104, y: 200, gx: null, gy: null });
    expect(snapPoint(101, 203, [{ x: 96, y: 330 }])).toMatchObject({ x: 96, gx: 96, y: 200 });
  });
});

describe('saved touch settings', () => {
  it('load safely from damaged values', () => {
    const s = cleanTouch({
      scheme: 'warp', style: 7, size: 99, opacity: -1, sens: 'x', dead: 5, smooth: 2, labels: 'emoji', sizes: { gas: 9, 'bad key!': 1, brake: 'big' },
      pos: { 'land:gas': [2, -1], 'land:x': [NaN, 1], 'oops:gas': [0.5, 0.5], 'port:nitro': [0.1] }, slots: [{ name: 5, scheme: 'stick', pos: 'x' }, 'junk', null, { name: 'extra' }],
    });
    expect(s).toMatchObject({ scheme: 'buttons', style: 'classic', size: TOUCH.sizes[1], opacity: TOUCH.opacity[0], sens: 1, dead: TOUCH.deadRange[1], smooth: TOUCH.smooth[1], labels: 'text' });
    expect(s.sizes).toEqual({ gas: TOUCH.btnSizes[1] });
    expect(s.pos).toEqual({ 'land:gas': [1, 0] });
    expect(s.slots).toHaveLength(TOUCH.slots);
    expect(s.slots[0]).toMatchObject({ name: 'Layout 1', scheme: 'stick', pos: {} });
    expect(s.slots[1]).toBeNull();
    expect(cleanTouch(null)).toEqual(touchDefaults());
    expect(cleanTouch([1, 2])).toEqual(touchDefaults());
  });
});
