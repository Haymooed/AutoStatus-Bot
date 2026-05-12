const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { upsertBot, getBot } = require('../configManager');
const { updateStatusPostForBot, CUSTOM_IMAGE_DIR } = require('../statusPost');
const { buildPanel } = require('../adminPanel');

const ALLOWED_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('AutoStatus admin tools')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sc => sc.setName('panel').setDescription('Open the interactive admin panel'))
        .addSubcommand(sc => sc
            .setName('setimage')
            .setDescription('Upload an image for a tracked bot\'s status embed')
            .addUserOption(o => o.setName('bot').setDescription('Tracked bot').setRequired(true))
            .addAttachmentOption(o => o.setName('image').setDescription('PNG/JPG/GIF/WEBP, max 8MB').setRequired(true))
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'panel') {
            const { embed, rows } = await buildPanel(interaction.client, null);
            return interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
        }

        if (sub === 'setimage') {
            const user = interaction.options.getUser('bot');
            const attachment = interaction.options.getAttachment('image');
            if (!getBot(user.id)) {
                return interaction.reply({ content: `${user.username} is not tracked yet. Add it via \`/admin panel\` first.`, ephemeral: true });
            }
            const ext = (attachment.name?.split('.').pop() || '').toLowerCase();
            if (!attachment.contentType?.startsWith('image/') || !ALLOWED_IMAGE_EXTS.has(ext)) {
                return interaction.reply({ content: 'That attachment is not a supported image (png/jpg/gif/webp).', ephemeral: true });
            }
            if (attachment.size > MAX_IMAGE_BYTES) {
                return interaction.reply({ content: 'Image is too large (max 8MB).', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            try {
                fs.mkdirSync(CUSTOM_IMAGE_DIR, { recursive: true });
                const bot = getBot(user.id);
                if (bot?.customImageFilename) {
                    const oldPath = path.join(CUSTOM_IMAGE_DIR, bot.customImageFilename);
                    if (fs.existsSync(oldPath)) { try { fs.unlinkSync(oldPath); } catch {} }
                }
                const filename = `${user.id}.${ext}`;
                const filePath = path.join(CUSTOM_IMAGE_DIR, filename);
                const res = await fetch(attachment.url);
                if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
                fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
                upsertBot(user.id, { customImageFilename: filename });
                updateStatusPostForBot(interaction.client, user.id);
                return interaction.editReply({ content: `Image saved for <@${user.id}>. Status post will refresh shortly.` });
            } catch (err) {
                return interaction.editReply({ content: `Failed to save image: ${err.message}` });
            }
        }
    },
};

// Built by Haymooed
