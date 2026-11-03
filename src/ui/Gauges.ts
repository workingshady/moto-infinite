// Analog instrument cluster drawn on one small canvas: speedometer, tachometer with redline and gear,
// nitro ring and warning lights. Dial faces are cached; each frame only redraws needles, arcs and text.
import { clamp } from '../utils/math';
import { speedUnit } from '../core/settings';

const W = 236, H = 150;
const A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5; // 7:30 o'clock round to 4:30
const SP = { x: 76, y: 78, r: 66 }, TA = { x: 186, y: 94, r: 44 };

export interface GaugeState {
  kmh: number; maxKmh: number; rpm: number; redline: number; gear: string;
  nitro: number; boost: number; air: number; reverse: boolean;
  /** Ring label (default NITRO; the Roadster shows its nitrogen tank as N2). */
  nitroLabel?: string;
}

export class Gauges {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private face = document.createElement('canvas');
  private faceKey = '';
  private dpr = Math.min(2, devicePixelRatio || 1);
  private needle = { kmh: 0, rpm: 0 };

  constructor() {
    this.canvas.className = 'gcanvas';
    this.canvas.width = this.face.width = Math.round(W * this.dpr);
    this.canvas.height = this.face.height = Math.round(H * this.dpr);
    this.ctx = this.canvas.getContext('2d')!;
  }

  draw(s: GaugeState, dt: number) {
    const maxRpm = Math.ceil((s.redline * 1.08) / 1000) * 1000;
    const key = `${s.maxKmh}|${maxRpm}|${s.redline}`;
    if (key !== this.faceKey) { this.faceKey = key; this.drawFace(s.maxKmh, maxRpm, s.redline); }
    const n = this.needle, k = 1 - Math.exp(-dt * 14);
    n.kmh += (s.kmh - n.kmh) * k;
    n.rpm += (s.rpm - n.rpm) * k;
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.face, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.lineCap = 'round';

    // ---- speedometer: rim progress, nitro ring, needle, digital readout
    const sf = clamp(n.kmh / s.maxKmh, 0, 1), boosting = s.boost > 0.25;
    this.arc(SP, SP.r - 3, 0, sf, 4, boosting ? '#7fe6ff' : '#ffd23f');
    this.arc(SP, SP.r - 33, 0, 1, 5, 'rgba(255,255,255,.08)');
    if (boosting) { c.shadowColor = '#3cc8ff'; c.shadowBlur = 10 + s.boost * 8; }
    this.arc(SP, SP.r - 33, 0, clamp(s.nitro, 0, 1), 5, s.nitro < 0.15 ? '#ff4d5e' : '#3cc8ff');
    c.shadowBlur = 0;
    this.needleAt(SP, sf, 37, SP.r - 6, '#ff3b4e', 3);
    c.textAlign = 'center';
    c.fillStyle = '#fff';
    c.font = '900 25px system-ui, sans-serif';
    c.fillText(String(Math.round(s.kmh)), SP.x, SP.y + 7);
    c.font = '700 9px system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,.6)';
    c.fillText(speedUnit(), SP.x, SP.y + 20);
    c.fillStyle = boosting ? '#7fe6ff' : 'rgba(127,230,255,.85)';
    c.font = '800 9px system-ui, sans-serif';
    c.fillText(`${s.nitroLabel ?? 'NITRO'} ${Math.round(s.nitro * 100)}%`, SP.x, SP.y + 50);

    // ---- tachometer: rpm arc coloured by load, needle, gear
    const rf = clamp(n.rpm / maxRpm, 0, 1), red = s.redline / maxRpm, hot = n.rpm > s.redline * 0.94;
    this.arc(TA, TA.r - 3, 0, rf, 4, hot ? '#ff3b4e' : rf > red * 0.8 ? '#ffa53f' : '#e8eef8');
    this.needleAt(TA, rf, 14, TA.r - 6, hot ? '#ff3b4e' : '#ffd23f', 2.5);
    c.fillStyle = hot ? '#ff3b4e' : '#fff';
    c.font = '900 22px system-ui, sans-serif';
    c.fillText(s.reverse ? 'R' : s.gear, TA.x, TA.y + 8);
    c.font = '700 8px system-ui, sans-serif';
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.fillText('rpm ×1000', TA.x, TA.y + 34);

    // ---- warning lights
    this.light(150, 6, 'NOS', boosting, '#3cc8ff');
    this.light(194, 6, s.air > 0 ? `AIR ${s.air.toFixed(1)}` : 'AIR', s.air > 0, '#ffd23f');
  }

