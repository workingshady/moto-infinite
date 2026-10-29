# Moto Infinite

Low-poly motorbike game in the browser: endless open world with a story, circuit races, 2-player split screen and online rooms.

- **Modes:** open world (story chapters, challenges, drones, level-ups) · circuit race (5 tracks + random, 1-50 laps, ghost)
- **Players:** solo · 2 players split screen (keyboard or gamepads) · online rooms up to 8, joined by link
- **World:** 5 themes, random seeds, day/dawn/sunset/night or live cycle, clear/cloudy/rain/fog/snow/storm or changing weather
- **Combat:** 6 weapons with lead-aim assist, 3 drone types, power-ups, optional PvP

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

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Deploy

Pushing to `main` deploys via Cloudflare Workers Builds (Git integration), or run `npm run deploy` manually.
Secrets go in `.dev.vars` locally (git-ignored, see `.dev.vars.example`) and `npx wrangler secret put NAME` in production.
