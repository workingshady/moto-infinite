# Architecture

## Layout

```
index.html               Shell only; everything is built by src/main.ts
public/                  Static files served as-is (favicon)
shared/protocol.ts       Online message types + lobby settings, used by client AND worker
shared/leaderboard.ts    Daily/weekly seed challenges, board ids + plausibility rules, leaderboard API shapes
shared/social.ts         Quick-chat list, chat sanitising, rate/anti-cheat limits (client AND worker)
shared/logReport.ts      Client error report shape, scrubbing, de-dup/rate limits (client AND worker)
shared/auth.ts           Google client id, session cookie format/parsing, account API shapes (client AND worker)
shared/cloudSave.ts      Cloud save format + sanitizeSave (validation, caps) used by client AND worker
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
    EvVoice.ts           Electric motor voice for 'electric' engines: inverter tone, gear whine, tyre roar (no gears/crackle)
    Music.ts             Generative synthwave soundtrack on a lookahead scheduler; layers follow the action
    Events.ts            Typed event bus (challenge progress etc.)
    cameraViews.ts       Chase, far, hood, first person, cinematic, top-down
    prefs.ts             Saved player preferences (riding assist, nitro toggle, onboarding seen)
    syncBus.ts           Local-save change feed + per-section edit times for cloud save (no imports)
    settings.ts          Extra saved settings (FOV, units, shake, HUD scale/opacity, colourblind, frame cap, pad feel) + helpers
    bindings.ts          Key / gamepad rebinding (overrides written into Input's tables), key + button labels
    gamepad.ts           Pad dead zone / curve / analog triggers, Xbox/PlayStation detection and glyphs, hot-plug
    rumble.ts            Controller rumble + phone vibration, derived from player state each frame
    device.ts            Touch/coarse detection, first-run quality guess, fullscreen + orientation lock, screen wake lock
    DynamicRes.ts        Lowers/raises the render pixel ratio to hold the frame rate (detects 30 fps caps, honours the Settings cap)
    career.ts            Persistent career (moto:career): level/XP, credits, lifetime stats, garage unlocks, achievements, feats (recordFeat)
    pwa.ts               Service worker registration, update toast, install prompt
    errorReport.ts       Uncaught errors / WebGL context loss → POST /api/log
  data/                  Pure data tables: weapons, upgrades, challenges, story, vehicles (garage stats + unlocks; vehiclesExtra + vehicleLooks = expansion pack), achievements
  world/
    layout.ts            RoadLayout interface: GridRoads (open world) and Circuit (race loop)
    Terrain.ts           Height/colour of the ground, world themes, ramps and pads
    Chunks.ts            Streams 64 m chunks: terrain, instanced scenery, road markings, features
    F1Track.ts           F1 circuit layout for a session: kerbs (inside apex, outside exit), pit lane, start lights, grid, venue dressing
    f1Circuits.ts        F1 catalogue (19 real circuits + the fictional Rookie Ring; difficulty, length, turns, flag) and pure geometry:
                         lon/lat -> metres (WGS84), Catmull-Rom, min-radius relax, scale to the official length, widths, elevation, DRS, pit (unit tested)
    f1Data.ts            Raw circuit traces from bacinger/f1-circuits (MIT), compact lon/lat offsets
    DriftTrack.ts        Drift venues (docks, touge, skidpad, gymkhana, random): layout, zones, dressing
    Landmarks.ts         Villages, gas stations, windmills, stunt zones, drone outposts; race grandstands + tyre walls; thruster demo wall near the open-world spawn
    Environment.ts       Sky, day/night, weather (rain/snow/fog/storm), water, clouds, stars
  entities/
    Player.ts            One local rider: bike physics, tricks, walking, camera, XP, power-ups
    EntityManager.ts     Gems, crates, barrels, cones, power-ups, drones (scout/gunner/bomber)
    models.ts            Rider, drone, ghost, name tags
    vehicleModels.ts     18 hand-built vehicle models behind one buildVehicleModel(id, colour); exports the builder kit
    vehicleBuilders.ts   Parametric car / formula / bike builders for the 45 spec-driven vehicles (data/vehicleLooks.ts)
    teslaModels.ts       Tesla Roadster (2nd gen) and Model 3 Performance models (no badges), registered in vehicleModels
    EvDrive.ts           Electric cars: instant-torque launch, regen braking -> boost meter, Track Mode rotation; Roadster cold-gas thrusters:
                         nitrogen tank (= boost meter, ~5 s full thrust), lift-off flight, kickflip, down-force glue on steep banks
    assets.ts            Shared geometries and materials
  systems/
    Combat.ts            Projectiles, railgun beams, mines, bombs, explosions, PvP
    Race.ts              Countdown, checkpoints, laps, positions, best-lap ghost
    Challenges.ts        Timed challenges per player with streaks
    Tutorial.ts          Guided training ride checklist
    LbSession.ts         Posts solo laps (+ghost) and timed drift runs to the leaderboards; challenge runs + ranks feed the career
    CareerTracker.ts     Feeds a session into the career (stats, credits, XP, achievement toasts); modes/replay/online call feat()
    Replay.ts            60 s ring buffer (typed arrays) of every vehicle (riders, AI, online, traffic) + key moments; poses puppet copies for playback
    AiRacers.ts          Computer opponents: curvature/grip speed profile with braking pass, racing line, overtakes
    Particles.ts         GPU particle pools
    Effects.ts           Shockwave rings, debris, beams, skid marks (pooled/instanced)
  modes/                 Extra formats layered on a session (Game.modes: update/dispose/results hook), local games only
    TimeAttack.ts        Circuit medal runs (bronze/silver/gold/ace lap times from pace.ts), live split, PB per track x vehicle
    Elimination.ts       Knockout race: last place out every N s (N from the track's pace), last one standing wins
    Traffic.ts           Open-world civilian cars in the right lane; near-miss chains (XP + nitro), slipstream nitro, crashes
    pace.ts              Lap-time estimate from track curvature + vehicle speed/grip/accel
    menu.ts              Setup rows (Format, Traffic) and their option handling
  net/
    NetClient.ts         WebSocket to a room: heartbeat/ping, auto-reconnect with resume token
    RemotePlayers.ts     Other online riders, interpolated, emote bubbles
    Spectate.ts          Follow-cam on other riders (finished, wrecked, late joiner)
    mutes.ts             Locally muted players
    leaderboard.ts       /api/lb fetch wrapper (offline-safe, local bests, retry queue, anonymous player id)
    auth.ts              Google Identity Services loader/button/One Tap + /api/auth, /api/me, /api/logout, /api/account
    cloudSave.ts         Cloud save engine: collect/apply local data, sync (pull-merge-push), autosave, keepalive, account switching
    saveMerge.ts         Pure merge rules (career three-way merge, latest-wins sections, Time Attack bests)
  admin/
    state.ts             Admin flag (from /api/me only) + Full Power choice per account; hooks read by career, Player, leaderboards
    tools.ts             Explicit admin career writes (credits, level, achievements)
  ui/
    Menu.ts              Landing page, setup panel (solo/split/lobby share it), settings, pause, results
    Preview.ts           3D character preview + top-down map preview
    garagePicker.ts      Garage tabs (bikes + each car class), sort chips, card grid (styles/garage.css)
    f1Picker.ts          F1 circuit cards (mini map, flag, difficulty, length, turns), difficulty filter + sort (styles/f1picker.css)
    Hud.ts               Per-player HUD (stats, minimap, reticle, story, race panel)
    Touch.ts             Phone/tablet controls: mode-aware buttons, joystick or tilt steering, drag-to-edit layout, settings sheet, rotate hint
    TouchLayout.ts       Touch settings (saved per device) and the button table: which buttons each mode/vehicle shows, default slots
    LeaderboardPanel.ts  Daily challenge card, leaderboard overlay (daily/weekly/all-time), run result card
    SettingsPanel.ts     Tabbed Settings screen (Graphics, Audio, Controls, Gameplay, Accessibility) and rebinding UI
    menuNav.ts           Keyboard / gamepad menu navigation (focus ring, arrows/D-pad, Enter/A, Esc/B)
    toast.ts             Small notifications
    CareerPanel.ts       Career screen, home strip, session summary, garage lock badges / buy box
    AchievementToast.ts  HUD achievement / career level toasts
    menuExtras.ts        Install button, offline notes, pause-menu bug button (added after each Menu render)
    bugReport.ts         "Report a bug" dialog
    AccountPanel.ts      Sign-in strip on home, Settings → Account, admin Full Power switch, FULL POWER badge
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
  index.ts               Cloudflare Worker: /api/health, /api/room/:code, /api/lb/*, /api/log, account routes (auth.ts)
  auth.ts                /api/auth/google|dev, /api/me, /api/logout, /api/save, /api/account, /api/admin/unpin; sessionUser()
  googleJwt.ts           Google ID token verification (WebCrypto RS256, JWKS cache)
  admin.ts               Admin bootstrap (ADMIN_EMAILS) and pin rules
  Account.ts             SQLite Durable Object per signed-in player: profile, admin pin, sessions (hashed), revisioned save
  log.ts                 Client error reports → Workers observability
  Room.ts                Durable Object per room (WebSocket Hibernation): lobby + relay, held slots (30 s) for
                         dropped players, host migration, chat, message validation/rate limits, finish-time checks
  Leaderboard.ts         SQLite Durable Object per board: best per player, ranks, top ghosts, rate limits, sanity checks
```

