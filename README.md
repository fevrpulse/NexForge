# NexForge Desktop

Electron + **React** desktop client for NexForge — public duel queues, tournaments, session performance tracking, and career stats backed by Supabase.

**First stable release: 1.2.0.** Install from [GitHub Releases](https://github.com/fevrpulse/NexForge/releases) only (not from cloning/source unless you are developing). Earlier **Beta** builds are unsupported for new installs.

## Install

1. Download **[NexForge.exe](https://github.com/fevrpulse/NexForge/releases/latest/download/NexForge.exe)** (always the latest release).
2. Run it once — it installs per-user (no admin) and launches NexForge.
3. After that, the installed app **checks hourly and auto-installs updates** (restarts when a new version is ready). No need to re-download.

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

Do not run `npm run release` **and** push the same version tag — two installers of the same version get different checksums, and auto-update fails with `sha512 checksum mismatch`. Pick one: local `npm run release`, or tag-triggered CI.

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
9. **`message-replies-photos.sql`** (message replies + private `chat-images` storage bucket)
10. **`presence-reactions-delete.sql`** (online presence / now-playing, emoji reactions, sender message deletion)
11. **`v127-social-extras.sql`** (custom status, friend pins, typing signals, friend activity feed RPC)
12. **`friend-profile.sql`** (accepted-friends-only profile / recent matches / sessions RPC)
13. **`v128-blocks-privacy-profile.sql`** (block/report, hide match history privacy, richer friend profiles)
14. **`cosmetics-avatars.sql`** (Forge Coins, cosmetics shop RPCs, public `avatars` storage bucket)
15. **`v129-cosmetics-extras.sql`** (match-win coin rewards, gift cosmetics RPC, avatar presets)
16. **`premium-ring-payments.sql`** (high-MMR ring pricing, cash prices, Stripe payment audit)
17. **`match-result-log.sql`** (casual/session W/L logging via `log_match_result`, match `source` tags)
18. **`cosmetic-cash-prices.sql`** (rarity-based USD price tags for shop cosmetics)

Database migrations remain SQL (Postgres). App UI/logic is JavaScript / React.

When **5+ players** share the same custom main-game name, `sync_community_games` marks it `live` and the desktop app shows it under **Community** in matchmaking / profile / tournaments / squad finder.

## Auth

Browser sign-in supports email/password and **Continue with Google**.

1. Enable Google in [Auth Providers](https://supabase.com/dashboard/project/nfaxokwpmaxyhnvatrwf/auth/providers).
2. Create a Google Cloud **Web** OAuth client and paste Client ID / Secret into that page.
3. Add these **Redirect URLs** under Auth URL configuration:
   - `http://127.0.0.1:17890/auth`
   - `http://127.0.0.1:17890/`
4. Google’s authorized redirect URI must be your Supabase callback:
   `https://nfaxokwpmaxyhnvatrwf.supabase.co/auth/v1/callback`

### Security notes

- Tournament bank/routing/account are **not** world-readable; clients browse `tournaments_public`.
- MMR / wins / losses / kill totals are updated only via security-definer RPCs (not free client updates).
- Auth callback requires a one-time nonce from the Electron app.
- Do **not** put a Supabase `service_role` key in this repo or the desktop client.
- Clients may only update identity profile fields (`gamer_tag`, `platform`, `main_game`, `main_game_description`, `onboarding_done`).
- Stripe entitlements are granted only by a signature-verified Edge Function webhook.

### Stripe ring checkout

Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as Supabase Edge Function
secrets. Configure Stripe to send `checkout.session.completed` and
`checkout.session.async_payment_succeeded` to:

`https://nfaxokwpmaxyhnvatrwf.supabase.co/functions/v1/stripe-ring-webhook`

Deploy `create-ring-checkout` with JWT verification. Deploy
`stripe-ring-webhook` and `stripe-checkout-return` without gateway JWT
verification; the webhook verifies Stripe's signature itself and the return
function serves only a static confirmation page.

## Features

- Public open queues + mutual duel result confirmation (player-hosted lobbies — NexForge does not host game servers)
- Shooter K/D/A reporting on duels and tracked sessions
- Session RAM / CPU / GPU / probe ping summaries (Windows process tracking)
- Friends with online / now-playing presence, custom status, pins, typing, chat search, direct messages with replies + photos + emoji reactions + deletion, duel challenges from chat, Do Not Disturb, overlay hotkey (Ctrl+Shift+O), NexAI dock (Ctrl+Shift+A), and an in-game message overlay
- Per-session RAM / CPU / GPU / ping graphs and side-by-side session compare in Analytics
- Linked accounts on your profile, NexAI starter prompts, and a phone companion for chat and lobby codes
- Cash / in-app tournaments with host-only payout fields
- Community-promoted custom games, guest browse mode, and first-run main-game onboarding
