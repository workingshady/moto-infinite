// Cloudflare Worker: serves /api/* routes. Static game files are served by the assets layer.
// Multiplayer rooms will live here as a Durable Object (see docs/ARCHITECTURE.md).

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, version: env.APP_VERSION ?? 'dev' });
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
