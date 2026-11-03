// What kind of device we run on, and the browser features that matter on phones:
// fullscreen + orientation lock, screen wake lock, a starting quality guess.
import type { QualityName } from '../config';

export const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;
export const isCoarse = () => matchMedia('(pointer: coarse)').matches;
export const isPortrait = () => innerHeight > innerWidth;

/** First-run quality: low for software GL and modest phones, medium otherwise (the dynamic resolution scaler does the rest). */
export function autoQuality(): QualityName {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 8, cores = navigator.hardwareConcurrency || 4;
  if (softwareGl()) return 'low';
  if (isCoarse()) return mem >= 6 && cores >= 8 && devicePixelRatio <= 3 ? 'medium' : 'low';
  return mem <= 2 || cores <= 2 ? 'low' : 'medium';
}

function softwareGl() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- fullscreen + orientation
type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

export const fullscreenSupported = () => !!(document.documentElement.requestFullscreen || (document.documentElement as FsEl).webkitRequestFullscreen);
export const isFullscreen = () => !!(document.fullscreenElement || (document as FsDoc).webkitFullscreenElement);

/** Enter fullscreen and try to lock landscape (Android Chrome). Must run inside a tap. */
export async function enterFullscreen(landscape = true) {
  const el = document.documentElement as FsEl;
  try {
    if (!isFullscreen()) await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.());
  } catch {
    /* refused (iPhone Safari has no fullscreen API for pages) */
  }
  if (landscape) {
    try {
      await (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape');
    } catch {
      /* lock only works in fullscreen on some browsers */
    }
  }
}

export async function exitFullscreen() {
  const d = document as FsDoc;
  try {
    screen.orientation?.unlock?.();
  } catch {
    /* not locked */
  }
  try {
    if (isFullscreen()) await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
  } catch {
    /* already left */
  }
}

export const toggleFullscreen = () => (isFullscreen() ? exitFullscreen() : enterFullscreen());

// ---------------------------------------------------------------- wake lock
interface Sentinel { release(): Promise<void>; addEventListener(t: 'release', f: () => void): void }
type WakeNav = Navigator & { wakeLock?: { request(t: 'screen'): Promise<Sentinel> } };

/** Keeps the screen on while playing; re-acquired when the tab becomes visible again (browsers drop it on hide). */
export class WakeLock {
  private sentinel: Sentinel | null = null;
  private want = false;
  private onVis = () => {
    if (this.want && document.visibilityState === 'visible') void this.acquire();
  };

  constructor() {
    document.addEventListener('visibilitychange', this.onVis);
  }

  set(on: boolean) {
    this.want = on;
    if (on) void this.acquire();
    else this.drop();
  }

  private async acquire() {
    const wl = (navigator as WakeNav).wakeLock;
    if (!wl || this.sentinel || document.visibilityState !== 'visible') return;
    try {
      const s = await wl.request('screen');
      this.sentinel = s;
      s.addEventListener('release', () => {
        if (this.sentinel === s) this.sentinel = null;
      });
      if (!this.want) this.drop();
    } catch {
      /* denied (battery saver, no gesture yet) */
    }
  }

  private drop() {
    void this.sentinel?.release().catch(() => undefined);
    this.sentinel = null;
  }

  dispose() {
    this.set(false);
    document.removeEventListener('visibilitychange', this.onVis);
  }
}
