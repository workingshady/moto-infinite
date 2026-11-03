// Cloudflare Worker: serves /api/* routes. Static game files are served by the assets layer.
import { ROOM_CODE_RE } from '../shared/protocol';
import { handleLeaderboard } from './Leaderboard';
import { handleLog } from './log';
import { handleAuth } from './auth';

export { Room } from './Room';
export { Leaderboard } from './Leaderboard';
export { Account } from './Account';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/log') return handleLog(request);

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, version: env.APP_VERSION ?? 'dev' });
    }

    if (url.pathname.startsWith('/api/lb/')) return handleLeaderboard(request, env, url);

    const auth = await handleAuth(request, env, url);
    if (auth) return auth;

    // /api/room/ABCDE -> WebSocket into that room's Durable Object
    const m = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]+)$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!ROOM_CODE_RE.test(code)) return new Response('Bad room code', { status: 400 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
