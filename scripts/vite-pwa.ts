// Vite plugin: emits /sw.js for the client build from scripts/sw.template.js, with a precache list taken
// from the final bundle (hashed JS/CSS/assets) plus the public/ files, and a version derived from it.
// Dev server: no service worker (src/core/pwa.ts only registers it in production builds).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

const SKIP_PUBLIC = new Set(['_headers', '_redirects', 'sw.js']);

function listFiles(dir: string, root = dir): string[] {
  let out: string[] = [];
  let names: string[];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out = out.concat(listFiles(p, root));
    else out.push(relative(root, p).split('\\').join('/'));
  }
  return out;
}

export function pwa(): Plugin {
  let publicDir = '';
  return {
    name: 'moto-pwa-sw',
    apply: 'build',
    enforce: 'post',
    applyToEnvironment: (env) => env.name === 'client',
    configResolved(c) { publicDir = c.publicDir; },
    generateBundle(_opts, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html' && f !== 'sw.js' && !f.startsWith('.'));
      const pub = listFiles(publicDir).filter((f) => !SKIP_PUBLIC.has(f) && !f.startsWith('.well-known/'));
      const precache = ['/', ...[...built, ...pub].sort().map((f) => '/' + f)];
      const html = bundle['index.html'];
      const hash = createHash('sha256').update(precache.join('\n'));
      if (html && html.type === 'asset') hash.update(String(html.source));
      const version = hash.digest('hex').slice(0, 12);
      const src = readFileSync(new URL('./sw.template.js', import.meta.url), 'utf8')
        .replace('__SW_VERSION__', version)
        .replace('= __SW_PRECACHE__;', `= ${JSON.stringify(precache)};`);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}
