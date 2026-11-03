// Small helpers shared by the replay panel and photo mode: saving/sharing files, WebM clip capture,
// drag/pinch orbit input on the game canvas and edge-detected gamepad buttons.

/** Save a blob as a file download. */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Whether the Web Share API can send this kind of file (mostly phones). */
export function canShareFile(type: string) {
  try {
    return !!navigator.canShare?.({ files: [new File([new Blob()], 'x', { type })] });
  } catch {
    return false;
  }
}

export async function shareFile(blob: Blob, name: string, text: string) {
  try {
    await navigator.share({ files: [new File([blob], name, { type: blob.type })], title: 'Moto Infinite', text });
  } catch {
    /* cancelled or not allowed */
  }
}

export const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

/** First MediaRecorder container this browser can write from a canvas stream, or null (feature hidden). */
export function clipMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined' || !('captureStream' in HTMLCanvasElement.prototype)) return null;
  for (const t of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** Records the game canvas to a video blob. */
export class ClipRecorder {
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  private done: Promise<Blob>;

  constructor(canvas: HTMLCanvasElement, readonly mime: string, fps: number) {
    const stream = canvas.captureStream(fps);
    this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.done = new Promise((res) => {
      this.rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        res(new Blob(this.chunks, { type: mime.split(';')[0] }));
      };
    });
    this.rec.start(250);
  }

  get ext() {
    return this.mime.includes('mp4') ? 'mp4' : 'webm';
  }

  stop() {
    if (this.rec.state !== 'inactive') this.rec.stop();
    return this.done;
  }
}

/** Drag to orbit (mouse or one finger), wheel / pinch to zoom, on one element. Read the fields, then clear(). */
export class OrbitInput {
  dx = 0;
  dy = 0;
  zoom = 1;
  /** Set when the pointer went down and up without moving (a tap). */
  tapped = false;
  private pts = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private moved = 0;

  private down = (e: PointerEvent) => {
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.moved = 0;
    if (this.pts.size === 2) this.pinch = this.spread();
  };
  private move = (e: PointerEvent) => {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    if (this.pts.size === 1) {
      this.dx += e.clientX - p.x;
      this.dy += e.clientY - p.y;
      this.moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pts.size === 2) {
      const s = this.spread();
      if (this.pinch > 0 && s > 0) this.zoom *= this.pinch / s;
      this.pinch = s;
      this.moved += 10;
    }
  };
  private up = (e: PointerEvent) => {
    if (this.pts.delete(e.pointerId) && !this.pts.size && this.moved < 6) this.tapped = true;
    this.pinch = 0;
  };
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom *= 1 + Math.max(-0.3, Math.min(0.3, e.deltaY * 0.001));
  };

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.down);
    addEventListener('pointermove', this.move);
    addEventListener('pointerup', this.up);
    addEventListener('pointercancel', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
  }

  private spread() {
    let a: { x: number; y: number } | null = null, d = 0;
    for (const p of this.pts.values()) {
      if (a) d = Math.hypot(p.x - a.x, p.y - a.y);
      else a = p;
    }
    return d;
  }

  /** Call after reading dx/dy/zoom/tapped each frame. */
  clear() {
    this.dx = this.dy = 0;
    this.zoom = 1;
    this.tapped = false;
  }

  dispose() {
    this.el.removeEventListener('pointerdown', this.down);
    removeEventListener('pointermove', this.move);
    removeEventListener('pointerup', this.up);
    removeEventListener('pointercancel', this.up);
    this.el.removeEventListener('wheel', this.wheel);
  }
}

/** Polls the first connected gamepad; hit(b) is true only on the frame a button goes down. */
export class PadReader {
  pad: Gamepad | null = null;
  private prev: boolean[] = new Array<boolean>(18).fill(false);
  private now: boolean[] = new Array<boolean>(18).fill(false);

  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) { this.pad = p; break; }
    for (let i = 0; i < this.now.length; i++) {
      this.prev[i] = this.now[i];
      this.now[i] = !!this.pad?.buttons[i]?.pressed;
    }
  }

  hit(b: number) {
    return this.now[b] && !this.prev[b];
  }

  held(b: number) {
    return this.now[b];
  }

  /** Analog value of a button (triggers) or 0. */
  value(b: number) {
    return this.pad?.buttons[b]?.value ?? 0;
  }

  axis(i: number, dead = 0.18) {
    const v = this.pad?.axes[i] ?? 0;
    return Math.abs(v) < dead ? 0 : v;
  }
}
