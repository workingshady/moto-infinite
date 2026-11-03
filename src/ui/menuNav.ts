// Keyboard and gamepad navigation for the menus: arrows / D-pad / left stick move a visible focus ring between
// buttons (spatial), Enter / A confirms, Esc / B goes back (or resumes from the pause menu).
// Works on the menu DOM only, so screens need no changes; focus is restored after a screen re-renders.
import { isRebinding } from './SettingsPanel';

type Dir = 'up' | 'down' | 'left' | 'right';
const FOCUSABLE = 'button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Buttons that mean "back", in order of preference. */
const BACK = ['[data-go="back"]', '[data-go="resume"]', '[data-go="garageDone"]', '[data-go="skip"]', '[data-go="home"]'];

export function initMenuNav(menu: HTMLElement) {
  let navKey = '';
  let usingNav = false;
  const visible = () => menu.style.display !== 'none' && !!menu.firstElementChild;
  const items = () => Array.from(menu.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null && !el.closest('.disabled'));
  const sig = (el: Element) => el.tagName + Object.entries((el as HTMLElement).dataset).map(([k, v]) => `${k}=${v}`).join('&') + (el.id ? '#' + el.id : '');

  const focus = (el: HTMLElement | undefined) => {
    if (!el) return;
    menu.querySelectorAll('.navfocus').forEach((x) => x.classList.remove('navfocus'));
    el.classList.add('navfocus');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    navKey = sig(el);
    usingNav = true;
  };
  const current = () => {
    const a = document.activeElement as HTMLElement | null;
    return a && menu.contains(a) && a !== menu ? a : null;
  };
  const first = () => menu.querySelector<HTMLElement>('.btn.primary:not([disabled])') ?? items()[0];

  function move(d: Dir) {
    const cur = current();
    if (!cur) return focus(first());
    const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best: HTMLElement | undefined, bd = Infinity;
    for (const el of items()) {
      if (el === cur) continue;
      const q = el.getBoundingClientRect(), x = q.left + q.width / 2, y = q.top + q.height / 2;
      const dx = x - cx, dy = y - cy;
      const main = d === 'left' ? -dx : d === 'right' ? dx : d === 'up' ? -dy : dy;
      const side = d === 'left' || d === 'right' ? Math.abs(dy) : Math.abs(dx);
      if (main <= 2) continue;
      const score = main + side * 2.2;
      if (score < bd) { bd = score; best = el; }
    }
    focus(best);
  }

  function back() {
    for (const s of BACK) {
      const b = menu.querySelector<HTMLElement>(s);
      if (b && b.offsetParent !== null) { b.click(); return true; }
    }
    return false;
  }

  addEventListener('keydown', (e) => {
    if (!visible() || isRebinding() || e.defaultPrevented) return;
    const t = e.target as HTMLElement, typing = t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox';
    if (menu.querySelector('[data-keytest]') && e.code !== 'Escape') return; // the key tester owns the keyboard
    const dir: Dir | null = e.code === 'ArrowUp' ? 'up' : e.code === 'ArrowDown' ? 'down' : e.code === 'ArrowLeft' ? 'left' : e.code === 'ArrowRight' ? 'right' : null;
    if (dir) {
      if (typing && (dir === 'left' || dir === 'right')) return;
      if (t instanceof HTMLInputElement && t.type === 'range' && (dir === 'left' || dir === 'right')) return; // sliders use ←/→
      e.preventDefault();
      move(dir);
      return;
    }
    // Esc: sub-screens go back (settings / controls opened from pause return to pause); pause itself is handled by Input
    if (e.code === 'Escape' && !menu.querySelector('.scr-pause') && back()) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);
  addEventListener('pointerdown', () => { usingNav = false; menu.querySelectorAll('.navfocus').forEach((x) => x.classList.remove('navfocus')); }, true);

  // screens re-render on every click: put the focus back on the same control
  new MutationObserver(() => {
    if (!usingNav || !navKey || !visible()) return;
    const cur = current();
    if (cur && sig(cur) === navKey) return;
    const el = items().find((x) => sig(x) === navKey);
    if (el) focus(el);
  }).observe(menu, { childList: true, subtree: true });

  // gamepad: edges on D-pad / stick / A / B, with key-repeat style auto-repeat for held directions
  let prev = { up: false, down: false, left: false, right: false, a: false, b: false };
  let repeatT = 0;
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    if (!visible() || isRebinding()) return;
    const list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    const cur = { up: false, down: false, left: false, right: false, a: false, b: false };
    for (const p of list) {
      if (!p?.connected) continue;
      const B = p.buttons, ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      cur.up ||= !!B[12]?.pressed || ay < -0.6;
      cur.down ||= !!B[13]?.pressed || ay > 0.6;
      cur.left ||= !!B[14]?.pressed || ax < -0.6;
      cur.right ||= !!B[15]?.pressed || ax > 0.6;
      cur.a ||= !!B[0]?.pressed;
      cur.b ||= !!B[1]?.pressed;
    }
    for (const d of ['up', 'down', 'left', 'right'] as Dir[]) {
      if (cur[d] && (!prev[d] || now > repeatT)) {
        repeatT = now + (prev[d] ? 110 : 380);
        const el = current();
        if (el instanceof HTMLInputElement && el.type === 'range' && (d === 'left' || d === 'right')) {
          if (d === 'left') el.stepDown(); else el.stepUp();
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else move(d);
      }
    }
    if (cur.a && !prev.a) { const el = current(); if (el) el.click(); else focus(first()); }
    if (cur.b && !prev.b) back();
    prev = cur;
  };
  requestAnimationFrame(loop);
}
