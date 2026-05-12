# AutoStatus Bot

A lightweight Node.js Discord bot that monitors **one or more** other bots' presence, sends alerts when they go offline or come back online, and keeps a self-restickying status embed pinned to the bottom of a channel. Built by Haymooed.

## Features

- **Multi-bot tracking** — track any number of bots independently, each with its own alerts channel, status-post channel, ping role, custom image, and history.
- **Sticky status post** — the embed automatically re-posts itself to the bottom whenever new messages push it up.
- **Live updating** — embed refreshes on a configurable interval (1–60 minutes) and immediately on every up/down event.
- **Instant alerts** — pings a designated role in the alerts channel the moment a tracked bot goes down or comes back.
- **Interactive admin panel** — full configuration through buttons and select menus via `/admin panel`. No JSON editing required.
- **Custom embed image** — upload a banner image per tracked bot via `/admin setimage`.
- **Auto-update on start** — `start.js` syncs the repo with `git reset --hard origin/main` and installs dependencies (skipped if `package-lock.json` is unchanged).
- **Optional health server** — set `PORT` in `.env` to expose a small HTML status page (and `/health` JSON endpoint) for Pterodactyl / uptime monitors.
- **No database required** — config and history are kept in a local `config.json`.

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/Haymooed/AutoStatus-Bot.git
cd AutoStatus-Bot
```

### 2. Create a Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, click **Reset Token** and copy the token.
3. Under **Bot → Privileged Gateway Intents**, enable:
   - **Presence Intent** (required — used to detect online/offline transitions)
   - **Server Members Intent** (required — used to fetch member presence)
4. Under **OAuth2 → URL Generator**, select scopes `bot` and `applications.commands`, then invite the bot with permissions: **Send Messages**, **Embed Links**, **Attach Files**, **Manage Messages** (needed to delete & re-send the sticky status post), and **Read Message History**.

### 3. Configure your environment

Copy `.env.example` to `.env` and fill in:

```env
BOT_TOKEN=your_bot_token_here

# Optional: bind a tiny health-check HTTP server to satisfy Pterodactyl's
# port allocation (or to ping for uptime). Leave blank to disable.
PORT=
HOST=0.0.0.0
```

### 4. Run the bot

```bash
node start.js
```

`start.js` will:
1. Hard-reset the working tree to `origin/main` so the container always converges to the remote state (override by setting `SKIP_UPDATE=1`).
2. Install dependencies with `npm install` — skipped automatically if `package-lock.json` hash is unchanged since last install.
3. Launch `src/index.js`, log in to Discord, register slash commands, and start the periodic status-post refresh.

You should see something like:

```
✅ Repo up to date.
✅ Dependencies installed.
🚀 Starting the bot...
🔑 Logging in to Discord...
✅ Logged in as YourBot#1234 (123456789012345678)
✅ Registered 2 slash command(s)
```

If `PORT` is set you'll additionally see `🌐 Health server listening on http://0.0.0.0:<port>`.

### 5. Configure in Discord

Run `/admin panel` and use the buttons to:
1. **Add Bot** — pick a bot user to track.
2. Select that bot from the dropdown.
3. **Status Channel** — pick where the live status embed should live.
4. **Alerts Channel** — pick where up/down ping messages should be sent.
5. **Ping Role** — pick the role to ping on alerts.
6. (Optional) Use `/admin setimage bot:<bot> image:<file>` to upload a banner for the embed.

Repeat **Add Bot** for as many bots as you want to track — each gets its own configuration.

## Commands

All admin commands require the **Administrator** permission by default.

| Command | Description |
|---|---|
| `/admin panel` | Open the interactive admin panel (ephemeral). Add/remove tracked bots, configure channels, role, image, interval, history. |
| `/admin setimage bot:<user> image:<attachment>` | Upload a banner image (PNG/JPG/GIF/WEBP, max 8 MB) for a tracked bot's status embed. Stored under `data/`. |
| `/status [bot:<user>]` | Show the current status embed for a tracked bot. If only one bot is tracked, `bot` can be omitted. |

### Admin panel actions

When you open `/admin panel`, you get:

**Always-on controls**
- **Add Bot** — prompts you to pick a bot user to start tracking.
- **Set Interval** — choose the status-post refresh interval (1, 2, 5, 10, 15, 30, or 60 minutes).
- **Refresh** — re-render the panel.

**Per-selected-bot controls** (enabled after picking a bot from the dropdown)
- **Alerts Channel** — pick the channel for up/down alert messages.
- **Status Channel** — pick the channel where the sticky status embed lives.
- **Ping Role** — pick the role to ping on alerts.
- **Clear Image** — remove the custom banner image.
- **Clear History** — wipe the recorded incidents/outages for this bot.
- **Resend Status Post** — manually delete & re-send the status embed at the bottom of the channel.
- **Remove Bot** — stop tracking this bot (also deletes its custom image file).

## Status embed

Each tracked bot's status post shows:

- Current state (Online / Idle / Do Not Disturb / Offline) with matching color
- Bot avatar as thumbnail
- Uptime % and downtime % over the tracked window
- Total recorded incidents
- Time since the last outage and its duration
- "Last updated" rendered as a Discord relative timestamp (auto-adjusts to each viewer's timezone)
- Optional custom banner image attached via `/admin setimage`

The status post is **sticky** — when other messages are sent in the same channel, the bot waits ~2.5s, deletes the old embed, and re-sends a fresh one at the bottom.

## Files & storage

| Path | Purpose |
|---|---|
| `config.json` | Per-bot config + history. Gitignored. Auto-migrated from older single-bot schemas. |
| `data/` | Uploaded banner images (`<botId>.<ext>`). Gitignored. |
| `.env` | `BOT_TOKEN`, optional `PORT` / `HOST`. Gitignored. |
| `src/index.js` | Discord client bootstrapping, slash-command registration, sticky listener, optional HTTP server. |
| `src/configManager.js` | Multi-bot config read/write + migration. |
| `src/statusPost.js` | Embed builder, sticky restick logic, periodic refresh interval. |
| `src/monitor.js` | Presence-update handling and online/offline alerts. |
| `src/adminPanel.js` | Interactive panel renderer + component (button/select) router. |
| `src/commands/` | Slash command definitions (`admin`, `status`). |
| `start.js` | Hardened launcher: hard-resets to `origin/main`, installs only when the lockfile changes, forwards signals, propagates exit code. |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `BOT_TOKEN` | *(required)* | Your Discord bot token. |
| `PORT` | unset | If set (1–65535), starts an HTTP server with `/` (HTML status card) and `/health` (JSON). |
| `HOST` | `0.0.0.0` | Bind interface for the HTTP server. |
| `GIT_BRANCH` | `main` | Branch to sync to in `start.js`. |
| `SKIP_UPDATE` | unset | Set to `1` to skip `git fetch + reset --hard` in `start.js`. |

## Health endpoint

When `PORT` is set:

- `GET /` — small dark-themed HTML status card, auto-refreshes every 15 s.
- `GET /health` — JSON: `{ "ok": boolean, "user": string|null, "trackedBots": number, "uptimeSeconds": number }`.

## License

MIT — see [LICENSE](LICENSE).
"# AutoStatus-Bot" 
