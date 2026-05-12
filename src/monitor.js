const { EmbedBuilder } = require('discord.js');
const { getBot, pushHistory, updateLastOfflineDuration } = require('./configManager');
const { updateStatusPostForBot, formatDuration } = require('./statusPost');

async function handlePresenceUpdate(oldPresence, newPresence, client) {
    const botId = newPresence?.userId;
    if (!botId) return;
    const bot = getBot(botId);
    if (!bot) return;

    const targetUser = await client.users.fetch(botId).catch(() => null);
    if (!targetUser) return;

    const oldStatus = oldPresence ? oldPresence.status : 'offline';
    const newStatus = newPresence.status;
    const wasOffline = oldStatus === 'offline';
    const isOffline = newStatus === 'offline';
    if (wasOffline === isOffline) return;

    const timestamp = Date.now();

    if (isOffline) {
        pushHistory(botId, { event: 'offline', timestamp });
        await sendAlert(client, bot, targetUser, 'offline');
    } else {
        const refreshed = getBot(botId);
        const history = refreshed.history || [];
        let lastOffline = null;
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].event === 'offline' && !history[i].duration) {
                lastOffline = history[i];
                break;
            }
        }
        const duration = lastOffline ? timestamp - lastOffline.timestamp : null;
        if (duration != null) updateLastOfflineDuration(botId, duration);
        await sendAlert(client, bot, targetUser, 'online', duration);
    }

    updateStatusPostForBot(client, botId, { restick: true });
}

async function sendAlert(client, bot, targetUser, state, durationMs = null) {
    if (!bot.alertChannelId) return;
    try {
        const channel = await client.channels.fetch(bot.alertChannelId).catch(() => null);
        if (!channel) return;

        const content = bot.pingRoleId ? `<@&${bot.pingRoleId}>` : '';
        let embed;
        if (state === 'offline') {
            embed = new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle(`⚫ ${targetUser.username} went offline!`)
                .setDescription(`The bot went offline at <t:${Math.floor(Date.now() / 1000)}:f>`);
        } else {
            const durationStr = durationMs ? formatDuration(durationMs) : 'unknown time';
            embed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle(`🟢 ${targetUser.username} is back online!`)
                .setDescription(`The bot is back online. It was down for ${durationStr}.`);
        }
        await channel.send({ content, embeds: [embed] });
    } catch {}
}

module.exports = { handlePresenceUpdate };

// Built by Haymooed