## How the features fit together

- **Pause / overlays**: Esc / Start toggles the pause menu (App.togglePause). Replay and photo mode (ReplayStudio) pause the game themselves when opened from play and return to where they were opened from; while one is open Esc/Start belong to it, and the online social layer treats it as a menu. Touch's rotate hint and settings sheet hold the game paused but never resume it behind a menu or the studio. Online games never pause (Game.setMenuPaused only disables input), so instant replay is off online; replay/photo from the pause menu still work (the recorder freezes while watching).
- **Fixed keys** next to the rebindable ones (core/bindings.ts `SYSTEM_KEYS`): I instant replay (local), Enter/T chat, Tab player list, 5–0 quick chat, [ ] spectate (online). Rebinding a game action onto one of them works but shows a note. Typing in any input never reaches the game.
- **Career feats** (core/career.ts `recordFeat`): Time Attack medal steps (once per track x vehicle), Elimination wins, traffic near misses, daily/weekly challenge runs (once per challenge), leaderboard ranks, first replay/photo, chat, online races. Nothing counts while a replay or photo mode is open. A daily/weekly or ghost run in a vehicle you don't own lends it for that run only (shown as 🔑 loaner); it stays locked in the garage.
- **Leaderboards**: every local single-player circuit format (plain, Time Attack, Elimination) posts its best flying lap to the track board: a lap is a lap. Split screen, online, training never post.
- **Tesla Roadster thrusters**: a lap that used lift-off, a hop or a kickflip (EvDrive.lifts changed, `race.lifted`) can cut the infield, so it sets no best lap, ghost, Time Attack medal or leaderboard post; ground laps count normally. Powered flight credits `bestFlight`, not airtime (no BIG AIR, no 'air' challenge progress), and no slipstream nitro while airborne. Gamepad B is both menu "back" and lift: a button still held when a menu opens or closes is ignored until released (menuNav / Input.padMute).
- **Vehicles**: 65 in data/vehicles.ts (+ vehiclesExtra.ts). Electric engines hide the exhaust flame in buildVehicleModel. Daily/weekly challenge pools (shared/leaderboard.ts) add a curated set of expansion vehicles for periods starting on/after `POOL_V2_FROM`, so a running challenge never changes vehicle.
- **Saved data** (localStorage, all `moto:` prefixed): career, settings, prefs, touch, profile, quality, muted, ghost:<track>, ta:<track>:<vehicle>, lbid/lbbest/lbqueue; cloud save bookkeeping: auth:user, sync:owner|base|rev|pending|dirty|at, acct:<uid> (parked copy of another account), admin:fp:<uid>. Loaders merge onto defaults and drop wrong-typed values (utils/store.ts).
- **Cloud save**: every save function (career, settings, prefs, touch, profile, Time Attack) calls `syncBus.markChanged`; when signed in that schedules an upload (see below). Signed out nothing changes and no account request is made.

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

