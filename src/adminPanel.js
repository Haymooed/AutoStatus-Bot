const fs = require('fs');
const path = require('path');
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
    UserSelectMenuBuilder, ChannelType,
} = require('discord.js');
const { getAllBots, getBot, upsertBot, removeBot, setGlobal, getConfig } = require('./configManager');
const { updateStatusPostForBot, CUSTOM_IMAGE_DIR } = require('./statusPost');

// ─── Panel state ────────────────────────────────────────────────────────────
// We encode the currently-selected bot in the panel's components custom IDs.
// Format:  panel:<action>[:<botId>][:<extra>]

function selectedBotIdFromMessage(message) {
    // Read it back from the embed footer where we stash it.
    const footer = message.embeds?.[0]?.footer?.text || '';
    const m = footer.match(/bot=(\d+)/);
    return m ? m[1] : null;
}

async function buildPanel(client, selectedBotId) {
    const bots = getAllBots();
    const ids = Object.keys(bots);

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🛠️ AutoStatus Admin Panel')
        .setDescription(
            ids.length === 0
                ? '_No bots tracked yet._ Use **Add Bot** below to start monitoring one.'
                : ids.map(id => `• <@${id}> ${id === selectedBotId ? '← *selected*' : ''}`).join('\n')
        )
        .setFooter({ text: `bot=${selectedBotId || 'none'} • interval=${getConfig().updateIntervalMinutes}m` });

    if (selectedBotId && bots[selectedBotId]) {
        const b = bots[selectedBotId];
        embed.addFields(
            { name: 'Alerts channel',     value: b.alertChannelId ? `<#${b.alertChannelId}>` : '_unset_', inline: true },
            { name: 'Status-post channel', value: b.statusPostChannelId ? `<#${b.statusPostChannelId}>` : '_unset_', inline: true },
            { name: 'Ping role',          value: b.pingRoleId ? `<@&${b.pingRoleId}>` : '_unset_', inline: true },
            { name: 'Custom image',       value: b.customImageFilename || '_none_', inline: true },
            { name: 'Incidents',          value: `${(b.history || []).filter(h => h.event === 'offline').length}`, inline: true },
        );
    }

    const rows = [];

    // Row 1: bot selector
    if (ids.length > 0) {
        const select = new StringSelectMenuBuilder()
            .setCustomId('panel:select_bot')
            .setPlaceholder('Select a tracked bot to configure…')
            .addOptions(ids.map(id => {
                const cached = client.users.cache.get(id);
                return {
                    label: cached ? cached.username.slice(0, 100) : `Bot ${id}`,
                    description: id,
                    value: id,
                    default: id === selectedBotId,
                };
            }));
        rows.push(new ActionRowBuilder().addComponents(select));
    }

    // Row 2: add / remove / interval
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel:add_bot').setLabel('Add Bot').setStyle(ButtonStyle.Success).setEmoji('➕'),
        new ButtonBuilder().setCustomId('panel:remove_bot').setLabel('Remove Bot').setStyle(ButtonStyle.Danger).setEmoji('🗑️').setDisabled(!selectedBotId),
        new ButtonBuilder().setCustomId('panel:set_interval').setLabel('Set Interval').setStyle(ButtonStyle.Secondary).setEmoji('⏲️'),
        new ButtonBuilder().setCustomId('panel:refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
    ));

    // Row 3 + 4: per-bot config buttons (only enabled if a bot is selected)
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel:set_alerts').setLabel('Alerts Channel').setStyle(ButtonStyle.Primary).setDisabled(!selectedBotId),
        new ButtonBuilder().setCustomId('panel:set_status').setLabel('Status Channel').setStyle(ButtonStyle.Primary).setDisabled(!selectedBotId),
        new ButtonBuilder().setCustomId('panel:set_role').setLabel('Ping Role').setStyle(ButtonStyle.Primary).setDisabled(!selectedBotId),
    ));
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel:clear_image').setLabel('Clear Image').setStyle(ButtonStyle.Secondary).setDisabled(!selectedBotId),
        new ButtonBuilder().setCustomId('panel:clear_history').setLabel('Clear History').setStyle(ButtonStyle.Secondary).setDisabled(!selectedBotId),
        new ButtonBuilder().setCustomId('panel:resend_status').setLabel('Resend Status Post').setStyle(ButtonStyle.Secondary).setDisabled(!selectedBotId),
    ));

    return { embed, rows };
}

async function renderPanel(interaction, selectedBotId) {
    const { embed, rows } = await buildPanel(interaction.client, selectedBotId);
    const payload = { embeds: [embed], components: rows };
    if (interaction.deferred || interaction.replied) {
        return interaction.editReply(payload);
    }
    return interaction.update(payload).catch(() => interaction.reply({ ...payload, ephemeral: true }));
}

// ─── Sub-prompts (replace components for a single-step pick) ────────────────

