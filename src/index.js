require('dotenv').config();
const http = require('http');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { handlePresenceUpdate } = require('./monitor');
const { startInterval, handleStickyMessage } = require('./statusPost');
const { handleComponent } = require('./adminPanel');
const { getAllBots } = require('./configManager');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
    ],
});

client.commands = new Collection();
const commands = [];

const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const command = require(path.join(commandsPath, file));
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        commands.push(command.data.toJSON());
    }
}

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag} (${client.user.id})`);
    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`✅ Registered ${commands.length} slash command(s)`);
    } catch (error) {
        console.error('⚠️ Failed to register slash commands:', error.message);
    }
    startInterval(client);
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            return command.execute(interaction);
        }
        if (
            interaction.isButton() ||
            interaction.isStringSelectMenu() ||
            interaction.isUserSelectMenu() ||
            interaction.isChannelSelectMenu() ||
            interaction.isRoleSelectMenu()
        ) {
            if (interaction.customId?.startsWith('panel:')) {
                return handleComponent(interaction);
            }
        }
    } catch (error) {
        console.error('Interaction error:', error);
        if (interaction.isRepliable && interaction.isRepliable()) {
            const payload = { content: 'There was an error handling this interaction.', ephemeral: true };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(payload).catch(() => {});
            } else {
                await interaction.reply(payload).catch(() => {});
            }
        }
    }
});

client.on('presenceUpdate', (oldPresence, newPresence) => {
    handlePresenceUpdate(oldPresence, newPresence, client);
});

client.on('messageCreate', (message) => {
    handleStickyMessage(client, message);
});

if (!process.env.BOT_TOKEN || process.env.BOT_TOKEN === 'your_token_here') {
    console.error('❌ BOT_TOKEN is missing or still set to the placeholder. Set BOT_TOKEN in the environment / .env file.');
    process.exit(1);
}

process.on('unhandledRejection', (err) => console.error('❌ Unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('❌ Uncaught exception:', err));

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}

function renderStatusHtml(stats) {
    const statusLabel = stats.ok ? 'Online' : 'Connecting…';
    const statusColor = stats.ok ? '#57F287' : '#FEE75C';
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AutoStatus Bot</title>
<meta http-equiv="refresh" content="15">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, #2a2d4a 0%, #0e0f1a 60%, #06070d 100%);
    color: #e6e7ee;
    display: grid; place-items: center; padding: 32px;
  }
  .card {
    width: min(560px, 100%);
    background: rgba(20,22,36,.78);
    border: 1px solid rgba(255,255,255,.08);
    backdrop-filter: blur(10px);
    border-radius: 18px;
    padding: 28px 28px 22px;
    box-shadow: 0 20px 60px rgba(0,0,0,.45);
  }
  h1 { margin: 0 0 18px; font-size: 22px; font-weight: 600; letter-spacing: -.01em; }
  .pill {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 12px; border-radius: 999px;
    background: rgba(255,255,255,.06);
    font-size: 13px; font-weight: 500;
  }
  .dot {
    width: 9px; height: 9px; border-radius: 50%;
    background: ${statusColor};
    box-shadow: 0 0 12px ${statusColor};
  }
  .grid {
    margin-top: 22px;
    display: grid; gap: 12px;
    grid-template-columns: 1fr 1fr;
  }
  .stat {
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.06);
    border-radius: 12px;
    padding: 14px 16px;
  }
  .stat .k { color: #9aa0b4; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
  .stat .v { margin-top: 4px; font-size: 18px; font-weight: 600; }
  footer { margin-top: 18px; font-size: 12px; color: #7b819a; text-align: right; }
  a { color: #9aa0ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="card">
    <h1>🤖 AutoStatus Bot</h1>
    <span class="pill"><span class="dot"></span>${escapeHtml(statusLabel)}</span>
    <div class="grid">
      <div class="stat"><div class="k">Logged in as</div><div class="v">${escapeHtml(stats.user || '—')}</div></div>
      <div class="stat"><div class="k">Tracked bots</div><div class="v">${stats.trackedBots}</div></div>
      <div class="stat"><div class="k">Uptime</div><div class="v">${escapeHtml(formatUptime(stats.uptimeSeconds))}</div></div>
      <div class="stat"><div class="k">Refreshes</div><div class="v">every 15s</div></div>
    </div>
    <footer>JSON at <a href="/health">/health</a></footer>
  </div>
</body>
</html>`;
}

if (process.env.PORT) {
    const port = parseInt(process.env.PORT, 10);
    const host = process.env.HOST || '0.0.0.0';
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
        console.error(`❌ Invalid PORT value "${process.env.PORT}". Must be 1–65535.`);
    } else {
        http.createServer((req, res) => {
            const stats = {
                ok: client.isReady(),
                user: client.user?.tag ?? null,
                trackedBots: Object.keys(getAllBots()).length,
                uptimeSeconds: Math.floor(process.uptime()),
            };
            if (req.url === '/health' || req.url === '/health.json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(stats));
            }
            if (req.url === '/' || req.url === '/index.html') {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                return res.end(renderStatusHtml(stats));
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found');
        }).listen(port, host, () => {
            console.log(`🌐 Health server listening on http://${host}:${port}`);
        }).on('error', (err) => {
            console.error('⚠️ Health server failed to start:', err.message);
        });
    }
}

console.log('🔑 Logging in to Discord...');
client.login(process.env.BOT_TOKEN).catch((err) => {
    console.error('❌ Failed to log in to Discord:', err.message);
    process.exit(1);
});

// Built by Haymooed
