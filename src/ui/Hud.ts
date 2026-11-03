// One HUD per local player, positioned over that player's viewport (full screen or half in split screen).
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Player } from '../entities/Player';
import { TIERS, type Card } from '../data/upgrades';
import type { Viewport } from '../core/Renderer';
import type { TrackLine } from '../world/layout';
import { WEAPONS } from '../data/weapons';
import { F1, POI_KINDS, POWERUPS, ROAD, WHEELIE, type PoiKind, type PowerupKind } from '../config';
import { prefs } from '../core/prefs';
import { showToast } from './AchievementToast';

const POI_COLOR = Object.fromEntries(POI_KINDS.map((k) => [k.kind, k.color])) as Record<PoiKind, string>;
import { clamp, escapeHtml, hex, lerpAngle, TAU } from '../utils/math';
import { fmt } from '../systems/Race';
import { Gauges } from './Gauges';
import { CAM_LABEL } from '../core/cameraViews';
import { displayBindings, keyLabel } from '../core/bindings';
import { pal, spd, speedUnit } from '../core/settings';

const TEMPLATE = `
<canvas class="lines"></canvas>
<div class="vignette" data-k="vig"></div><div class="hurtfx" data-k="hurtfx"></div><div class="flashfx" data-k="flashfx"></div>
<div class="floaters" data-k="floaters"></div><div class="reticle" data-k="reticle"><i data-k="tbar"></i></div><div class="cross" data-k="cross"></div><div class="hitmark" data-k="hitmark">✕</div>
<!-- top-left: player status, objective, leaderboard (stacked, never overlapping) -->
<div class="zone z-tl">
  <div class="panel stats">
    <div class="row"><b data-k="mode">On foot</b><span class="dim" data-k="camName"></span></div>
    <div class="row mt"><span>Health</span><span data-k="hpTxt"></span></div><div class="bar"><i class="hp" data-k="hpBar"></i></div>
    <div class="nitro-row"><div class="row"><span>Nitro</span><span data-k="nTxt"></span></div><div class="bar"><i class="nitro" data-k="nBar"></i></div></div>
    <div class="xp-row"><div class="row"><span>Level <b data-k="lvl">1</b></span><span data-k="xpTxt"></span></div><div class="bar"><i class="xp" data-k="xpBar"></i></div></div>
    <div class="row open-row"><span>Score <b data-k="score">0</b></span><span>Gems <b data-k="gems">0</b></span></div>
    <div class="row"><span data-k="weaponLbl">Weapon</span><span class="weapon" data-k="weapon"></span></div>
    <div class="row open-row"><span>Distance</span><span data-k="dist"></span></div>
    <div class="row"><span>World</span><span data-k="clock"></span></div>
    <div class="buffs" data-k="buffs"></div>
  </div>
  <div class="objective" data-k="objective"></div>
  <div class="panel tower" data-k="tower"></div>
</div>
<!-- top-centre: race position / challenge / drift score -->
<div class="zone z-tc">
  <div class="panel racebox" data-k="race"><div class="place" data-k="place"></div><div data-k="lap"></div><div class="dim" data-k="times"></div></div>
  <div class="panel challenge" data-k="ch"><div class="label">CHALLENGE</div><b data-k="cTxt"></b><div class="bar"><i class="cbar" data-k="cBar"></i></div><div data-k="cTime" class="dim"></div></div>
  <div class="driftmeter" data-k="driftm"><div class="dgauge"><i data-k="dneedle"></i></div><b data-k="driftPts"></b><span data-k="driftInfo"></span><div class="dtags" data-k="dtags"></div></div>
  <div class="camtag" data-k="camtag"></div>
</div>
<!-- top-right: map, training checklist -->
<div class="zone z-tr">
  <div class="panel mapwrap"><canvas class="minimap" width="190" height="190"></canvas></div>
  <div class="panel tut" data-k="tut"></div>
</div>
<!-- bottom-left: key help + player tag -->
<div class="zone z-bl">
  <div class="panel keycard" data-k="keycard"></div>
  <div class="ptag" data-k="tag"></div>
</div>
<!-- bottom-centre: prompts and live meters above the F1 dash -->
<div class="zone z-bc">
  <div class="panel prompt" data-k="prompt">Press <b data-k="rideKey">E</b> to ride</div>
  <div class="wmeter" data-k="wmeter"><div class="wtrack"><i class="wzone" data-k="wzone"></i><i class="wneedle" data-k="wneedle"></i></div><span data-k="wtxt"></span></div>
  <div class="upbadge" data-k="upbadge"></div>
  <div class="panel f1dash" data-k="f1dash"><div class="f1top"><b data-k="f1speed">0</b><span data-k="f1unit">km/h</span><i data-k="f1gear">N</i></div><div class="rpm"><i data-k="f1rpm"></i></div><div class="f1row"><span class="tyre" data-k="f1tyre">M</span><span data-k="f1wear">0%</span><span class="lbl">ERS</span><div class="bar ers"><i data-k="f1ers"></i></div></div><div class="f1flags"><span data-k="f1drs">DRS</span><span data-k="f1slip">SLIP</span><span data-k="f1pit">PIT 80</span></div></div>
</div>
<!-- bottom-right: speedometer + tachometer -->
<div class="zone z-br"><div class="gauges" data-k="gauges"></div></div>
<!-- centre overlays -->
<div class="banner" data-k="banner"></div>
<div class="story" data-k="story"><b data-k="storyT"></b><span data-k="storyX"></span></div>
<div class="countdown" data-k="countdown"></div>
<div class="levelup" data-k="levelup"><div class="lu-head"><b>CHOOSE AN UPGRADE</b><span data-k="luHint"></span></div><div class="cards" data-k="cards"></div></div>
<div class="lvlburst" data-k="lvlburst"><div class="rays"></div><div class="lvl-num" data-k="lvlNum"></div><div class="lvl-sub" data-k="lvlSub"></div></div>
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
  private gauges = new Gauges();
  private gaugesOn = false;

  constructor(private game: Game, private p: Player) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = TEMPLATE;
    this.root.querySelectorAll<HTMLElement>('[data-k]').forEach((el) => (this.els[el.dataset.k!] = el));
    this.mm = this.root.querySelector<HTMLCanvasElement>('.minimap')!.getContext('2d')!;
    this.lines = this.root.querySelector<HTMLCanvasElement>('.lines')!;
    this.lctx = this.lines.getContext('2d')!;
    this.els.race.style.display = game.opts.mode === 'race' || game.opts.mode === 'f1' ? '' : 'none';
    this.els.rideKey.textContent = this.key(displayBindings(p.ctrl).ride);
    this.els.f1unit.textContent = speedUnit();
    this.buildKeycard();
    this.els.gauges.appendChild(this.gauges.canvas);
    if (game.opts.locals.length > 1) {
      this.els.tag.textContent = `P${p.index + 1} · ${p.name}`;
      this.els.tag.style.color = hex(p.color);
    }
    this.root.classList.add('mode-' + game.opts.mode);
    game.hudLayer.appendChild(this.root);
  }

  /** Compact key list for this player's vehicle and bindings. */
  private buildKeycard() {
    const b = displayBindings(this.p.ctrl), k = (l: string[]) => `<kbd>${this.key(l)}</kbd>`, car = this.p.def.kind === 'car';
    const f1 = !!this.p.def.f1 && this.game.opts.mode === 'f1';
    // features with fixed keys: replay / photo locally, chat / players / quick chat / spectate online
    const extra = this.game.net ? ['<kbd>Enter</kbd> <kbd>Tab</kbd> <kbd>5</kbd>–<kbd>0</kbd> <kbd>[</kbd><kbd>]</kbd>', 'chat · players · quick chat · spectate']
      : ['<kbd>I</kbd>', 'instant replay · pause: 🎬 replay, 📷 photo'];
    const rows = f1 ? [
      [`${k(b.up)} ${k(b.down)} ${k(b.left)} ${k(b.right)}`, 'throttle · brake (~5 g) · steer'],
      [k(b.trick), 'DRS / straight mode (in DRS zones, closes when you brake)'],
      [b.nitro.filter((c) => c !== 'ShiftRight').slice(0, 2).map((c) => k([c])).join(' '), 'ERS deploy (recharges under braking)'],
      ['pit', 'drive into the pit lane, stop in the box: fresh tyres'],
      [k(b.camera), 'camera: chase · far · hood · cockpit · TV · top-down'],
      extra,
      ['<kbd>Esc</kbd> <kbd>H</kbd>', 'pause · hide this card'],
    ] : [
      [`${k(b.up)} ${k(b.down)} ${k(b.left)} ${k(b.right)}`, 'drive · brake · steer'],
      [b.nitro.filter((c) => c !== 'ShiftRight').slice(0, 3).map((c) => k([c])).join(' '), 'nitro (drives itself, no ↑ needed: if ← drops out, let go of ↑)'],
      [k(b.drift), 'handbrake → drift, counter-steer to hold'],
      car ? null : [k(b.trick), 'hold on the ground: wheelie at any speed (↑/↓ angle, no braking) · air: style trick'],
      car ? null : ['air', 'let go, then ↑↓ flip · ←→ spin'],
      [`${k(b.fire)} ${k(b.weapon)}`, 'fire · next weapon'],
      [k(b.ride), 'get on / off'],
      [k(b.camera), 'camera: chase · far · hood · first person · cinematic · top-down'],
      extra,
      ['<kbd>Esc</kbd> <kbd>H</kbd>', 'pause · hide this card'],
    ].filter(Boolean) as string[][];
    this.els.keycard.innerHTML = `<div class="label">KEYS · ${escapeHtml(this.p.def.name)}</div>` + rows.map(([a, c]) => `<div class="kr"><span>${a}</span><em>${c}</em></div>`).join('');
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
    b.innerHTML = `<span style="color:${pal(color)}">${escapeHtml(big)}</span>${small ? `<small>${escapeHtml(small)}</small>` : ''}`;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  /** Small fading "camera view" label (top centre). */
  camLabel(text: string) {
    const t = this.els.camtag;
    t.textContent = text;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
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

  /** Friendly label for a key code: ArrowUp -> ↑, ShiftLeft -> Shift, KeyF -> F. */
  private key(list: string[]) {
    return keyLabel(list[0] ?? '');
  }

  /** Non-blocking card row at the bottom: rarity colours, stack counts, reroll button. */
  showCards(cards: Card[], onPick: (i: number) => void, onReroll: () => void, rerolls: number, stacks: Record<string, number>) {
    const k = displayBindings(this.p.ctrl), picks = [k.pick1, k.pick2, k.pick3];
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
    this.els.upbadge.innerHTML = `⬆ ${pending} upgrade${pending > 1 ? 's' : ''} ready · press <kbd>${this.key(displayBindings(this.p.ctrl).upgrade)}</kbd>`;
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

    // wheelie meter: needle = angle, green band = balance point, red end = loop out
    const wl = B.wheelie;
    e.wmeter.style.display = p.riding && wl > 0.08 ? 'block' : 'none';
    if (wl > 0.08) {
      const W = WHEELIE, pct = (a: number) => (a / W.loopOut) * 100;
      e.wzone.style.left = pct(W.balance - W.perfect) + '%';
      e.wzone.style.width = pct(W.perfect * 2) + '%';
      e.wneedle.style.left = Math.min(100, pct(wl)) + '%';
      const pro = prefs.assist === 0, hint = Math.abs(wl - W.balance) < W.perfect ? ' · BALANCED' : wl > W.balance ? (pro ? ' · ↓ lower it!' : ' · ↓ lower') : ' · ↑ higher';
      e.wtxt.textContent = `WHEELIE ${B.wheelieT.toFixed(1)}s · ${Math.round(B.wheelieD)} m${hint}`;
    }
    // live drift meter (every frame so it feels responsive)
    const dr = p.drift;
    e.driftm.style.display = dr.on && dr.pts > 20 ? 'block' : 'none';
    if (dr.on) {
      e.driftPts.textContent = Math.round(dr.pts * p.driftMult).toLocaleString();
      e.driftInfo.textContent = `x${p.driftMult.toFixed(1)} · ${Math.round((dr.angle * 180) / Math.PI)}°`;
      e.dneedle.style.transform = `rotate(${clamp((dr.angle * 180) / Math.PI, 0, 90) * 2 - 90}deg)`;
      e.dtags.innerHTML = (dr.zone ? `<span class="zone">${escapeHtml(dr.zone)} x${dr.zoneMult}</span>` : '') + (p.B.close ? '<span class="close">CLOSE!</span>' : '') + (p.B.tandem ? '<span class="tandem">TANDEM</span>' : '');
    }
    // key card: shown for the first 20 s of a session, H flips it either way
    e.keycard.style.display = (g.time < 20) !== document.body.classList.contains('nohelp') && !g.tutorial ? 'block' : 'none';
    // F1 dash (every frame: speed, gear, rpm lights)
    const isF1 = g.opts.mode === 'f1' && !!p.def.f1;
    e.f1dash.style.display = isF1 ? 'block' : 'none';
    e.tower.style.display = isF1 && !!g.race ? 'block' : 'none';
    if (isF1) {
      const d = p.dash, f = p.f1;
      e.f1speed.textContent = String(Math.round(spd(Math.abs(B.v) * 3.6)));
      e.f1gear.textContent = B.v < -0.5 ? 'R' : Math.abs(B.v) < 0.5 ? 'N' : String(d.gear);
      const r = Math.min(1, d.rpm / d.redline);
      e.f1rpm.style.width = r * 100 + '%';
      e.f1rpm.className = r > 0.94 ? 'shift' : r > 0.8 ? 'high' : '';
      e.f1ers.style.width = (s.nitro / p.stats.nitroMax) * 100 + '%';
      e.f1tyre.textContent = f.compound[0].toUpperCase();
      e.f1tyre.style.borderColor = hex(F1.tyres[f.compound].color);
      e.f1wear.textContent = Math.round(f.wear * 100) + '% wear';
      e.f1drs.className = f.aeroOpen ? 'on' : '';
      e.f1drs.textContent = p.def.f1?.aero === 'active' ? (f.overtake ? 'OVERTAKE' : 'STRAIGHT') : 'NO DRS';
      e.f1slip.className = f.slip ? 'on' : '';
      e.f1pit.className = f.inPit ? 'on' : '';
      e.f1wear.textContent = Math.round(f.wear * 100) + '% wear' + (f.penalty ? ` · +${f.penalty}s` : '') + (f.limits ? ` · TL ${f.limits}/${F1.trackLimits}` : '');
    }
    // analog cluster for every vehicle except F1 cars in F1 mode (they have the F1 dash above)
    const showG = p.riding && !isF1;
    if (showG !== this.gaugesOn) {
      this.gaugesOn = showG;
      e.gauges.style.display = showG ? 'block' : 'none';
      this.root.classList.toggle('gauges-on', showG);
    }
    if (showG && !(this.root.classList.contains('split') && frame % 2)) {
      const d = p.dash, raw = spd(p.stats.top * 3.6 * 1.6), step = raw <= 200 ? 20 : raw <= 360 ? 40 : 60;
      this.gauges.draw({
        kmh: p.s.dead ? 0 : spd(speedKmh), maxKmh: Math.ceil(raw / step) * step, rpm: d.rpm, redline: d.redline,
        gear: Math.abs(B.v) < 0.5 ? 'N' : String(d.gear), reverse: B.v < -0.5,
        nitro: s.nitro / p.stats.nitroMax, boost: p.cam.boost, air: B.air ? B.airT : 0,
      }, this.root.classList.contains('split') ? dt * 2 : dt);
    }
    if (frame % 3) return;
    if (isF1 && g.race && frame % 15 === 0) {
      // timing tower: positions with gaps (metres behind converted with the leader's average speed)
      const rows = g.race.standings(), lead = rows[0], len = (g.layout as unknown as { length: number }).length, avg = 60;
      e.tower.innerHTML = '<div class="label">TIMING</div>' + rows.slice(0, 12).map((row, i) => {
        const gap = i === 0 ? 'Leader' : row.time !== null && lead.time !== null ? '+' + (row.time - lead.time).toFixed(1) + 's' : '+' + Math.max(0, ((lead.prog - row.prog) * len) / avg).toFixed(1) + 's';
        const me = row.local && row.id === String(p.index);
        return `<div class="trow ${me ? 'me' : ''}"><b>${i + 1}</b><i style="background:${hex(row.color)}"></i><span>${escapeHtml(row.name)}</span><em>${row.time !== null && i === 0 ? fmt(row.time) : gap}</em></div>`;
      }).join('');
    }
    // text (every 3rd frame)
    e.camName.textContent = '🎥 ' + CAM_LABEL[p.activeView];
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
    e.weaponLbl.textContent = g.opts.mode === 'f1' ? 'Tyres' : g.opts.mode === 'drift' ? 'Drift' : 'Weapon';
    e.weaponLbl.textContent = g.opts.mode === 'f1' ? 'Tyres' : g.opts.mode === 'drift' ? 'Drift' : 'Weapon';
    e.weapon.textContent = g.opts.mode === 'f1' ? `${p.f1.compound} tyres · ${p.f1.stops} stop${p.f1.stops === 1 ? '' : 's'}` : g.opts.mode === 'drift' ? `Drift ${p.drift.total.toLocaleString()} · best ${p.drift.best.toLocaleString()}` : WEAPONS[s.weapon].name + (p.nitroLatched ? ' · NOS ON' : '');
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
    e.prompt.style.display = !p.riding && !s.dead && Math.hypot(p.W.x - B.x, p.W.z - B.z) < (p.isCar ? 4.5 : 3.5) ? 'block' : 'none';
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
        e.tut.innerHTML = `<div class="label">TRAINING ${Math.min(tut.step, tut.steps.length)}/${tut.steps.length}</div>` +
          tut.steps.map((st, i) => i < tut.step ? `<div class="ok">✓ ${escapeHtml(st.title)}</div>`
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

  /** Static track artwork for the overview map (drawn once, reused every frame). */
  private trackArt: { canvas: HTMLCanvasElement; toM: (x: number, z: number) => [number, number] } | null = null;
  private mapH = 0;

  private minimap() {
    const g = this.game, L = g.layout as unknown as Partial<TrackLine>;
    const overview = (g.opts.mode === 'race' || g.opts.mode === 'f1') && !!L.px && !!L.n;
    if (overview) this.overviewMap(L as TrackLine);
    else this.localMap();
  }

  /** Race / F1: the whole circuit fitted in the box (north up), every car as a dot, like a TV track map. */
  private overviewMap(t: TrackLine) {
    const mm = this.mm, p = this.p, g = this.game, W = mm.canvas.width, H = mm.canvas.height;
    if (!this.trackArt) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let i = 0; i < t.n; i++) { x0 = Math.min(x0, t.px[i]); x1 = Math.max(x1, t.px[i]); z0 = Math.min(z0, t.pz[i]); z1 = Math.max(z1, t.pz[i]); }
      const pad = 14, sc = Math.min((W - pad * 2) / (x1 - x0 || 1), (H - pad * 2) / (z1 - z0 || 1)), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const toM = (x: number, z: number): [number, number] => [W / 2 + (x - cx) * sc, H / 2 + (z - cz) * sc];
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const a = c.getContext('2d')!;
      a.fillStyle = 'rgba(16,22,34,.92)';
      a.fillRect(0, 0, W, H);
      const path = (from: number, to: number) => {
        a.beginPath();
        for (let k = 0, i = from; k <= ((to - from + t.n) % t.n || t.n); k += 2, i = (from + k) % t.n) {
          const [u, v] = toM(t.px[i], t.pz[i]);
          if (k === 0) a.moveTo(u, v); else a.lineTo(u, v);
        }
      };
      a.lineCap = a.lineJoin = 'round';
      a.strokeStyle = 'rgba(0,0,0,.6)'; a.lineWidth = 7; path(0, 0); a.closePath(); a.stroke();
      a.strokeStyle = '#d7dce4'; a.lineWidth = 3.5; path(0, 0); a.closePath(); a.stroke();
      const f1 = g.layout as unknown as { drsZones?: { i0: number; i1: number }[]; pit?: { i0: number; i1: number; side: number } };
      a.strokeStyle = pal('#39c46a'); a.lineWidth = 3.5;
      for (const z of f1.drsZones ?? []) { path(z.i0, z.i1); a.stroke(); }
      if (f1.pit) {
        a.strokeStyle = pal('#3c8dff'); a.lineWidth = 2;
        a.beginPath();
        const span = (f1.pit.i1 - f1.pit.i0 + t.n) % t.n;
        for (let k = 0; k <= span; k += 2) {
          const i = (f1.pit.i0 + k) % t.n, [u, v] = toM(t.px[i] + t.tz[i] * f1.pit.side * 14, t.pz[i] - t.tx[i] * f1.pit.side * 14);
          if (k === 0) a.moveTo(u, v); else a.lineTo(u, v);
        }
        a.stroke();
      }
      // start/finish line across the track
      const [sx, sz] = toM(t.px[0], t.pz[0]);
      a.save();
      a.translate(sx, sz);
      a.rotate(Math.atan2(t.pz[1] - t.pz[0], t.px[1] - t.px[0]));
      a.fillStyle = '#fff'; a.fillRect(-1.5, -6, 3, 12);
      a.fillStyle = '#111'; a.fillRect(-1.5, -6, 3, 3); a.fillRect(-1.5, 0, 3, 3);
      a.restore();
      a.fillStyle = 'rgba(255,255,255,.75)'; a.font = 'bold 10px system-ui'; a.fillText('N ↑', 6, 13);
      this.trackArt = { canvas: c, toM };
    }
    const { canvas, toM } = this.trackArt;
    mm.clearRect(0, 0, W, H);
    mm.drawImage(canvas, 0, 0);
    // next checkpoint
    if (g.race && !p.race.finished) {
      const n = g.race.nextGate(p), [a, b] = toM(n.x, n.z);
      mm.strokeStyle = pal('#7cffb2'); mm.lineWidth = 2;
      mm.beginPath(); mm.arc(a, b, 5, 0, TAU); mm.stroke();
    }
    const car = (x: number, z: number, color: number, label?: string) => {
      const [a, b] = toM(x, z);
      mm.fillStyle = hex(color);
      mm.strokeStyle = 'rgba(0,0,0,.8)';
      mm.lineWidth = 1.5;
      mm.beginPath(); mm.arc(a, b, 3.6, 0, TAU); mm.fill(); mm.stroke();
      if (label) { mm.fillStyle = '#fff'; mm.font = 'bold 9px system-ui'; mm.fillText(label, a + 5, b - 4); }
    };
    const order = g.race ? g.race.standings() : [];
    const pos = (id: string) => { const i = order.findIndex((r) => r.id === id); return i >= 0 ? String(i + 1) : undefined; };
    g.ai?.list.forEach((r) => car(r.x, r.z, r.color, pos(r.id)));
    g.remotes?.forEach((r) => car(r.x, r.z, r.color, pos(r.id)));
    for (const o of g.players) if (o !== p) car(o.P.x, o.P.z, o.color, pos(String(o.index)));
    // me: bigger marker with heading
    const [mx, mz] = toM(p.P.x, p.P.z);
    mm.save();
    mm.translate(mx, mz);
    mm.rotate(Math.atan2(Math.cos(p.P.h), Math.sin(p.P.h)) - Math.PI / 2 + Math.PI);
    mm.fillStyle = '#ffd23f'; mm.strokeStyle = '#000'; mm.lineWidth = 1.5;
    mm.beginPath(); mm.moveTo(0, -7); mm.lineTo(5, 5); mm.lineTo(-5, 5); mm.closePath(); mm.fill(); mm.stroke();
    mm.restore();
  }

  /**
   * Open world / drift: heading-up local map (the road ahead is always up), round, with a compass "N" on the rim.
   * Screen x = −(d·left), screen y = −(d·forward): exactly what you see from behind the vehicle.
   */
  private localMap() {
    const mm = this.mm, p = this.p, g = this.game, P = p.P, W = mm.canvas.width, H = mm.canvas.height;
    const R = g.opts.mode === 'drift' ? 260 : 220, sc = W / (2 * R), cx = W / 2, cy = H * 0.6;
    this.mapH = lerpAngle(this.mapH, P.h, 0.35);
    const h = this.mapH, fx = Math.sin(h), fz = Math.cos(h), lx = Math.cos(h), lz = -Math.sin(h);
    const toM = (x: number, z: number): [number, number] => {
      const dx = x - P.x, dz = z - P.z;
      return [cx - (dx * lx + dz * lz) * sc, cy - (dx * fx + dz * fz) * sc];
    };
    mm.clearRect(0, 0, W, H);
    mm.save();
    mm.beginPath(); mm.arc(W / 2, H / 2, W / 2 - 1, 0, TAU); mm.clip();
    mm.fillStyle = 'rgba(34,58,42,.94)';
    mm.fillRect(0, 0, W, H);
    mm.lineCap = mm.lineJoin = 'round';
    mm.strokeStyle = 'rgba(0,0,0,.45)'; mm.lineWidth = Math.max(5, ROAD.asphalt * 2 * sc + 2);
    g.layout.drawRoads(mm, toM, P.x, P.z, R * 1.5);
    mm.strokeStyle = '#d8dde4'; mm.lineWidth = Math.max(3, ROAD.asphalt * 2 * sc);
    g.layout.drawRoads(mm, toM, P.x, P.z, R * 1.5);
    const inMap = (a: number, b: number) => (a - W / 2) ** 2 + (b - H / 2) ** 2 < (W / 2) ** 2;
    for (const poi of g.chunks.pois) {
      const [a, b] = toM(poi.x, poi.z);
      if (!inMap(a, b)) continue;
      mm.fillStyle = POI_COLOR[poi.kind]; mm.strokeStyle = 'rgba(0,0,0,.7)'; mm.lineWidth = 1.5;
      mm.fillRect(a - 4, b - 4, 8, 8); mm.strokeRect(a - 4, b - 4, 8, 8);
    }
    for (const r of g.terrain.ramps) { const [a, b] = toM(r.x, r.z); if (inMap(a, b)) { mm.fillStyle = '#f2a33a'; mm.fillRect(a - 2.5, b - 2.5, 5, 5); } }
    g.entities.forEachVisible((en) => {
      const [a, b] = toM(en.x, en.z);
      if (!inMap(a, b)) return;
      if (en.type === 'gem') { mm.fillStyle = '#46e3ff'; mm.fillRect(a - 1.5, b - 1.5, 3, 3); }
      else { mm.fillStyle = en.type === 'drone' ? pal('#ff3355') : '#ffd23f'; mm.beginPath(); mm.arc(a, b, 3.5, 0, TAU); mm.fill(); }
    });
    const dot = (x: number, z: number, color: number) => { const [a, b] = toM(x, z); if (!inMap(a, b)) return; mm.fillStyle = hex(color); mm.strokeStyle = '#000'; mm.lineWidth = 1.5; mm.beginPath(); mm.arc(a, b, 4, 0, TAU); mm.fill(); mm.stroke(); };
    for (const o of g.players) if (o !== p) dot(o.P.x, o.P.z, o.color);
    g.remotes?.forEach((r) => dot(r.x, r.z, r.color));
    g.ai?.list.forEach((r) => dot(r.x, r.z, r.color));
    if (!p.riding) dot(p.B.x, p.B.z, 0x4d8dff); // where you parked
    mm.restore();
    // me: fixed arrow pointing up
    mm.fillStyle = '#ffd23f'; mm.strokeStyle = '#000'; mm.lineWidth = 1.5;
    mm.beginPath(); mm.moveTo(cx, cy - 8); mm.lineTo(cx + 6, cy + 6); mm.lineTo(cx, cy + 3); mm.lineTo(cx - 6, cy + 6); mm.closePath(); mm.fill(); mm.stroke();
    // compass: "N" on the rim where north (-z in world) lies
    const [nx, nz] = toM(P.x, P.z - 10000), ang = Math.atan2(nz - cy, nx - cx), rr = W / 2 - 10;
    mm.fillStyle = '#ff5a6a'; mm.font = 'bold 11px system-ui'; mm.textAlign = 'center'; mm.textBaseline = 'middle';
    mm.fillText('N', W / 2 + Math.cos(ang) * rr, H / 2 + Math.sin(ang) * rr);
    mm.textAlign = 'start'; mm.textBaseline = 'alphabetic';
    mm.strokeStyle = 'rgba(255,255,255,.25)'; mm.lineWidth = 2;
    mm.beginPath(); mm.arc(W / 2, H / 2, W / 2 - 1, 0, TAU); mm.stroke();
  }

  /** Corner toast (achievements, career level-ups). */
  toast(icon: string, title: string, sub: string, label?: string) {
    showToast(this.root, icon, title, sub, label);
  }

  dispose() {
    this.root.remove();
  }
}
