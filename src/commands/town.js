const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const EarthMCClient = require('../services/earthmc');
const { CHECK, X_MARK, FALLBACK } = require('../utils/emojis');

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
            .setColor('#FF0000');

        // First row: Board, Nation, Mayor
        embed.addFields(
            { name: 'Board', value: townInfo.board || 'None', inline: true },
            { name: 'Nation', value: townInfo.nation ? townInfo.nation.name : 'None', inline: true },
            { name: 'Mayor', value: townInfo.mayor.name || 'Unknown', inline: true }
        );

        // Second row: Remove the old nation row
        // embed.addFields(
        //     { name: 'Nation', value: townInfo.nation ? townInfo.nation.name : 'None', inline: true },
        //     { name: '\u200b', value: '\u200b', inline: true },
        //     { name: '\u200b', value: '\u200b', inline: true }
        // );

        // Third row: Residents, Outlaws, Trusted counts with lists below each
        const residentsCount = townInfo.residents?.length || 0;
        const outlawsCount = townInfo.outlaws?.length || 0;
        const trustedCount = townInfo.trusted?.length || 0;

        // Residents section
        const residentsDisplay = residentsCount > 0 ? 
            `**[${residentsCount}]**\n\`\`\`\n${residentsCount > 20 ? 
                townInfo.residents.slice(0, 20).map(r => r.name).join(', ') + `, and ${residentsCount - 20} more...` :
                townInfo.residents.map(r => r.name).join(', ')
            }\n\`\`\`` : 
            `**[0]**\n\`\`\`\nNone\n\`\`\``;

        // Outlaws section  
        const outlawsDisplay = outlawsCount > 0 ? 
            `**[${outlawsCount}]**\n\`\`\`\n${outlawsCount > 20 ?
                townInfo.outlaws.slice(0, 20).map(o => o.name).join(', ') + `, and ${outlawsCount - 20} more...` :
                townInfo.outlaws.map(o => o.name).join(', ')
            }\n\`\`\`` : 
            `**[0]**\n\`\`\`\nNone\n\`\`\``;

        // Trusted section
        const trustedDisplay = trustedCount > 0 ? 
            `**[${trustedCount}]**\n\`\`\`\n${trustedCount > 20 ?
                townInfo.trusted.slice(0, 20).map(t => t.name).join(', ') + `, and ${trustedCount - 20} more...` :
                townInfo.trusted.map(t => t.name).join(', ')
            }\n\`\`\`` : 
            `**[0]**\n\`\`\`\nNone\n\`\`\``;

        embed.addFields(
            { name: 'Residents', value: residentsDisplay, inline: true },
            { name: 'Outlaws', value: outlawsDisplay, inline: true },
            { name: 'Trusted', value: trustedDisplay, inline: true }
        );

        // Fourth row: Status, Stats, Flags
        const statusValues = [
            `Public: ${townInfo.perms?.public ? (CHECK || FALLBACK.CHECK) : (X_MARK || FALLBACK.X_MARK)}`,
            `Open: ${townInfo.perms?.build ? (CHECK || FALLBACK.CHECK) : (X_MARK || FALLBACK.X_MARK)}`,
            `Capital: ${townInfo.status?.isCapital ? (CHECK || FALLBACK.CHECK) : (X_MARK || FALLBACK.X_MARK)}`,
            `Overclaimed: ${townInfo.status?.isOverClaimed ? (CHECK || FALLBACK.CHECK) : (X_MARK || FALLBACK.X_MARK)}`,
            `Overclaim Shield: ${townInfo.status?.hasOverclaimShield ? (CHECK || FALLBACK.CHECK) : (X_MARK || FALLBACK.X_MARK)}`,
            `Ruined: ${townInfo.status?.isRuined ? (CHECK || FALLBACK.CHECK) : (X_MARK || FALLBACK.X_MARK)}`
        ];

        const statsValues = [
            `Size: ${townInfo.stats?.numTownBlocks || 0}/${townInfo.stats?.maxTownBlocks || 0}`,
            `Outlaws: [${outlawsCount}]`,
            `Bank: ${townInfo.stats?.balance || 0}G`
        ];

        const flagValues = [
            `pvp: ${townInfo.perms?.flags?.pvp ? (CHECK || FALLBACK.CHECK) : (X_MARK || FALLBACK.X_MARK)}`,
            `explosions: ${townInfo.perms?.flags?.explosions ? (CHECK || FALLBACK.CHECK) : (X_MARK || FALLBACK.X_MARK)}`,
            `fire: ${townInfo.perms?.flags?.fire ? (CHECK || FALLBACK.CHECK) : (X_MARK || FALLBACK.X_MARK)}`,
            `mobs: ${townInfo.perms?.flags?.mobs ? (CHECK || FALLBACK.CHECK) : (X_MARK || FALLBACK.X_MARK)}`
        ];

        embed.addFields(
            { name: 'Status', value: statusValues.join('\n'), inline: true },
            { name: 'Stats', value: statsValues.join('\n'), inline: true },
            { name: 'Flags', value: flagValues.join('\n'), inline: true }
        );

        // Ranks Section (if any)
        if (townInfo.ranks) {
            const ranksList = Object.entries(townInfo.ranks)
                .filter(([_, players]) => players.length > 0)
                .map(([rank, players]) => `**${rank}:** ${players.join(', ')}`)
                .join('\n');

            if (ranksList) {
                embed.addFields({
                    name: 'Ranks',
                    value: ranksList,
                    inline: false
                });
            }
        }

        // Rank at bottom (if available)
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