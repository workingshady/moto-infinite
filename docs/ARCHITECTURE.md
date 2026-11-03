# Architecture

## Layout

```
index.html               Shell only; everything is built by src/main.ts
public/                  Static files served as-is (favicon)
shared/protocol.ts       Online message types + lobby settings, used by client AND worker
shared/leaderboard.ts    Daily/weekly seed challenges, board ids + plausibility rules, leaderboard API shapes
shared/social.ts         Quick-chat list, chat sanitising, rate/anti-cheat limits (client AND worker)
src/
  main.ts                Entry: new App()
  App.ts                 Flow: menu ⇄ game sessions ⇄ online rooms
  config.ts              ALL tunables: physics, road size, aim assist, drones, weather, sky colours, tracks, themes, quality
  core/                  Game-agnostic engine pieces
    Game.ts              One play session: builds the world, fixed-step loop, renders 1 or 2 viewports
    Renderer.ts          WebGLRenderer, quality presets, split-screen viewports
    Input.ts             Keyboard/mouse/touch/gamepads → per-player Controller actions
    Audio.ts             WebAudio mixer (sfx / engines / music buses -> compressor) and one-shot effects
    EngineSound.ts       Per-vehicle engine: firing pulses (rpm/60 x cyl/2), gearbox, turbo, crackle, limiter, wind, rumble
    Music.ts             Generative synthwave soundtrack on a lookahead scheduler; layers follow the action
    Events.ts            Typed event bus (challenge progress etc.)
    cameraViews.ts       Chase, far, hood, first person, cinematic, top-down
    prefs.ts             Saved player preferences (riding assist, nitro toggle, onboarding seen)
    settings.ts          Extra saved settings (FOV, units, shake, HUD scale/opacity, colourblind, frame cap, pad feel) + helpers
    bindings.ts          Key / gamepad rebinding (overrides written into Input's tables), key + button labels
    gamepad.ts           Pad dead zone / curve / analog triggers, Xbox/PlayStation detection and glyphs, hot-plug
    rumble.ts            Controller rumble + phone vibration, derived from player state each frame
    device.ts            Touch/coarse detection, first-run quality guess, fullscreen + orientation lock, screen wake lock
    DynamicRes.ts        Lowers/raises the render pixel ratio to hold the frame rate (detects 30 fps caps)
  data/                  Pure data tables: weapons, upgrades, challenges, story, vehicles (garage stats)
  world/
    layout.ts            RoadLayout interface: GridRoads (open world) and Circuit (race loop)
    Terrain.ts           Height/colour of the ground, world themes, ramps and pads
    Chunks.ts            Streams 64 m chunks: terrain, instanced scenery, road markings, features
    F1Track.ts           Real F1 circuits (Monza, Silverstone, Spa, Monaco, Suzuka, Bahrain) from bacinger/f1-circuits (MIT), DRS zones, pit lane, start lights, venue dressing
    DriftTrack.ts        Drift venues (docks, touge, skidpad, gymkhana, random): layout, zones, dressing
    Landmarks.ts         Villages, gas stations, windmills, stunt zones, drone outposts; race grandstands + tyre walls
    Environment.ts       Sky, day/night, weather (rain/snow/fog/storm), water, clouds, stars
  entities/
    Player.ts            One local rider: bike physics, tricks, walking, camera, XP, power-ups
    EntityManager.ts     Gems, crates, barrels, cones, power-ups, drones (scout/gunner/bomber)
    models.ts            Rider, drone, ghost, name tags
    vehicleModels.ts     15 vehicle models (5 motorcycles, 10 cars) behind one buildVehicleModel(id, colour)
    assets.ts            Shared geometries and materials
  systems/
    Combat.ts            Projectiles, railgun beams, mines, bombs, explosions, PvP
    Race.ts              Countdown, checkpoints, laps, positions, best-lap ghost
    Challenges.ts        Timed challenges per player with streaks
    Tutorial.ts          Guided training ride checklist
    LbSession.ts         Posts solo laps (+ghost) and timed drift runs to the leaderboards
    AiRacers.ts          Computer opponents: curvature/grip speed profile with braking pass, racing line, overtakes
    Particles.ts         GPU particle pools
    Effects.ts           Shockwave rings, debris, beams, skid marks (pooled/instanced)
  modes/                 Extra formats layered on a session (Game.modes: update/dispose/results hook), local games only
    TimeAttack.ts        Circuit medal runs (bronze/silver/gold/ace lap times from pace.ts), live split, PB per track x vehicle
    Elimination.ts       Knockout race: last place out every N s (N from the track's pace), last one standing wins
    Traffic.ts           Open-world civilian cars in the right lane; near-miss chains (XP + nitro), slipstream nitro, crashes
    pace.ts              Lap-time estimate from track curvature + vehicle speed/grip/accel
    menu.ts              Setup rows (Format, Traffic) and their option handling
    Replay.ts            60 s ring buffer (typed arrays) of every vehicle + key moments; poses puppet copies for playback
  net/
    NetClient.ts         WebSocket to a room: heartbeat/ping, auto-reconnect with resume token
    RemotePlayers.ts     Other online riders, interpolated, emote bubbles
    Spectate.ts          Follow-cam on other riders (finished, wrecked, late joiner)
    mutes.ts             Locally muted players
    leaderboard.ts       /api/lb fetch wrapper (offline-safe, local bests, retry queue, anonymous player id)
  ui/
    Menu.ts              Landing page, setup panel (solo/split/lobby share it), settings, pause, results
    Preview.ts           3D character preview + top-down map preview
    Hud.ts               Per-player HUD (stats, minimap, reticle, story, race panel)
    Touch.ts             Phone/tablet controls: mode-aware buttons, joystick or tilt steering, drag-to-edit layout, settings sheet, rotate hint
    TouchLayout.ts       Touch settings (saved per device) and the button table: which buttons each mode/vehicle shows, default slots
    LeaderboardPanel.ts  Daily challenge card, leaderboard overlay (daily/weekly/all-time), run result card
    SettingsPanel.ts     Tabbed Settings screen (Graphics, Audio, Controls, Gameplay, Accessibility) and rebinding UI
    menuNav.ts           Keyboard / gamepad menu navigation (focus ring, arrows/D-pad, Enter/A, Esc/B)
    toast.ts             Small notifications
    Social.ts            Online overlay: chat dock, quick chat, player list (Tab), reconnect banner, spectate bar
    ChatPanel.ts         Chat log/input and fading feed (text only, never innerHTML)
    Gauges.ts            Canvas speedometer, tachometer, nitro ring
    ReplayStudio.ts      Opens replay / photo mode (pause, results, I key, instant-replay prompt) via Game.view
    ReplayPanel.ts       Replay playback: TV/chase/orbit/onboard/heli cameras, timeline, events, WebM clips
    PhotoMode.ts         Free camera, FOV/roll/exposure, filters, frames, watermark, PNG download/share
    mediaShare.ts        Download/share, clip recorder, orbit drag/pinch input, gamepad edges
  styles/main.css
  styles/hud-layout.css  HUD zones scale with the viewport, respect safe areas and make room for touch buttons
  styles/mobile.css      Touch controls, rotate hint, settings sheet, phone menus (bottom sheets, 44 px targets)
  utils/                 math helpers, seeded noise
worker/
  index.ts               Cloudflare Worker: /api/health, /api/room/:code
  Room.ts                Durable Object per room (WebSocket Hibernation): lobby + relay, held slots (30 s) for
                         dropped players, host migration, chat, message validation/rate limits, finish-time checks
  Leaderboard.ts         SQLite Durable Object per board: best per player, ranks, top ghosts, rate limits, sanity checks
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
- **Open world** roads form an endless wavy grid. Each seed rotates the grid and gives every road line its own curves; crossroads may host landmarks. Chunks build around each local player (one per frame) and unload behind.
- **Terrain** = domain-warped continents + rolling hills + ridged mountains, optional river bands, a temperature-varied snow line. The world generator options (terrain, water, nature, roads, landmarks) scale these.
- **Handling**: every vehicle drives the same physics with its own numbers (data/vehicles.ts). The travel direction chases the heading at the vehicle's traction rate; the handbrake (X) and power oversteer lower it, counter-steering raises it, sliding scrubs speed. Drift points = angle x speed x zone multiplier, chained into a growing multiplier and banked after 0.7 s of grip. Bikes wheelie on C (pivot on the rear axle).
- **Formula 1**: downforce raises the cornering limit with v² (yaw capped at aLat/v), ~5 g braking, ERS charges under braking, straight-mode wing / DRS only in DRS zones, slipstream behind cars, tyre compounds wear with distance/sliding/braking, pit lane limiter and pit stops, five-light starts with jump-start penalty.
- **Riding assist** (Settings) follows the road and guards the edge only when you are not steering, lets the bike glance off obstacles, and limits crest launches.
- **Race** builds a closed Catmull-Rom loop from the track seed. 8 gates split it into segments; progress = lap + position inside the current segment.
- **Time and weather** run in `Environment`: sky colours blend between keys in `SKY_KEYS`; dynamic weather picks a new state every ~90 s and blends into it. Wet/snowy roads lower grip.

## Hosting

One Cloudflare Worker (`wrangler.jsonc`): static build from the edge, `/api/*` to Worker code, one Durable Object (`Room`) per room code, one (`Leaderboard`, migration v2) per leaderboard board id (`/api/lb/top|ghost|submit`).

## PWA, error reports and tests

- **Installable + offline**: `public/manifest.webmanifest` + `public/icons/` (regenerate with `node scripts/make-icons.mjs`). `scripts/vite-pwa.ts` emits `/sw.js` from `scripts/sw.template.js` at build time with the bundle's file list as precache: `/assets/*` cache-first, pages network-first with the cached shell offline, `/api/*` never cached. `src/core/pwa.ts` registers it (production only), shows the "Update available" toast and keeps the install prompt. `src/ui/menuExtras.ts` adds the Install button, offline notes and the pause-menu bug button after each menu render (Menu.ts is untouched).
- **Error reports**: `src/core/errorReport.ts` sends uncaught errors, unhandled rejections and WebGL context loss (with a restore/reload screen) to `POST /api/log` (`worker/log.ts`), de-duplicated and rate limited on both sides by `shared/logReport.ts`, which also strips query strings, origins and e-mails. Reports appear in Workers observability as `client-report` lines.
- **Tests**: `npm test` (Vitest in Node, no WebGL) runs the `*.test.ts` files next to the code. CI runs typecheck, lint, tests and build.
