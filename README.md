# NexForge Desktop

Electron + **React** desktop client for NexForge — public duel queues, tournaments, session performance tracking, and career stats backed by Supabase.

**First stable release: 1.2.0.** Install from [GitHub Releases](https://github.com/fevrpulse/NexForge/releases) only (not from cloning/source unless you are developing). Earlier **Beta** builds are unsupported for new installs.

## Install

1. Download the latest **NexForge-Setup-*.exe** from [GitHub Releases](https://github.com/fevrpulse/NexForge/releases) (prefer `1.2.0` or newer — not a Beta tag).
2. Install and sign in via the browser login window.
3. Packaged builds auto-update from GitHub Releases when a newer non-draft release is published.

## Develop locally

```bash
npm install
npm run dev          # Vite renderer + Electron (hot reload)
# or
npm start            # production renderer build, then Electron
```

Stack: Electron main/preload (`main.js`, `preload.js`, `game-tracker.js`) + React UI under `src/renderer/` (Vite).

Requirements: Windows recommended for game-process tracking; Node 20+.

## Build / release

```bash
npm run build          # vite build + local NSIS installer (no publish)
npm run release        # vite build + publish to GitHub Releases (needs GH_TOKEN)
```

Or push a version tag (`v1.2.0`) to trigger `.github/workflows/release.yml`.

`package.json` `"version"` must match the tag (without the leading `v`). GitHub publish uses `releaseType: release` (stable, not draft/prerelease).

## Supabase

Anon key lives in `src/renderer/lib/supabase.js` and `auth.html` (public by design; **RLS is the security boundary**).

Apply SQL in the Supabase SQL editor in this order if starting fresh:

1. `supabase-setup.sql` (base schema + triggers)
2. `duels.sql` / `game-sessions.sql` / `combat-stats.sql` if not already included above
3. **`security-hardening.sql`** (bank/PII lockdown, duel cancel policy, profile authority, `add_session_combat`)
4. **`community-games.sql`** (promote popular custom “Other” main games into a Community catalog)
5. **`profile-onboarding.sql`** only on **legacy** databases that already had `profiles` before onboarding columns existed (safe no-op if columns are present)
6. **`tournament-id-default.sql`** if tournament creates fail with `null value in column "id"` (adds `gen_random_uuid()` default)
7. **`gpu-session-metrics.sql`** (avg/max GPU % on `game_sessions`)
8. **`friends-messages.sql`** (friendships + direct messages with RLS)

Database migrations remain SQL (Postgres). App UI/logic is JavaScript / React.

When **5+ players** share the same custom main-game name, `sync_community_games` marks it `live` and the desktop app shows it under **Community** in matchmaking / profile / tournaments / squad finder.

### Security notes

- Tournament bank/routing/account are **not** world-readable; clients browse `tournaments_public`.
- MMR / wins / losses / kill totals are updated only via security-definer RPCs (not free client updates).
- Auth callback requires a one-time nonce from the Electron app.
- Do **not** put a Supabase `service_role` key in this repo or the desktop client.
- Clients may only update identity profile fields (`gamer_tag`, `platform`, `main_game`, `main_game_description`, `onboarding_done`).

## Features

- Public open queues + mutual duel result confirmation (player-hosted lobbies — NexForge does not host game servers)
- Shooter K/D/A reporting on duels and tracked sessions
- Session RAM / CPU / GPU / probe ping summaries (Windows process tracking)
- Cash / in-app tournaments with host-only payout fields
- Community-promoted custom games, guest browse mode, and first-run main-game onboarding
