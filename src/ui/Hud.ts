// One HUD per local player, positioned over that player's viewport (full screen or half in split screen).
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import { TIERS, type Card } from '../data/upgrades';
import type { Viewport } from '../core/Renderer';
import { WEAPONS } from '../data/weapons';
import { POI_KINDS, POWERUPS, type PoiKind, type PowerupKind } from '../config';

const POI_COLOR = Object.fromEntries(POI_KINDS.map((k) => [k.kind, k.color])) as Record<PoiKind, string>;
import { clamp, escapeHtml, hex, TAU } from '../utils/math';
import { fmt } from '../systems/Race';
import { STEPS } from '../systems/Tutorial';

const TEMPLATE = `
<canvas class="lines"></canvas>
<div class="vignette" data-k="vig"></div><div class="hurtfx" data-k="hurtfx"></div><div class="flashfx" data-k="flashfx"></div>
<div class="floaters" data-k="floaters"></div><div class="reticle" data-k="reticle"><i data-k="tbar"></i></div><div class="cross" data-k="cross"></div><div class="hitmark" data-k="hitmark">✕</div>
<div class="panel stats">
  <div class="row"><span><span class="big" data-k="speed">0</span> km/h</span><span data-k="mode">On foot</span></div>
  <div class="row mt"><span>Health</span><span data-k="hpTxt"></span></div><div class="bar"><i class="hp" data-k="hpBar"></i></div>
  <div class="row"><span>Nitro</span><span data-k="nTxt"></span></div><div class="bar"><i class="nitro" data-k="nBar"></i></div>
  <div class="row"><span>Level <b data-k="lvl">1</b></span><span data-k="xpTxt"></span></div><div class="bar"><i class="xp" data-k="xpBar"></i></div>
  <div class="row"><span>Score <b data-k="score">0</b></span><span>Gems <b data-k="gems">0</b></span></div>
  <div class="row"><span>Weapon</span><span class="weapon" data-k="weapon"></span></div>
  <div class="row"><span>Distance</span><span data-k="dist"></span></div>
  <div class="row"><span>World</span><span data-k="clock"></span></div>
  <div class="buffs" data-k="buffs"></div>
</div>
<div class="panel challenge" data-k="ch"><div class="label">CHALLENGE</div><b data-k="cTxt"></b><div class="bar"><i class="cbar" data-k="cBar"></i></div><div data-k="cTime" class="dim"></div></div>
<div class="panel racebox" data-k="race"><div class="place" data-k="place"></div><div data-k="lap"></div><div class="dim" data-k="times"></div></div>
<div class="panel tut" data-k="tut"></div>
<div class="panel mapwrap"><canvas class="minimap" width="160" height="160"></canvas></div>
<div class="panel prompt" data-k="prompt">Press <b data-k="rideKey">E</b> to ride</div>
<div class="banner" data-k="banner"></div>
<div class="story" data-k="story"><b data-k="storyT"></b><span data-k="storyX"></span></div>
<div class="objective" data-k="objective"></div>
<div class="countdown" data-k="countdown"></div>
<div class="levelup" data-k="levelup"><div class="lu-head"><b>CHOOSE AN UPGRADE</b><span data-k="luHint"></span></div><div class="cards" data-k="cards"></div></div>
<div class="upbadge" data-k="upbadge"></div>
<div class="lvlburst" data-k="lvlburst"><div class="rays"></div><div class="lvl-num" data-k="lvlNum"></div><div class="lvl-sub" data-k="lvlSub"></div></div>
<div class="ptag" data-k="tag"></div>
`;

type Els = Record<string, HTMLElement>;

export class Hud {
  readonly root: HTMLDivElement;
  private els: Els = {};
  private mm: CanvasRenderingContext2D;
  private lines: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private linesDrawn = false;
  private floaters: { el: HTMLDivElement; p: THREE.Vector3; t: number }[] = [];
  private flashA = 0;
  private hurtA = 0;
  private rect: Viewport = { x: 0, y: 0, w: innerWidth, h: innerHeight };
  private _v = new THREE.Vector3();
  private tutKey = '';

