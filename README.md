# NexForge Desktop

Electron desktop client for NexForge — public duel queues, tournaments, session performance tracking, and career stats backed by Supabase.

**Please install from [GitHub Releases](https://github.com/fevrpulse/NexForge/releases) only** (not from cloning/source unless you are developing).

## Install

1. Download the latest **NexForge-Setup-*.exe** from [GitHub Releases](https://github.com/fevrpulse/NexForge/releases).
2. Install and sign in via the browser login window.
3. Packaged builds auto-update from GitHub Releases when a newer non-draft version is published.

## Develop locally

```bash
npm install
npm start
```

Requirements: Windows recommended for game-process tracking; Node 20+.

## Build / release

```bash
npm run build          # local NSIS installer (no publish)
npm run release        # build + publish to GitHub Releases (needs GH_TOKEN)
```

Or push a version tag (`v1.0.5`) to trigger `.github/workflows/release.yml`.

`package.json` `"version"` must match the tag (without the leading `v`).

## Supabase

Project URL is configured in `index.html` / `auth.html` (anon key — public by design; **RLS is the security boundary**).

Apply SQL in the Supabase SQL editor in this order if starting fresh:

1. `supabase-setup.sql` (or incremental files below)
2. `duels.sql` / `game-sessions.sql` / `combat-stats.sql` if not already applied
3. **`security-hardening.sql`** (bank/PII lockdown, duel cancel policy, profile authority, `add_session_combat`)

### Security notes

- Tournament bank/routing/account are **not** world-readable; clients browse `tournaments_public`.
- MMR / wins / losses / kill totals are updated only via security-definer RPCs (not free client updates).
- Auth callback requires a one-time nonce from the Electron app.
- Do **not** put a Supabase `service_role` key in this repo or the desktop client.

## Features

- Public open queues + mutual duel result confirmation
- Shooter K/D/A reporting on duels and tracked sessions
- Session RAM / CPU / probe ping summaries (Windows process tracking)
- Cash / in-app tournaments with host-only payout fields
