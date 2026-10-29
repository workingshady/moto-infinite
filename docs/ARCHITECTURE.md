# Architecture

## Layout

```
index.html               Shell only; everything is built by src/main.ts
public/                  Static files served as-is (favicon)
shared/protocol.ts       Online message types + lobby settings, used by client AND worker
src/
  main.ts                Entry: new App()
  App.ts                 Flow: menu ⇄ game sessions ⇄ online rooms
  config.ts              ALL tunables: physics, road size, aim assist, drones, weather, sky colours, tracks, themes, quality
  core/                  Game-agnostic engine pieces
    Game.ts              One play session: builds the world, fixed-step loop, renders 1 or 2 viewports
    Renderer.ts          WebGLRenderer, quality presets, split-screen viewports
    Input.ts             Keyboard/mouse/touch/gamepads → per-player Controller actions
    Audio.ts             WebAudio synth (no audio files)
    Events.ts            Typed event bus (challenge progress etc.)
  data/                  Pure data tables: weapons, upgrades, challenges, story
  world/
    layout.ts            RoadLayout interface: GridRoads (open world) and Circuit (race loop)
    Terrain.ts           Height/colour of the ground, world themes, ramps and pads
    Chunks.ts            Streams 64 m chunks: terrain, instanced scenery, road markings, features
    Environment.ts       Sky, day/night, weather (rain/snow/fog/storm), water, clouds, stars
  entities/
    Player.ts            One local rider: bike physics, tricks, walking, camera, XP, power-ups
    EntityManager.ts     Gems, crates, barrels, cones, power-ups, drones (scout/gunner/bomber)
    models.ts            Low-poly bike, rider, drone, ghost, name tags
    assets.ts            Shared geometries and materials
  systems/
    Combat.ts            Projectiles, railgun beams, mines, bombs, explosions, PvP
    Race.ts              Countdown, checkpoints, laps, positions, best-lap ghost
    Challenges.ts        Timed challenges per player with streaks
    Particles.ts         GPU particle pools
    Effects.ts           Shockwave rings, debris, beams, skid marks (pooled/instanced)
  net/
    NetClient.ts         WebSocket to a room
    RemotePlayers.ts     Other online riders, interpolated
  ui/
    Menu.ts              Landing page, setup panel (solo/split/lobby share it), settings, pause, results
    Preview.ts           3D character preview + top-down map preview
    Hud.ts               Per-player HUD (stats, minimap, reticle, story, race panel)
    Touch.ts             Phone/tablet buttons
  styles/main.css
  utils/                 math helpers, seeded noise
worker/
  index.ts               Cloudflare Worker: /api/health, /api/room/:code
  Room.ts                Durable Object per room (WebSocket Hibernation): lobby + relay
```

## Rules that keep it easy to change

1. **Numbers live in `src/config.ts`**, content in `src/data/`. Tuning never means hunting through logic.
2. **Systems don't import each other's internals.** They go through `Game` or `core/Events.ts`.
3. **Everything per-player lives on `Player`**, so split screen and online need no special cases.
4. **New road shapes implement `RoadLayout`**; terrain, chunks, minimap and respawn work automatically.
5. **Online messages are typed in `shared/protocol.ts`**; a change there is type-checked in client and server.
6. **Nothing allocates per frame in hot paths**: particles, projectiles, debris and skid marks are pooled or instanced.

## How the world works

- The world is generated from a **seed**: same seed = same world on every client, so online players only send their own position (15×/s), shots and finishes.
- **Open world** roads form an endless wavy grid; chunks build around each local player (one per frame) and unload behind.
- **Race** builds a closed Catmull-Rom loop from the track seed. 8 gates split it into segments; progress = lap + position inside the current segment.
- **Time and weather** run in `Environment`: sky colours blend between keys in `SKY_KEYS`; dynamic weather picks a new state every ~90 s and blends into it. Wet/snowy roads lower grip.

## Hosting

One Cloudflare Worker (`wrangler.jsonc`): static build from the edge, `/api/*` to Worker code, one Durable Object (`Room`) per room code.