function promptUserSelect(customId, placeholder) {
    return new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1),
    );
}
function promptChannelSelect(customId, placeholder) {
    return new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId(customId).setPlaceholder(placeholder)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    );
}
function promptRoleSelect(customId, placeholder) {
    return new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1),
    );
}

async function showPrompt(interaction, title, components) {
    const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(title).setFooter({ text: 'This prompt times out — pick something, or click Cancel.' });
    const cancel = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({ embeds: [embed], components: [...components, cancel] });
}

// ─── Interaction router ─────────────────────────────────────────────────────

async function handleComponent(interaction) {
    const id = interaction.customId;
    if (!id.startsWith('panel:')) return false;

    const action = id.split(':')[1];
    const selected = selectedBotIdFromMessage(interaction.message);

    try {
        switch (action) {
            case 'select_bot': {
                const newId = interaction.values?.[0];
                return renderPanel(interaction, newId);
            }
            case 'refresh':
            case 'cancel': {
                return renderPanel(interaction, selected);
            }
            case 'add_bot': {
                return showPrompt(interaction, 'Pick the bot user to start tracking', [promptUserSelect('panel:add_bot_pick', 'Choose a bot user…')]);
            }
            case 'add_bot_pick': {
                const user = interaction.users?.first();
                if (!user) return renderPanel(interaction, selected);
                if (!user.bot) {
                    await interaction.update({
                        embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('That user is not a bot.').setDescription('Pick an actual bot account.')],
                        components: [new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('panel:refresh').setLabel('Back').setStyle(ButtonStyle.Secondary),
                        )],
                    });
                    return true;
                }
                upsertBot(user.id, {});
                return renderPanel(interaction, user.id);
            }
            case 'remove_bot': {
                if (!selected) return renderPanel(interaction, selected);
                const b = getBot(selected);
                if (b?.customImageFilename) {
                    const p = path.join(CUSTOM_IMAGE_DIR, b.customImageFilename);
                    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
                }
                removeBot(selected);
                return renderPanel(interaction, null);
            }
            case 'set_alerts': {
                return showPrompt(interaction, 'Pick the alerts channel', [promptChannelSelect(`panel:set_alerts_pick:${selected}`, 'Alerts channel…')]);
            }
            case 'set_status': {
                return showPrompt(interaction, 'Pick the status-post channel', [promptChannelSelect(`panel:set_status_pick:${selected}`, 'Status-post channel…')]);
            }
            case 'set_role': {
                return showPrompt(interaction, 'Pick the ping role', [promptRoleSelect(`panel:set_role_pick:${selected}`, 'Ping role…')]);
            }
            case 'set_alerts_pick': {
                const botId = id.split(':')[2];
                const ch = interaction.channels?.first();
                if (botId && ch) upsertBot(botId, { alertChannelId: ch.id });
                return renderPanel(interaction, botId || selected);
            }
            case 'set_status_pick': {
                const botId = id.split(':')[2];
                const ch = interaction.channels?.first();
                if (botId && ch) {
                    upsertBot(botId, { statusPostChannelId: ch.id, statusPostMessageId: null });
                    updateStatusPostForBot(interaction.client, botId);
                }
                return renderPanel(interaction, botId || selected);
            }
            case 'set_role_pick': {
                const botId = id.split(':')[2];
                const role = interaction.roles?.first();
                if (botId && role) upsertBot(botId, { pingRoleId: role.id });
                return renderPanel(interaction, botId || selected);
            }
            case 'clear_image': {
                if (!selected) return renderPanel(interaction, selected);
                const b = getBot(selected);
                if (b?.customImageFilename) {
                    const p = path.join(CUSTOM_IMAGE_DIR, b.customImageFilename);
                    if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
                }
                upsertBot(selected, { customImageFilename: null });
                updateStatusPostForBot(interaction.client, selected);
                return renderPanel(interaction, selected);
            }
            case 'clear_history': {
                if (selected) upsertBot(selected, { history: [] });
                return renderPanel(interaction, selected);
            }
            case 'resend_status': {
                if (selected) await updateStatusPostForBot(interaction.client, selected, { restick: true });
                return renderPanel(interaction, selected);
            }
            case 'set_interval': {
                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('panel:set_interval_pick').setPlaceholder('Update interval (minutes)…').addOptions(
                        [1, 2, 5, 10, 15, 30, 60].map(n => ({ label: `${n} minute${n === 1 ? '' : 's'}`, value: String(n) })),
                    ),
                );
                return showPrompt(interaction, 'Choose status-post refresh interval', [row]);
            }
            case 'set_interval_pick': {
                const n = parseInt(interaction.values?.[0], 10);
                if (Number.isFinite(n)) setGlobal({ updateIntervalMinutes: n });
                return renderPanel(interaction, selected);
            }
        }
    } catch (err) {
        try {
            await interaction.reply({ content: `Panel error: ${err.message}`, ephemeral: true });
        } catch {}
    }
    return true;
}

module.exports = { buildPanel, renderPanel, handleComponent };

// Built by Haymooed