  constructor(private game: Game, private p: Player) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = TEMPLATE;
    this.root.querySelectorAll<HTMLElement>('[data-k]').forEach((el) => (this.els[el.dataset.k!] = el));
    this.mm = this.root.querySelector<HTMLCanvasElement>('.minimap')!.getContext('2d')!;
    this.lines = this.root.querySelector<HTMLCanvasElement>('.lines')!;
    this.lctx = this.lines.getContext('2d')!;
    this.els.race.style.display = game.opts.mode === 'race' ? '' : 'none';
    this.els.rideKey.textContent = p.ctrl.bindings.ride[0].replace('Key', '');
    if (game.opts.locals.length > 1) {
      this.els.tag.textContent = `P${p.index + 1} · ${p.name}`;
      this.els.tag.style.color = hex(p.color);
    }
    game.hudLayer.appendChild(this.root);
  }

  setRect(vp: Viewport, split: boolean) {
    this.rect = vp;
    Object.assign(this.root.style, { left: vp.x + 'px', top: vp.y + 'px', width: vp.w + 'px', height: vp.h + 'px' });
    this.root.classList.toggle('split', split);
    this.lines.width = vp.w;
    this.lines.height = vp.h;
    this.linesDrawn = true;
  }

  banner(big: string, small = '', color = '#ffd23f') {
    const b = this.els.banner;
    b.innerHTML = `<span style="color:${color}">${escapeHtml(big)}</span>${small ? `<small>${escapeHtml(small)}</small>` : ''}`;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  countdown(text: string) {
    const c = this.els.countdown;
    c.textContent = text;
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
  }

  float(txt: string, x: number, y: number, z: number, color = '#fff', size = 18) {
    if (this.floaters.length > 30) return;
    const el = document.createElement('div');
    el.textContent = txt;
    el.style.color = color;
    el.style.fontSize = size + 'px';
    this.els.floaters.appendChild(el);
    this.floaters.push({ el, p: new THREE.Vector3(x, y, z), t: 0 });
  }

  flash(color: string, a: number) {
    this.els.flashfx.style.background = color;
    this.flashA = a;
  }

  /** Chapter card that slides in, then stays as a one-line objective. */
  story(title: string, text: string) {
    const e = this.els;
    e.storyT.textContent = title;
    e.storyX.textContent = text;
    e.story.classList.remove('show');
    void e.story.offsetWidth;
    e.story.classList.add('show');
    e.objective.textContent = '▸ ' + text;
  }

  hitMarker(kill: boolean) {
    const h = this.els.hitmark;
    h.classList.toggle('kill', kill);
    h.classList.remove('show');
    void h.offsetWidth;
    h.classList.add('show');
    this.game.audio.play('hitmark');
  }

  hurt() {
    this.hurtA = Math.min(0.9, this.hurtA + 0.5);
  }

  private key(list: string[]) {
    return (list[0] ?? '').replace('Digit', '').replace('Numpad', 'Num').replace('Key', '').replace('Backslash', '\\').replace('BracketRight', ']');
  }

  /** Non-blocking card row at the bottom: rarity colours, stack counts, reroll button. */
  showCards(cards: Card[], onPick: (i: number) => void, onReroll: () => void, rerolls: number, stacks: Record<string, number>) {
    const k = this.p.ctrl.bindings, picks = [k.pick1, k.pick2, k.pick3];
    this.els.cards.innerHTML = cards.map((c, i) => {
      const t = TIERS[c.tier], n = stacks[c.u.id] ?? 0;
      return `<button class="card tier${c.tier}" data-i="${i}" style="--tier:${t.color};animation-delay:${i * 0.08}s">
        <div class="rarity">${t.name}</div><div class="icon">${c.u.icon}</div><div class="t">${escapeHtml(c.u.title)}</div>
        <div class="d">${escapeHtml(c.u.desc(t.mul))}</div><div class="stack">${'●'.repeat(n)}${'○'.repeat(Math.max(0, c.u.max - n))}</div><kbd>${this.key(picks[i])}</kbd></button>`;
    }).join('') + `<button class="card reroll" ${rerolls > 0 ? '' : 'disabled'}><div class="icon">🎲</div><div class="t">Reroll</div><div class="d">${rerolls} left</div><kbd>${this.key(k.reroll)}</kbd></button>`;
    this.els.cards.querySelectorAll<HTMLButtonElement>('.card[data-i]').forEach((b) => (b.onclick = () => onPick(+b.dataset.i!)));
    this.els.cards.querySelector<HTMLButtonElement>('.card.reroll')!.onclick = onReroll;
    this.els.luHint.textContent = `${this.key(k.upgrade)} = later`;
    this.els.levelup.style.display = 'flex';
    this.els.upbadge.style.display = 'none';
    this.root.classList.add('cards-open');
  }

  /** Cards put away: show a small "upgrade ready" badge instead. */
  foldCards(pending: number) {
    this.els.levelup.style.display = 'none';
    this.els.upbadge.style.display = pending > 0 ? 'block' : 'none';
    this.root.classList.remove('cards-open');
    this.els.upbadge.innerHTML = `⬆ ${pending} upgrade${pending > 1 ? 's' : ''} ready · press <kbd>${this.key(this.p.ctrl.bindings.upgrade)}</kbd>`;
  }

  hideCards() {
    this.foldCards(0);
  }

  /** Big animated "LEVEL n" badge with rays + XP bar shine. */
  levelUp(level: number, sub: string) {
    const e = this.els;
    e.lvlNum.textContent = `LEVEL ${level}`;
    e.lvlSub.textContent = sub || '+25% health · nitro refilled';
    for (const el of [e.lvlburst, e.xpBar]) {
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    }
  }

  private project(x: number, y: number, z: number) {
    const v = this._v.set(x, y, z).project(this.p.camera);
    return { x: (v.x * 0.5 + 0.5) * this.rect.w, y: (-v.y * 0.5 + 0.5) * this.rect.h, visible: v.z < 1 };
  }

  update(dt: number, frame: number) {
    const p = this.p, s = p.s, B = p.B, e = this.els, g = this.game;
    // screen effects (every frame, cheap)
    const speedKmh = Math.abs(B.v) * 3.6;
    this.speedLines(p.riding ? Math.min(1, clamp((speedKmh - 95) / 90, 0, 1) * 0.7 + p.cam.boost * 0.7) : 0);
    e.vig.style.opacity = (p.cam.boost * 0.85).toFixed(3);
    this.hurtA = Math.max(0, this.hurtA - dt * 1.2);
    e.hurtfx.style.opacity = Math.max(this.hurtA, s.hp < 30 && !s.dead ? 0.25 + Math.sin(g.time * 6) * 0.15 : 0).toFixed(3);
    this.flashA = Math.max(0, this.flashA - dt * 2.5);
    e.flashfx.style.opacity = this.flashA.toFixed(3);
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      const q = this.project(f.p.x, f.p.y + f.t * 2, f.p.z);
      if (f.t > 1.1 || !q.visible) { f.el.remove(); this.floaters.splice(i, 1); continue; }
      f.el.style.transform = `translate(${q.x}px,${q.y}px) translate(-50%,-50%)`;
      f.el.style.opacity = String(1 - Math.max(0, f.t - 0.6) * 2);
    }
    const ret = e.reticle, t = p.aimTarget;
    if (t) {
      const q = this.project(t.x, t.y + (t.type === 'drone' ? 0 : 0.8), t.z);
      ret.style.display = q.visible ? 'block' : 'none';
      ret.style.transform = `translate(${q.x}px,${q.y}px) translate(-50%,-50%)`;
      e.tbar.style.width = Math.max(0, (t.hp / t.maxHp) * 100) + '%';
      e.tbar.style.display = t.maxHp > 1 ? '' : 'none';
      e.cross.style.display = 'none';
    } else {
      ret.style.display = 'none';
      // free-aim crosshair where shots go when nothing is locked
      const P = p.P, q = this.project(P.x + Math.sin(P.h) * 40, P.y + (p.riding ? 2.1 : 1.6), P.z + Math.cos(P.h) * 40);
      e.cross.style.display = q.visible && !s.dead ? 'block' : 'none';
      e.cross.style.transform = `translate(${q.x}px,${q.y}px) translate(-50%,-50%)`;
    }

    if (frame % 3) return;
    // text (every 3rd frame)
    e.speed.textContent = String(Math.round(p.riding ? speedKmh : 0));
    e.mode.textContent = s.dead ? 'Wrecked' : p.riding ? (B.air ? `Airborne ${B.airT.toFixed(1)}s` : p.cam.boost > 0.3 ? 'NITRO!' : 'Riding') : 'On foot';
    e.hpTxt.textContent = Math.ceil(s.hp) + ' / ' + Math.round(p.stats.hpMax);
    e.hpBar.style.width = (s.hp / p.stats.hpMax) * 100 + '%';
    e.nTxt.textContent = String(Math.floor(s.nitro));
    e.nBar.style.width = (s.nitro / p.stats.nitroMax) * 100 + '%';
    e.lvl.textContent = String(s.level);
    e.xpTxt.textContent = s.xp + ' / ' + p.xpNeed();
    e.xpBar.style.width = (s.xp / p.xpNeed()) * 100 + '%';
    e.score.textContent = s.score + (s.combo > 1 ? ` (x${s.combo})` : '');
    e.gems.textContent = String(s.gems);
    e.weapon.textContent = WEAPONS[s.weapon].name + (p.nitroLatched ? ' · NOS ON' : '');
    e.dist.textContent = (s.dist / 1000).toFixed(2) + ' km';
    e.clock.textContent = g.env.label;
    e.buffs.innerHTML = (Object.keys(p.buffs) as PowerupKind[])
      .filter((k) => p.buffs[k] > 0)
      .map((k) => `<span style="background:${hex(POWERUPS[k].color)}">${POWERUPS[k].label} ${Math.ceil(p.buffs[k])}s</span>`)
      .join('');
    const c = p.challenges?.active;
    if (c && !c.done) {
      e.ch.style.display = 'block';
      e.cTxt.textContent = c.def.text(c.n);
      e.cBar.style.width = Math.min(100, (c.prog / c.n) * 100) + '%';
      e.cTime.textContent = (c.def.fmt ? c.def.fmt(c.prog) : Math.floor(c.prog)) + ' · ' + Math.ceil(c.t) + 's left' + (p.challenges!.streak > 1 ? ` · streak x${p.challenges!.streak}` : '');
    } else e.ch.style.display = 'none';
    e.prompt.style.display = !p.riding && !s.dead && Math.hypot(p.W.x - B.x, p.W.z - B.z) < 3.5 ? 'block' : 'none';
    const race = g.race;
    if (race) {
      const r = p.race, total = race.standings().length;
      e.place.textContent = `P${r.place}/${total}`;
      e.lap.textContent = r.finished ? 'FINISHED' : `Lap ${Math.max(1, Math.min(r.lap, race.laps))}/${race.laps}`;
      const cur = race.started && !r.finished ? g.time - r.lapStart : 0;
      e.times.innerHTML = `${r.finished ? fmt(r.finishTime) : fmt(cur)}<br>best ${r.best ? fmt(r.best) : '--'}${race.bestLap() ? ` · ghost ${fmt(race.bestLap())}` : ''}`;
    }
    const tut = g.tutorial;
    e.tut.style.display = tut ? 'block' : 'none';
    if (tut) {
      const key = tut.complete ? 'done' : String(tut.step);
      if (key !== this.tutKey) {
        this.tutKey = key;
        e.tut.innerHTML = `<div class="label">TRAINING ${Math.min(tut.step, STEPS.length)}/${STEPS.length}</div>` +
          STEPS.map((st, i) => i < tut.step ? `<div class="ok">✓ ${escapeHtml(st.title)}</div>`
            : i === tut.step ? `<div class="cur"><b>▸ ${escapeHtml(st.title)}</b><kbd>${escapeHtml(st.keys)}</kbd><span>${escapeHtml(st.hint)}</span></div>`
            : `<div class="todo">${escapeHtml(st.title)}</div>`).join('') +
          (tut.complete ? '<div class="cur"><b>🏁 All done!</b><span>Free ride: challenges are live now.</span></div>' : '');
      }
    }
    if (frame % 6 === 0) this.minimap();
  }

  private speedLines(intensity: number) {
    const c = this.lctx, W = this.lines.width, H = this.lines.height;
    if (intensity < 0.03) {
      if (this.linesDrawn) { c.clearRect(0, 0, W, H); this.linesDrawn = false; }
      return;
    }
    c.clearRect(0, 0, W, H);
    this.linesDrawn = true;
    const cx = W / 2, cy = H * 0.45, R = Math.hypot(cx, cy);
    c.lineCap = 'round';
    for (let i = 0; i < Math.round(70 * intensity); i++) {
      const a = Math.random() * TAU, r1 = R * (0.42 + Math.random() * 0.35), r2 = r1 + R * (0.08 + Math.random() * 0.25) * intensity;
      c.strokeStyle = `rgba(255,255,255,${(0.12 + Math.random() * 0.3) * intensity})`;
      c.lineWidth = 1 + Math.random() * 2.2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      c.stroke();
    }
  }

  private minimap() {
    const mm = this.mm, p = this.p, g = this.game, P = p.P, W2 = 160, R = g.opts.mode === 'race' ? 320 : 200, sc = W2 / (2 * R);
    mm.clearRect(0, 0, W2, W2);
    mm.fillStyle = 'rgba(40,70,45,.9)';
    mm.fillRect(0, 0, W2, W2);
    const toM = (x: number, z: number): [number, number] => [W2 / 2 - (x - P.x) * sc, W2 / 2 - (z - P.z) * sc];
    mm.strokeStyle = '#d8d8d8';
    mm.lineWidth = 3;
    g.layout.drawRoads(mm, toM, P.x, P.z, R);
    g.entities.forEachVisible((en) => {
      const [a, b] = toM(en.x, en.z);
      if (a < 0 || b < 0 || a > W2 || b > W2) return;
      if (en.type === 'gem') { mm.fillStyle = '#46e3ff'; mm.fillRect(a - 1.5, b - 1.5, 3, 3); }
      else { mm.fillStyle = en.type === 'drone' ? '#ff3355' : '#ffd23f'; mm.beginPath(); mm.arc(a, b, 3.5, 0, TAU); mm.fill(); }
    });
    for (const poi of g.chunks.pois) {
      const [a, b] = toM(poi.x, poi.z);
      if (a < -6 || b < -6 || a > W2 + 6 || b > W2 + 6) continue;
      mm.fillStyle = POI_COLOR[poi.kind];
      mm.fillRect(a - 4, b - 4, 8, 8);
      mm.strokeStyle = 'rgba(0,0,0,.7)';
      mm.lineWidth = 1.5;
      mm.strokeRect(a - 4, b - 4, 8, 8);
    }
    for (const r of g.terrain.ramps) { const [a, b] = toM(r.x, r.z); mm.fillStyle = '#f2a33a'; mm.fillRect(a - 2.5, b - 2.5, 5, 5); }
    if (g.race && !p.race.finished) {
      const n = g.race.nextGate(p), [a, b] = toM(n.x, n.z);
      mm.strokeStyle = '#7cffb2';
      mm.lineWidth = 2;
      mm.beginPath();
      mm.arc(clamp(a, 6, W2 - 6), clamp(b, 6, W2 - 6), 5, 0, TAU);
      mm.stroke();
    }
    const dot = (x: number, z: number, color: number) => { const [a, b] = toM(x, z); mm.fillStyle = hex(color); mm.beginPath(); mm.arc(a, b, 4, 0, TAU); mm.fill(); };
    for (const o of g.players) if (o !== p) dot(o.P.x, o.P.z, o.color);
    g.remotes?.forEach((r) => dot(r.x, r.z, r.color));
    if (!p.riding) dot(p.B.x, p.B.z, 0x4d8dff);
    mm.save();
    mm.translate(W2 / 2, W2 / 2);
    mm.rotate(-P.h);
    mm.fillStyle = '#ffd23f';
    mm.beginPath();
    mm.moveTo(0, -7); mm.lineTo(5, 6); mm.lineTo(-5, 6);
    mm.closePath();
    mm.fill();
    mm.restore();
    mm.fillStyle = 'rgba(255,255,255,.7)';
    mm.font = 'bold 10px system-ui';
    mm.fillText('N', W2 / 2 - 3, 11);
  }

  dispose() {
    this.root.remove();
  }
}
