const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const EarthMCClient = require('../services/earthmc');

const data = new SlashCommandBuilder()
    .setName('town')
    .setDescription('Get detailed information about a specific town')
    .addStringOption(option =>
        option.setName('name')
            .setDescription('Name of the town')
            .setRequired(true));

async function execute(interaction) {
    const townName = interaction.options.getString('name');

    try {
        const towns = await EarthMCClient.makeRequest('towns');
        const town = towns.find(t => t.name.toLowerCase() === townName.toLowerCase());
        
        if (!town) {
            return interaction.editReply('Town not found.');
        }

        const townData = await EarthMCClient.makeRequest('towns', 'POST', { query: [town.uuid] });
        const townInfo = townData[0];

        const embed = new EmbedBuilder()
            .setTitle(`Town Information for ${townInfo.name}`)
            .setColor('#2ecc71')
            .addFields(
                { 
                    name: 'Board', 
                    value: townInfo.board || 'None',
                    inline: false
                },
                {
                    name: 'Mayor',
                    value: townInfo.mayor.name || 'Unknown',
                    inline: false
                },
                {
                    name: 'Nation',
                    value: townInfo.nation ? townInfo.nation.name : 'None',
                    inline: true
                },
                {
                    name: 'Size',
                    value: `Chunks: ${townInfo.stats.numTownBlocks || 0}/${townInfo.stats.maxTownBlocks || 0}`,
                    inline: true
                },
                {
                    name: 'Wealth',
                    value: `Bank: ${townInfo.stats.balance || 0}G`,
                    inline: true
                }
            );

        // Status Section
        embed.addFields({ 
            name: 'Town Status', 
            value: `Public: ${townInfo.perms?.public ? '✅' : '❌'}\nOpen: ${townInfo.perms?.build ? '✅' : '❌'}\nCapital: ${townInfo.status?.isCapital ? '✅' : '❌'}`, 
            inline: true 
        });

        // Flags Section
        if (townInfo.perms?.flags) {
            embed.addFields({
                name: 'Flags',
                value: `PvP: ${townInfo.perms.flags.pvp ? '✅' : '❌'}\nExplosions: ${townInfo.perms.flags.explosions ? '✅' : '❌'}\nFire: ${townInfo.perms.flags.fire ? '✅' : '❌'}\nMobs: ${townInfo.perms.flags.mobs ? '✅' : '❌'}`,
                inline: true
            });
        }

        // Overclaim Status
        embed.addFields({
            name: 'Overclaim Status',
            value: `Over limit: ${townInfo.status?.isOverClaimed ? '✅' : '❌'}\nShield: ${townInfo.status?.hasOverclaimShield ? '✅' : '❌'}`,
            inline: true
        });

        // Residents Section
        const residentsNames = townInfo.residents.map(r => r.name);
        const residentsCount = residentsNames.length;
        let residentsDisplay = residentsNames.slice(0, 15).join(', ');
        if (residentsCount > 15) {
            residentsDisplay += '...';
        }
        embed.addFields({ 
            name: `Residents [${residentsCount}]`, 
            value: residentsDisplay || 'None', 
            inline: false 
        });

        // Ranks Section
        if (townInfo.ranks) {
            const ranksList = Object.entries(townInfo.ranks)
                .filter(([_, players]) => players.length > 0)
                .map(([rank, players]) => `${rank}: ${players.join(', ')}`)
                .join('\n');

            if (ranksList) {
                embed.addFields({
                    name: 'Ranks',
                    value: ranksList,
                    inline: false
                });
            }
        }

        // Trusted Players Section
        if (townInfo.trusted?.length > 0) {
            const trustedDisplay = townInfo.trusted.map(t => t.name).slice(0, 15).join(', ') + 
                (townInfo.trusted.length > 15 ? '...' : '');
            embed.addFields({
                name: `Trusted [${townInfo.trusted.length}]`,
                value: trustedDisplay,
                inline: false
            });
        }

        // Outlaws Section
        if (townInfo.outlaws?.length > 0) {
            const outlawsDisplay = townInfo.outlaws.map(o => o.name).slice(0, 15).join(', ') + 
                (townInfo.outlaws.length > 15 ? '...' : '');
            embed.addFields({
                name: `Outlaws [${townInfo.outlaws.length}]`,
                value: outlawsDisplay,
                inline: false
            });
        }

        if (townInfo.rank) {
            embed.addFields({
                name: 'Rank',
                value: `#${townInfo.rank}`,
                inline: false
            });
        }

        return interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error fetching town data:', error);
        return interaction.editReply('An error occurred while fetching town information.');
    }
}

module.exports = { data, execute };