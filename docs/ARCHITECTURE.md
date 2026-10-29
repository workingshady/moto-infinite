# Architecture

## Current state

The original single-file game lives in `src/legacy/game.js`, unchanged apart from importing `three` from npm.
It is split into the modules below step by step, so the game keeps working after every step.

## Target layout

```
index.html               HUD markup + entry script
public/                  Static files served as-is (favicon, audio, models, textures)
src/
  main.ts                Entry: boot the game
  config.ts              ALL tunables in one place (physics, colors, quality presets, keys)
  core/                  Game-agnostic engine
    Game.ts              Owns the loop, wires systems together
    Loop.ts              Fixed-timestep update + interpolated render
    Renderer.ts          WebGLRenderer, resize, pixel-ratio cap, N viewports (split screen)
    Events.ts            Typed event bus: systems talk without importing each other
    Pool.ts              Object pools (bullets, particles)
    Audio.ts
  input/                 Keyboard, Gamepad, Touch → per-player actions (InputMap)
  world/                 Noise, terrain chunks, sky, instanced props
  entities/              Player (owns bike, camera, input, HUD), Bike, Enemy, Pickup
  systems/               Physics, Weapons, Particles, Challenges, Leveling
  game/                  Session: mode = solo | local2p | online
  net/                   (later) client, protocol, interpolation for online rooms
  ui/                    Hud, Minimap, LevelUp, MainMenu, Lobby
  styles/                CSS
  utils/                 Math helpers
worker/
  index.ts               Cloudflare Worker: /api/* routes
  (later) Room.ts        Durable Object: one instance per online room
```

## Rules that keep it easy to change

1. **One source of truth for numbers:** gameplay/graphics values live in `src/config.ts`, never inline.
2. **Systems don't import each other.** They communicate through `core/Events.ts`.
3. **No globals for "the player".** Everything per-player lives on a `Player` instance, so 2-player split screen and online play need no rewrites.
4. **`core/` knows nothing about bikes.** Game-specific code lives outside it.
5. **Measure before optimizing:** check `renderer.info` (draw calls < ~100) and frame time first.

## Hosting

One Cloudflare Worker (`wrangler.jsonc`):
- Static build (`dist/client`) is served directly from Cloudflare's edge, with no Worker invocation.
- Only `/api/*` runs Worker code (`run_worker_first`).
- Online multiplayer later adds a Durable Object binding (WebSocket Hibernation API), one object per room, joined by link `?room=CODE`.
