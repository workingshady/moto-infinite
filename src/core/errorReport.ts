// Client error reporting: uncaught errors, unhandled promise rejections and WebGL context loss are
// sent (de-duplicated, rate limited, without personal data) to POST /api/log. Also keeps the last
// console errors for the "Report a bug" button in the pause menu (src/ui/bugReport.ts).
import { LOG_LIMITS, ReportLimiter, reportKey, scrub, type DeviceInfo, type LogReport } from '../../shared/logReport';
import '../styles/pwa.css';

const ENDPOINT = '/api/log';
const RECENT = 12;
const recent: string[] = [];
const limiter = new ReportLimiter(5, 60_000, 25);
let installed = false;

/** The last few console errors / uncaught errors, newest last. */
export const recentErrors = () => recent.slice();

const toText = (v: unknown): string => {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
};

function remember(line: string) {
  recent.push(scrub(line).slice(0, LOG_LIMITS.errorLen));
  if (recent.length > RECENT) recent.shift();
}

/** Hashed entry-script name: identifies the deployed build without any user data. */
function buildId() {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src') ?? '';
  return src.match(/index-([\w-]+)\.js/)?.[1] ?? (import.meta.env.DEV ? 'dev' : 'unknown');
}

let gpuName: string | undefined;
function gpu(): string | undefined {
  if (gpuName !== undefined) return gpuName || undefined;
  gpuName = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) gpuName = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* no WebGL */ }
  return gpuName || undefined;
}

export function deviceInfo(withGpu = false): DeviceInfo {
  const n = navigator as Navigator & { deviceMemory?: number; standalone?: boolean };
  return {
    ua: n.userAgent, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, touch: matchMedia('(pointer: coarse)').matches, lang: n.language,
    gpu: withGpu ? gpu() : undefined, mem: n.deviceMemory, cores: n.hardwareConcurrency,
    standalone: matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || n.standalone === true,
  };
}

/** What the player is looking at (menu screen class or "game"). */
function where() {
  const menu = document.getElementById('menu');
  if (menu && menu.style.display !== 'none') return menu.querySelector('.card-wrap')?.className.match(/scr-(\w+)/)?.[1] ?? 'menu';
  return 'game';
}

/** POSTs a report. Bug reports skip de-duplication (people write them on purpose). Resolves to success. */
export async function sendReport(r: LogReport, force = false): Promise<boolean> {
  if (!force && !limiter.allow(reportKey(r))) return false;
  const body: LogReport = { ...r, build: buildId(), where: where(), device: r.device ?? deviceInfo() };
  let json = JSON.stringify(body);
  if (json.length > LOG_LIMITS.body) json = JSON.stringify({ ...body, stack: body.stack?.slice(0, 500), errors: body.errors?.slice(-3) });
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', body: json, headers: { 'Content-Type': 'application/json' }, keepalive: json.length < 60_000 });
    return res.ok;
  } catch {
    return false; // offline: nothing to do
  }
}

function onError(e: ErrorEvent) {
  const err = e.error as Error | undefined;
  const msg = e.message || toText(err) || 'Script error';
  remember(msg);
  if (msg === 'Script error.' && !e.filename) return; // cross-origin noise, nothing useful
  void sendReport({ kind: 'error', msg, stack: err?.stack, src: e.filename ? scrub(e.filename) : undefined, line: e.lineno, col: e.colno });
}

function onRejection(e: PromiseRejectionEvent) {
  const reason = e.reason as unknown;
  const msg = toText(reason) || 'Unhandled rejection';
  remember('Unhandled rejection: ' + msg);
  void sendReport({ kind: 'rejection', msg, stack: reason instanceof Error ? reason.stack : undefined });
}

// ---------------------------------------------------------------- WebGL context loss
let glOverlay: HTMLDivElement | null = null;
let glTimer = 0;

function onContextLost(e: Event) {
  if (!(e.target instanceof HTMLCanvasElement)) return;
  // the event is fired on whichever canvas lost it; only the big game view matters
  if (e.target.width * e.target.height < 200 * 200) return;
  e.preventDefault(); // allows the browser to restore it (three.js then rebuilds GPU resources)
  remember('WebGL context lost');
  void sendReport({ kind: 'webgl', msg: 'WebGL context lost', device: deviceInfo(true) });
  if (!glOverlay) {
    glOverlay = document.createElement('div');
    glOverlay.className = 'gl-lost';
    glOverlay.innerHTML = '<div class="gl-lost-card"><h2>Graphics paused</h2><p>The graphics driver reset. Trying to restore…</p><div class="gl-lost-actions" hidden><button class="btn primary">Reload game</button></div></div>';
    glOverlay.querySelector('button')!.onclick = () => location.reload();
    document.body.appendChild(glOverlay);
  }
  clearTimeout(glTimer);
  glTimer = window.setTimeout(() => {
    if (!glOverlay) return;
    glOverlay.querySelector('p')!.textContent = "The graphics couldn't be restored. Reloading is safe: your progress and settings are saved.";
    glOverlay.querySelector<HTMLElement>('.gl-lost-actions')!.hidden = false;
  }, 4000);
}

function onContextRestored() {
  clearTimeout(glTimer);
  glOverlay?.remove();
  glOverlay = null;
  remember('WebGL context restored');
}

/** Hooks global handlers once. Safe to call before the app exists. */
export function installErrorReporting() {
  if (installed) return;
  installed = true;
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    remember(args.map(toText).join(' '));
    orig(...args);
  };
  addEventListener('error', onError);
  addEventListener('unhandledrejection', onRejection);
  // context events don't bubble: listen in the capture phase to see every canvas
  addEventListener('webglcontextlost', onContextLost, true);
  addEventListener('webglcontextrestored', onContextRestored, true);
}