  private arc(o: { x: number; y: number }, r: number, f0: number, f1: number, w: number, color: string) {
    if (f1 <= f0) return;
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = w;
    c.beginPath();
    c.arc(o.x, o.y, r, A0 + SWEEP * f0, A0 + SWEEP * f1);
    c.stroke();
  }

  private needleAt(o: { x: number; y: number }, f: number, r0: number, r1: number, color: string, w: number) {
    const c = this.ctx, a = A0 + SWEEP * f, ca = Math.cos(a), sa = Math.sin(a);
    c.strokeStyle = color;
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(o.x + ca * r0, o.y + sa * r0);
    c.lineTo(o.x + ca * r1, o.y + sa * r1);
    c.stroke();
  }

  private light(x: number, y: number, label: string, on: boolean, color: string) {
    const c = this.ctx, w = 40, h = 14;
    c.fillStyle = on ? color : 'rgba(255,255,255,.08)';
    c.beginPath();
    c.moveTo(x + 7, y); c.arcTo(x + w, y, x + w, y + h, 7); c.arcTo(x + w, y + h, x, y + h, 7); c.arcTo(x, y + h, x, y, 7); c.arcTo(x, y, x + w, y, 7);
    c.fill();
    c.fillStyle = on ? '#001522' : 'rgba(255,255,255,.35)';
    c.font = '900 8px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText(label, x + w / 2, y + 10);
  }

  /** Static dial faces: discs, tick marks, numbers, redline band. */
  private drawFace(maxKmh: number, maxRpm: number, redline: number) {
    const c = this.face.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.face.width, this.face.height);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const disc = (o: { x: number; y: number; r: number }) => {
      const gr = c.createRadialGradient(o.x, o.y - o.r * 0.3, o.r * 0.1, o.x, o.y, o.r + 4);
      gr.addColorStop(0, 'rgba(30,38,58,.92)');
      gr.addColorStop(1, 'rgba(8,11,20,.9)');
      c.fillStyle = gr;
      c.beginPath();
      c.arc(o.x, o.y, o.r + 4, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,.16)';
      c.lineWidth = 1.5;
      c.stroke();
    };
    const ticks = (o: { x: number; y: number; r: number }, max: number, step: number, label: (v: number) => string, font: number, redFrom = Infinity) => {
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `800 ${font}px system-ui, sans-serif`;
      const minor = step / 2;
      for (let v = 0; v <= max + 1e-6; v += minor) {
        const major = Math.abs(v / step - Math.round(v / step)) < 1e-6, a = A0 + SWEEP * (v / max), ca = Math.cos(a), sa = Math.sin(a);
        const r1 = o.r - 8, r0 = r1 - (major ? 7 : 4);
        c.strokeStyle = v >= redFrom ? '#ff4d5e' : major ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.4)';
        c.lineWidth = major ? 2 : 1;
        c.beginPath();
        c.moveTo(o.x + ca * r0, o.y + sa * r0);
        c.lineTo(o.x + ca * r1, o.y + sa * r1);
        c.stroke();
        if (major) {
          const rl = r0 - font * 0.9;
          c.fillStyle = v >= redFrom ? '#ff7a86' : 'rgba(255,255,255,.75)';
          c.fillText(label(v), o.x + ca * rl, o.y + sa * rl);
        }
      }
      c.textBaseline = 'alphabetic';
    };
    disc(SP);
    disc(TA);
    const sStep = maxKmh <= 200 ? 20 : maxKmh <= 360 ? 40 : 60;
    ticks(SP, maxKmh, sStep, (v) => String(v), 9);
    // redline band on the tach rim
    const red = redline / maxRpm;
    c.strokeStyle = 'rgba(255,59,78,.75)';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(TA.x, TA.y, TA.r - 3, A0 + SWEEP * red, A0 + SWEEP);
    c.stroke();
    const rStep = maxRpm <= 10000 ? 1000 : 2000;
    ticks(TA, maxRpm, rStep, (v) => String(v / 1000), 8, redline);
  }
}
