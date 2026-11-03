# Moto Infinite

Low-poly motorbike game in the browser: endless open world with a story, circuit races, 2-player split screen and online rooms.

- **Modes:** open world (story chapters, challenges, drones, level-ups) · circuit race (5 tracks + random, 1-50 laps, ghost)
- **Players:** solo · 2 players split screen (keyboard or gamepads) · online rooms up to 8, joined by link
- **World:** 5 themes, random seeds, day/dawn/sunset/night or live cycle, clear/cloudy/rain/fog/snow/storm or changing weather
- **Combat:** 6 weapons with lead-aim assist, 3 drone types, power-ups, optional PvP
- **Accounts (optional):** Sign in with Google to sync career, garage, settings, touch layout and Time Attack bests across devices; signed-in leaderboard rows get a ✓. Playing without an account works as before (local saves).

**Stack:** Vite · TypeScript · Three.js · Cloudflare Workers (static assets, later Durable Objects for online rooms)

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload (runs the Worker locally too) |
| `npm run build` | Type-check + production build into `dist/` |
| `npm run preview` | Build, then serve the production build locally |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run lint` | ESLint |
| `npm run cf-typegen` | Regenerate Worker types after editing `wrangler.jsonc` |

## Controls

`↑ ↓` throttle / brake · `← →` steer · `E` get on/off · `Shift`/`Space` nitro / jump ·
`F` or click fire · `Q`/`1-3` weapon · in air: arrows flip/spin · `R` respawn · `M` mute · `H` help

Tesla Roadster: hold `Space`/`G` (pad B) = thruster lift-off and flight (↑↓ push, ←→ yaw), double-tap = hop, `C` = kickflip, `Shift` = rear thrusters (glue to steep banks). Thrust runs off a nitrogen tank (~5 s at full thrust), refilled slowly while driving, fully at gas stations or on respawn.

Online: `Enter`/`T` chat · `5-0` quick chat (pad: hold Back + d-pad) · hold `Tab` players & pings · `[` `]` spectate (pad: LB/RB)

## Google sign-in + cloud save

- Browser: Google Identity Services button (loaded only when the sign-in UI is shown) → Google ID token (JWT).
- Worker: `POST /api/auth/google` verifies the token (RS256 against Google's public keys, `iss`, `aud` = our client id, `exp`/`iat`)
  and sets an HttpOnly `moto_sid` session cookie (`Path=/api`, 60-day sliding). **No client secret, no paid service:**
  everything lives in a SQLite Durable Object per account (`worker/Account.ts`).
- Endpoints: `GET /api/me` · `POST /api/logout` · `GET/PUT /api/save` (revisioned, 409 on conflict) · `DELETE /api/account` · `POST /api/admin/unpin`.
- Privacy page: `public/privacy.html` (contact: workingshady@gmail.com).
- Details (merge rules, account switching, admin role): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#accounts-cloud-save-and-admin).

**Owner setup (Google Cloud, one time):** OAuth consent screen + a *Web application* OAuth client; its client id is in
`shared/auth.ts` (`GOOGLE_CLIENT_ID`, public). Authorized JavaScript origins: `http://localhost:5173` and the live
`https://moto-infinite.workingshady.workers.dev` (add any custom domain too). No redirect URIs and no client secret are used.
Publish the consent screen ("In production") so any Google user can sign in, with `/privacy.html` as the privacy policy URL.
`vite preview` (port 4173) is not an authorized origin: the button shows Google's error there, the game still works.

**Admins:** `ADMIN_EMAILS` in `wrangler.jsonc` `vars` (comma separated, @gmail.com only, not a secret). An account in the
list that signs in with a verified e-mail is pinned as admin by its Google `sub` (the e-mail is never stored). Removing an
address does **not** unpin the account: unpin with `POST /api/admin/unpin` (as an admin, body `{}` for yourself or
`{"uid":"<account key>"}`), or by deleting that account's cloud data. Admins get a 🎮 Regular / ⚡ Full Power switch
(home + Settings → Account): all vehicles, endless nitro, no damage, fast in-run levels for their own play; career and
leaderboards are paused while it is on, and online rooms get the unlocks only.

**Local testing:** put `DEV_AUTH=1` in `.dev.vars` (git-ignored) to enable `POST /api/auth/dev {sub, name, admin?}` and the
🧪 Dev sign-in button on `npm run dev`. The endpoint also requires a `localhost` URL, so it can't work when deployed.

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Deploy

Pushing to `main` deploys via Cloudflare Workers Builds (Git integration), or run `npm run deploy` manually.
Secrets go in `.dev.vars` locally (git-ignored, see `.dev.vars.example`) and `npx wrangler secret put NAME` in production.
