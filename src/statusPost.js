const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getAllBots, upsertBot } = require('./configManager');

const CUSTOM_IMAGE_DIR = path.join(__dirname, '..', 'data');

const STATUS_META = {
    online:  { label: 'Online',          color: 0x57F287, icon: '🟢' },
    idle:    { label: 'Idle',            color: 0xFEE75C, icon: '🌙' },
    dnd:     { label: 'Do Not Disturb',  color: 0xFEE75C, icon: '🔴' },
    offline: { label: 'Offline',         color: 0xED4245, icon: '⚫' },
};

function formatDuration(ms) {
    if (!ms && ms !== 0) return 'N/A';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    let parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
}

function getCustomImagePath(bot) {
    if (!bot.customImageFilename) return null;
    const filePath = path.join(CUSTOM_IMAGE_DIR, bot.customImageFilename);
    return fs.existsSync(filePath) ? filePath : null;
}

function buildStatusEmbed({ targetUser, presence, bot, footerText }) {
    let currentStatus = 'offline';
    if (presence && presence.status && STATUS_META[presence.status]) {
        currentStatus = presence.status;
    }
    const meta = STATUS_META[currentStatus];

    const history = bot.history || [];
    const outages = history.filter(h => h.event === 'offline');

    let totalOutageDuration = 0;
    let lastOutage = null;
    for (const outage of outages) {
        if (outage.duration) {
            totalOutageDuration += outage.duration;
            lastOutage = outage;
        } else if (currentStatus === 'offline') {
            totalOutageDuration += Date.now() - outage.timestamp;
            lastOutage = outage;
        }
    }

    const trackingStart = history.length > 0 ? history[0].timestamp : Date.now();
    const totalTrackedTime = Math.max(Date.now() - trackingStart, 1);
    let downtimePercent = (totalOutageDuration / totalTrackedTime) * 100;
    if (downtimePercent > 100) downtimePercent = 100;
    const uptimePercent = 100 - downtimePercent;

    const lastOutageStr = lastOutage
        ? `${formatDuration(Date.now() - lastOutage.timestamp)} ago`
        : 'Never';
    const lastOutageDurationStr = !lastOutage
        ? 'N/A'
        : lastOutage.duration ? formatDuration(lastOutage.duration) : 'Ongoing';

    const nowUnix = Math.floor(Date.now() / 1000);

    const embed = new EmbedBuilder()
        .setColor(meta.color)
        .setAuthor({
            name: `${targetUser.username} — Status Monitor`,
            iconURL: targetUser.displayAvatarURL({ size: 128 }),
        })
        .setTitle(`${meta.icon}  ${meta.label}`)
        .setDescription(`Last updated <t:${nowUnix}:R> • <t:${nowUnix}:t>`)
        .addFields(
            { name: '📈 Uptime',          value: `\`${uptimePercent.toFixed(2)}%\``,   inline: true },
            { name: '📉 Downtime',        value: `\`${downtimePercent.toFixed(2)}%\``, inline: true },
            { name: '🚨 Total Incidents', value: `\`${outages.length}\``,              inline: true },
            { name: '⏱️ Last Outage',    value: lastOutageStr,         inline: true },
            { name: '🕒 Outage Duration', value: lastOutageDurationStr, inline: true },
            { name: '​',                  value: '​',                  inline: true },
        )
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }));

    if (footerText) embed.setFooter({ text: footerText });

    const files = [];
    const customImagePath = getCustomImagePath(bot);
    if (customImagePath) {
        const filename = path.basename(customImagePath);
        files.push(new AttachmentBuilder(customImagePath, { name: filename }));
        embed.setImage(`attachment://${filename}`);
    }

    return { embed, files };
}

async function fetchPresence(client, botId, channel) {
    if (!channel || !channel.guild) return null;
    const member = await channel.guild.members.fetch(botId).catch(() => null);
    return member ? member.presence : null;
}

// Per-bot lock so concurrent sticky-reposts don't race and create dupes.
const updatingLocks = new Map();

async function updateStatusPostForBot(client, botId, { restick = false } = {}) {
    if (updatingLocks.get(botId)) return;
    updatingLocks.set(botId, true);
    try {
        const bot = getAllBots()[botId];
        if (!bot || !bot.statusPostChannelId) return;

        const channel = await client.channels.fetch(bot.statusPostChannelId).catch(() => null);
        if (!channel) return;

        const targetUser = await client.users.fetch(botId).catch(() => null);
        if (!targetUser) return;

        const presence = await fetchPresence(client, botId, channel);
        const { embed, files } = buildStatusEmbed({ targetUser, presence, bot });

        if (restick) {
            // Delete old, send fresh at the bottom.
            if (bot.statusPostMessageId) {
                try {
                    const old = await channel.messages.fetch(bot.statusPostMessageId);
                    await old.delete().catch(() => {});
                } catch {}
            }
            const sent = await channel.send({ embeds: [embed], files });
            upsertBot(botId, { statusPostMessageId: sent.id });
            return;
        }

        let message = null;
        if (bot.statusPostMessageId) {
            message = await channel.messages.fetch(bot.statusPostMessageId).catch(() => null);
        }
        if (message) {
            await message.edit({ embeds: [embed], files, attachments: [] });
        } else {
            const sent = await channel.send({ embeds: [embed], files });
            upsertBot(botId, { statusPostMessageId: sent.id });
        }
    } catch {} finally {
        updatingLocks.delete(botId);
    }
}

async function updateAllStatusPosts(client) {
    const bots = getAllBots();
    await Promise.all(Object.keys(bots).map(id => updateStatusPostForBot(client, id)));
}

function startInterval(client) {
    const { getConfig } = require('./configManager');
    const minutes = getConfig().updateIntervalMinutes || 5;
    updateAllStatusPosts(client);
    setInterval(() => updateAllStatusPosts(client), minutes * 60 * 1000);
}

// ── Sticky message handler ──────────────────────────────────────────────────
const stickyDebouncers = new Map();
const STICKY_DELAY_MS = 2500;

function handleStickyMessage(client, message) {
    if (!message.guild) return;
    // Ignore our own messages: status posts we just sent would otherwise
    // trigger an immediate restick loop (gateway MESSAGE_CREATE can arrive
    // before we've stored the new statusPostMessageId in config).
    // Alerts from us already trigger an explicit restick in monitor.js.
    if (message.author?.id === client.user?.id) return;

    const bots = getAllBots();
    const matches = Object.values(bots).filter(b => b.statusPostChannelId === message.channel.id);
    if (matches.length === 0) return;
    for (const bot of matches) {
        if (message.id === bot.statusPostMessageId) continue;
        scheduleRestick(client, bot.botId, message.channel.id);
    }
}

function scheduleRestick(client, botId, channelId) {
    const key = `${botId}:${channelId}`;
    if (stickyDebouncers.has(key)) clearTimeout(stickyDebouncers.get(key));
    const t = setTimeout(() => {
        stickyDebouncers.delete(key);
        updateStatusPostForBot(client, botId, { restick: true });
    }, STICKY_DELAY_MS);
    stickyDebouncers.set(key, t);
}

module.exports = {
    buildStatusEmbed,
    updateStatusPostForBot,
    updateAllStatusPosts,
    startInterval,
    handleStickyMessage,
    formatDuration,
    CUSTOM_IMAGE_DIR,
};

// Built by Haymooed