One Cloudflare Worker (`wrangler.jsonc`): static build from the edge, `/api/*` to Worker code, one Durable Object (`Room`) per room code, one (`Leaderboard`, migration v2) per leaderboard board id (`/api/lb/top|ghost|submit`), one (`Account`, migration v3) per signed-in player. All on the Workers Free plan; no secrets.

## Accounts, cloud save and admin

**Sign-in flow.** `ui/AccountPanel.ts` asks `net/auth.ts` to load Google Identity Services (after the page's load event, only when a sign-in button is shown) and render Google's button (One Tap optional, off by default). Google hands the page an ID token; the client posts it to `POST /api/auth/google`. `worker/googleJwt.ts` checks it: RS256 signature by a key from Google's JWKS (cached in memory + Cache API for Google's max-age, unknown `kid` refetch at most once a minute), `iss` = accounts.google.com, `aud` = `GOOGLE_CLIENT_ID`, `exp`/`iat` with 2 min skew, a sane `sub`. The account key = first 32 hex of SHA-256("moto-user:" + sub); it names the `Account` Durable Object. The DO stores the profile (name, picture URL; never the e-mail), a new session (random 256-bit token, only its SHA-256 kept, 60 days sliding, max 20 per account) and returns the token; the Worker sets `moto_sid=<key>.<token>; HttpOnly; Secure (not on localhost); SameSite=Lax; Path=/api`. Non-GET account requests with a foreign `Origin` are refused; sign-ins are rate limited per IP (per isolate), save writes per account (20/min); bodies are capped (8 KB auth, 256 KB save). A random cookie never creates storage: tables are made on the first real sign-in.

