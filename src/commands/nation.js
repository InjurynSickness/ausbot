const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const EarthMCClient = require('../services/earthmc');
const axios = require('axios');

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

        // Get alliance data
        let allianceData = [];
        try {
            const allianceResponse = await axios.get('https://emctoolkit.vercel.app/api/aurora/alliances');
            allianceData = allianceResponse.data;
        } catch (error) {
            console.error('Error fetching alliance data:', error);
        }

        // Find which alliances this nation belongs to
        const nationAlliances = allianceData.filter(alliance => 
            alliance.nations.some(nation => nation.toLowerCase() === nationInfo.name.toLowerCase())
        );

        const embed = new EmbedBuilder()
            .setTitle(`Nation Info | ${nationInfo.name}`)
            .setColor('#FF0000'); // Red color

        // First row: Leader, Capital, Board
        // Truncate board message if it's too long
        let boardValue = 'None';
        if (nationInfo.board && nationInfo.board.trim()) {
            const board = nationInfo.board.trim();
            boardValue = board.length > 50 ? board.substring(0, 50) + '...' : board;
        }

        embed.addFields(
            { name: 'Leader', value: nationInfo.king?.name || 'Unknown', inline: true },
            { name: 'Capital', value: nationInfo.capital?.name || 'None', inline: true },
            { name: 'Board', value: boardValue, inline: true }
        );

        // Second row: Residents, Size, Nation Bonus
        const totalResidents = `${nationInfo.stats?.numResidents || 0}`;
        const sizeInfo = `${nationInfo.stats?.numTownBlocks || 0} Chunks`;
        
        // Calculate nation bonus
        const calculateNationBonus = (residents) => {
            if (residents >= 200) return 100;
            if (residents >= 120) return 80;
            if (residents >= 80) return 60;
            if (residents >= 60) return 50;
            if (residents >= 40) return 30;
            if (residents >= 20) return 10;
            return 0;
        };
        
        const nationBonus = calculateNationBonus(nationInfo.stats?.numResidents || 0);
        const bonusInfo = `${nationBonus} Chunks`;

        embed.addFields(
            { name: 'Residents', value: totalResidents, inline: true },
            { name: 'Size', value: sizeInfo, inline: true },
            { name: 'Nation Bonus', value: bonusInfo, inline: true }
        );

        // Towns section
        if (nationInfo.towns && nationInfo.towns.length > 0) {
            const townsCount = nationInfo.towns.length;
            
            // Show up to 20 towns, then add "and more..." if there are additional ones
            const townsList = nationInfo.towns.slice(0, 20).map(t => t.name).join(', ');
            const townsDisplay = townsCount > 20 ? `${townsList}, and ${townsCount - 20} more...` : townsList;
            
            embed.addFields({
                name: `Towns [${townsCount}]`,
                value: `\`\`\`\n${townsDisplay}\n\`\`\``,
                inline: false
            });
        }

        // Alliances section
        if (nationAlliances.length > 0) {
            const alliancesList = nationAlliances.map(alliance => alliance.allianceName).join(', ');
            embed.addFields({
                name: `Alliances [${nationAlliances.length}]`,
                value: `\`\`\`\n${alliancesList}\n\`\`\``,
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