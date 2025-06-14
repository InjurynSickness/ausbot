const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const EarthMCClient = require('../services/earthmc');

const data = new SlashCommandBuilder()
    .setName('nation')
    .setDescription('Get information about a nation')
    .addStringOption(option =>
        option.setName('name')
            .setDescription('Name of the nation')
            .setRequired(true));

async function execute(interaction) {
    const nationName = interaction.options.getString('name');

    try {
        const nations = await EarthMCClient.makeRequest('nations', 'POST', { query: [nationName] });
        if (!nations[0]) {
            return interaction.editReply('Nation not found.');
        }

        const nationInfo = nations[0];

        const embed = new EmbedBuilder()
            .setTitle(`Nation Info | ${nationInfo.name}`)
            .setColor('#2ecc71')
            .addFields(
                {
                    name: 'King',
                    value: nationInfo.king.name || 'Unknown',
                    inline: true
                },
                {
                    name: 'Capital',
                    value: nationInfo.capital?.name || 'None',
                    inline: true
                },
                {
                    name: 'Size/Worth',
                    value: `Chunks: ${nationInfo.stats.numTownBlocks || 0}\nGold: ${nationInfo.stats.balance || 0}`,
                    inline: true
                },
                {
                    name: 'Residents',
                    value: nationInfo.stats.numResidents?.toString() || '0',
                    inline: true
                }
            );

        // Towns Section
        embed.addFields({
            name: `Towns [${nationInfo.towns.length}]`,
            value: nationInfo.towns.map(t => t.name).join(', ') || 'None',
            inline: false
        });

        // Nation Ranks Section
        if (nationInfo.ranks) {
            const ranksList = Object.entries(nationInfo.ranks)
                .filter(([_, players]) => players.length > 0)
                .map(([rank, players]) => `${rank}: ${players.join(', ')}`)
                .join('\n');

            if (ranksList) {
                embed.addFields({
                    name: '👥 Ranks',
                    value: ranksList,
                    inline: false
                });
            }
        }

        // Rank at bottom
        if (nationInfo.rank) {
            embed.addFields({
                name: '🏆 Rank',
                value: `#${nationInfo.rank}`,
                inline: false
            });
        }

        return interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error fetching nation data:', error);
        return interaction.editReply('An error occurred while fetching nation information.');
    }
}

module.exports = { data, execute };