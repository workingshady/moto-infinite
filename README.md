# Moto Infinite

Low-poly motorbike game in the browser: endless open world with a story, circuit races, 2-player split screen and online rooms.

- **Modes:** open world (story chapters, challenges, drones, level-ups) · circuit race (5 tracks + random, 1-50 laps, ghost) · Formula 1 (19 real circuits at 1:1 scale + a rookie track, Easy/Medium/Hard)
- **Computer racers:** up to 7 in races, 19 in F1, driving the same physics as you · Rookie / Amateur / Pro / Legend or Adaptive (matches your Racecraft rating) · named personalities (Late Braker, Smooth Operator, Defender, Wet-weather Ace…) · they learn racing lines from your best ghost and the leaderboard #1 · F1 tyre strategy, pit stops, DRS, ERS
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

## Android app (APK)

`android/` is a [Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity) generated with
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap): package `dev.workers.workingshady.motoinfinite`, full screen,
landscape. It is not on the Play Store; the signed APK is attached to the GitHub Releases.

**Install (sideload):** download `MotoInfinite-<version>.apk` from the Releases page on the phone, open it and allow
"Install unknown apps" for the browser or file manager when Android asks. Needs Android 7.0+ and Chrome (or another
browser that supports TWAs); without one it falls back to a Custom Tab.

**It loads the live site.** The app opens https://moto-infinite.workingshady.workers.dev in Chrome without the browser
bar, so every web deploy reaches the app at once: no new APK is needed for game changes. Google sign-in works because
the page runs in Chrome, not a WebView. The bar stays hidden only while the site serves `/.well-known/assetlinks.json`
(`public/.well-known/assetlinks.json`) with the release key's SHA-256 fingerprint; if it is missing or wrong, the app
still works but shows a URL bar.

**Build a new version** (only for app-side changes: name, icon, colours, orientation, Android/library updates):

1. Bump `appVersionCode` (+1, must always increase) and `appVersionName` in `android/twa-manifest.json`, and the same
   values as `versionCode` / `versionName` in `android/app/build.gradle`. For bigger changes (icon, colours, a newer
   Bubblewrap template) regenerate the project from `twa-manifest.json` with `bubblewrap update --skipVersionUpgrade`
   (Bubblewrap CLI, run inside `android/`).
2. Put the passwords from `C:\Users\worki\moto-infinite-signing\KEEP-SAFE.txt` in the environment and build (git bash,
   JDK 17 + Android SDK build-tools 36.1.0):
   ```bash
   export BUBBLEWRAP_KEYSTORE_PASSWORD='…'     # BUBBLEWRAP_KEY_PASSWORD defaults to the same value
   bash android/build-apk.sh                    # -> android/app-release-signed.apk (+ app-release-bundle.aab)
   ```
   The script runs Gradle, zipalign, apksigner and jarsigner (what `bubblewrap build` does, without prompts) and prints the
   certificate's SHA-256, which must match `public/.well-known/assetlinks.json`.
3. Rename the APK to `MotoInfinite-<version>.apk` and attach it to a new GitHub Release.

**Keep the signing key safe.** The keystore (`keystore.jks`, alias `motoinfinite`) and its passwords live outside the
repo in `C:\Users\worki\moto-infinite-signing\` and must never be committed (`*.jks`, `*.keystore`, `*.apk`, `*.aab`
are git-ignored). Back that folder up: Android only accepts an update signed with the same key, so if it is lost the
app can never be updated in place (everyone would have to uninstall and reinstall) and assetlinks.json would need the
new fingerprint.
