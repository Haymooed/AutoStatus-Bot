const { SlashCommandBuilder } = require('discord.js');
const { getAllBots, getBot } = require('../configManager');
const { buildStatusEmbed } = require('../statusPost');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Manually shows current bot status and stats')
        .addUserOption(option =>
            option.setName('bot').setDescription('Which tracked bot (defaults to the only one if just one is configured)').setRequired(false)
        ),
    async execute(interaction) {
        const userOpt = interaction.options.getUser('bot');
        const all = getAllBots();
        const ids = Object.keys(all);

        if (ids.length === 0) {
            return interaction.reply({ content: 'No bots are configured. Use `/admin panel` to add one.', ephemeral: true });
        }

        let bot;
        if (userOpt) {
            bot = getBot(userOpt.id);
            if (!bot) return interaction.reply({ content: `${userOpt.username} is not currently being tracked.`, ephemeral: true });
        } else if (ids.length === 1) {
            bot = all[ids[0]];
        } else {
            return interaction.reply({ content: `Multiple bots are tracked — pass the \`bot\` option. Tracked: ${ids.map(id => `<@${id}>`).join(', ')}`, ephemeral: true });
        }

        const targetUser = await interaction.client.users.fetch(bot.botId).catch(() => null);
        if (!targetUser) return interaction.reply({ content: 'Target bot not found.', ephemeral: true });

        let presence = null;
        if (interaction.guild) {
            const member = await interaction.guild.members.fetch(bot.botId).catch(() => null);
            if (member) presence = member.presence;
        }

        const { embed, files } = buildStatusEmbed({
            targetUser,
            presence,
            bot,
            footerText: `Requested by ${interaction.user.tag}`,
        });
        return interaction.reply({ embeds: [embed], files });
    },
};

// Built by Haymooed