**Endpoints.** `GET /api/me` → `{user, admin?}` (renews the cookie) · `POST /api/logout` · `GET /api/save` → `{rev, updatedAt, save, wids}` · `PUT /api/save {rev, wid, save}` → 200 `{rev}` / 409 / 401 / 413 / 422 / 429 · `DELETE /api/account` (wipes the DO) · `POST /api/admin/unpin` · `POST /api/auth/dev` (tests, see README).

**Save contents** (`shared/cloudSave.ts`): career blob, sections `settings` (minus device-only renderScale / fpsCap / showFps), `prefs`, `touch`, `profile` each with the time it was last edited on its device, and Time Attack bests. `sanitizeSave` runs on the server for every write and on the client for every read: known shapes only, numbers clamped (level ≤ 999, credits ≤ 1e8, top speed ≤ 2000 km/h, medals ≤ 4, …), ids/lists/sections size-capped, timestamps bounded.

**Sync** (`net/cloudSave.ts`). Sign-in / page load with a session: GET → merge → apply locally (quietly, not echoed) → PUT with the revision it was based on. Local saves schedule a PUT 15 s later; leaving the page (pagehide / hidden) sends a keepalive PUT. 409 → refetch, merge, retry. Offline → `dirty` flag, retried on `online` or the next load. Every PUT has a write id; the server keeps the last 32, so a write whose answer was lost (keepalive, dropped connection) is recognised on the next sync instead of being merged twice.

**Merge rules** (`net/saveMerge.ts`): career is a three-way merge against `base` = the career at this device's last successful sync, so only this device's changes since then are added: credits = cloud + (local − base) (never doubles; purchases stay paid; ≥ 0), total career XP likewise (then back to level + XP), lifetime counters cloud + max(0, local − base), records max (best rank: lowest), lists and bought vehicles union, achievements union with the earliest time. Progress made before the first sign-in has no base, so it is added to the account's. Settings-like sections: latest edit wins as a whole. Time Attack: faster time, better medal.

**Accounts never mix.** Local data belongs to `sync:owner`. The first account to sign in adopts guest progress. Signing out keeps the local copy (still playable). Signing in with a different account parks the previous owner's copy in `acct:<uid>`, loads the new account's (fresh career if none) and restores a parked copy when that account comes back. Delete my cloud data wipes the server copy and keeps the local copy as guest progress.

**Leaderboards** read the session cookie: a signed-in post uses the account key as player id and the row is stored `verified` (✓ in the lists); anonymous rows keep working but can never overwrite a verified row.

**Admin.** `worker/admin.ts`: a verified (`email_verified === true`) @gmail.com sign-in listed in `ADMIN_EMAILS` pins its account (`profile.admin` in its DO, keyed by `sub`, e-mail not stored). Afterwards the pin alone decides; removing the address does not unpin (use `POST /api/admin/unpin` or delete the account). `/api/me` says `admin: true` only for admins and every admin endpoint re-checks the session. Client (`admin/state.ts`) believes only a fresh server answer. Full Power (per-account local choice, ⚡ badge on menus and HUD): `isUnlocked` override (no fake purchases), endless nitro / N2 and no damage or wrecks (crash effects optional), 5× in-run XP; `earn`, achievements, feats, the CareerTracker and leaderboard posts are off while it is on (the client also flags `fp` and the server rejects such posts). Online rooms: unlocks only (`godPlay` is false when `game.net` is set), so other players never face a god-moded rider.

## PWA, error reports and tests

- **Installable + offline**: `public/manifest.webmanifest` + `public/icons/` (regenerate with `node scripts/make-icons.mjs`). `scripts/vite-pwa.ts` emits `/sw.js` from `scripts/sw.template.js` at build time with the bundle's file list as precache: `/assets/*` cache-first, pages network-first with the cached shell offline, `/api/*` never cached (so account calls and the session cookie always hit the Worker; the cookie is first-party and works the same in the installed app). `src/core/pwa.ts` registers it (production only), shows the "Update available" toast and keeps the install prompt. `src/ui/menuExtras.ts` adds the Install button, offline notes and the pause-menu bug button after each menu render (Menu.ts is untouched).
- **Error reports**: `src/core/errorReport.ts` sends uncaught errors, unhandled rejections and WebGL context loss (with a restore/reload screen) to `POST /api/log` (`worker/log.ts`), de-duplicated and rate limited on both sides by `shared/logReport.ts`, which also strips query strings, origins and e-mails. Reports appear in Workers observability as `client-report` lines.
- **Tests**: `npm test` (Vitest in Node, no WebGL) runs the `*.test.ts` files next to the code. CI runs typecheck, lint, tests and build.
