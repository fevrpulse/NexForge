# NexForge Discord bot

Small Discord bot for the NexForge community. It is separate from the Electron desktop app and is not part of the Windows installer.

What it does today:

1. **Welcome / role helper** — greets someone when they join, and assigns a role when `WELCOME_ROLE_ID` is set.
2. **`/stats`** — looks up a gamer tag and replies with a placeholder embed. Career stats are not fetched yet.
3. **`/post`** — Manage Server only. Posts a short share message (and placeholder stat fields when you pass a gamer tag) into a channel.

## Create the Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application (for example `NexForge`).
2. Copy the **Application ID** from **General Information**. That is `CLIENT_ID`.
3. Open **Bot** and click **Reset Token**. That is `DISCORD_TOKEN`. Treat it like a password.
4. On the same **Bot** page, turn on the privileged **Server Members Intent**. The bot needs it for join events. Leave **Message Content Intent** off; this bot only uses slash commands.
5. Open **OAuth2 → URL Generator**.
   - Scopes: `bot` and `applications.commands`
   - Bot permissions: **View Channels**, **Send Messages**, **Embed Links**, **Manage Roles**
6. Open the generated URL and invite the bot to your server.

The permission bits above are `268454912`. With your application id filled in, the invite URL is:

```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=268454912&scope=bot%20applications.commands
```

## Configure

From `discord-bot/`:

```bash
cp .env.example .env
```

Fill in `.env`. Do not commit it (`.env` is gitignored).

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Bot token |
| `CLIENT_ID` | yes | Application ID |
| `GUILD_ID` | no | Register slash commands to one server immediately. Omit for global commands. |
| `WELCOME_CHANNEL_ID` | no | Channel for join greetings. Omit to use the server system channel. |
| `WELCOME_ROLE_ID` | no | Role granted to new members. Omit to skip assignment. |

Enable **Developer Mode** in Discord (User Settings → Advanced), then right-click the server, channel, or role and choose **Copy ID**.

For the welcome role to stick, drag the bot's role above that role in Server Settings → Roles.

## Run locally

Node 20 or newer.

```bash
cd discord-bot
npm install
npm start
```

`npm start` logs in and registers slash commands. With `GUILD_ID` set, they show up in that server right away. Without it, Discord can take up to an hour to roll global commands out.

To register commands without leaving the bot running:

```bash
npm run deploy
```

From the repo root, the same commands are `npm run bot` and `npm run bot:deploy` (install dependencies in `discord-bot/` first).

Check the command definitions and placeholder embeds without a token:

```bash
npm test
```

## Using it

- New members get a welcome message in `WELCOME_CHANNEL_ID`, or the system channel if that is empty. Other bots are ignored. If `WELCOME_ROLE_ID` is set, the bot tries to add that role and mentions it in the greeting when the add succeeds.
- `/stats player:<gamer tag>` replies with an embed whose MMR, record, and main game are placeholders.
- `/post message:<text> channel:<optional> player:<optional gamer tag>` is limited to members with **Manage Server**. The confirmation is only visible to you. Passing `player` adds the same placeholder stat fields as `/stats`.

## Wiring `/stats` later

Do not add a new HTTP lookup endpoint for this. NexForge already stores career stats on `public.profiles` (`gamer_tag`, `mmr`, `wins`, `losses`, `platform`, `main_game`, and kill/death/assist totals). Those rows are publicly readable, and gamer tags are unique case-insensitively. The desktop client talks to Supabase with the anon key in `src/renderer/lib/supabase.js`. `get_friend_profile` is not a public lookup: it only works for a signed-in user viewing a friend. The placeholder lives in `lookupPlayer` in `src/commands.js`.

## If something fails

- **Used disallowed intents** — turn on **Server Members Intent** on the Bot page, then start again.
- **Slash commands do not appear** — set `GUILD_ID` and run `npm run deploy`, or wait for global commands. Re-invite the bot if the `applications.commands` scope was missing.
- **Welcome role is not applied** — the bot needs **Manage Roles**, and its role must be higher than `WELCOME_ROLE_ID`.
- **`/post` says it cannot post** — the bot needs **Send Messages** and **Embed Links** in the target channel.
