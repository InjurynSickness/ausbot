const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const EarthMCClient = require('../services/earthmc');

const commands = {
    async online(interaction) {
        const location = interaction.options.getString('location');
        const type = interaction.options.getString('type');

        const getOnlinePlayers = async (residents) => {
            const residentQueries = residents.map(r => r.uuid);
            const playersData = await EarthMCClient.makeRequest('players', 'POST', { query: residentQueries });
            return playersData.filter(p => p.status.isOnline).map(p => p.name);
        };

        let onlineResidents = [];
        let locationName = '';

        if (type === 'town') {
            const townData = await EarthMCClient.makeRequest('towns', 'POST', { query: [location] });
            if (!townData[0]) return interaction.editReply('Town not found');
            onlineResidents = await getOnlinePlayers(townData[0].residents);
            locationName = townData[0].name;
        } else {
            const nationData = await EarthMCClient.makeRequest('nations', 'POST', { query: [location] });
            if (!nationData[0]) return interaction.editReply('Nation not found');
            
            const townQueries = nationData[0].towns.map(t => t.uuid);
            const townsData = await EarthMCClient.makeRequest('towns', 'POST', { query: townQueries });
            
            const allResidents = townsData.flatMap(t => t.residents);
            onlineResidents = await getOnlinePlayers(allResidents);
            locationName = nationData[0].name;
        }

        const embed = new EmbedBuilder()
            .setTitle(`🎮 Online Players - ${type === 'town' ? '🏠' : '👑'} ${locationName}`)
            .setDescription(onlineResidents.length ? onlineResidents.join(', ') : 'No online players')
            .setColor('#FF0000')
            .setTimestamp()
            .setFooter({ text: `Total: ${onlineResidents.length} players online` });
        return interaction.editReply({ embeds: [embed] });
    },

    async calculatepurge(interaction) {
        const player = interaction.options.getString('player');
        const playerData = await EarthMCClient.makeRequest('players', 'POST', { query: [player] });
        if (!playerData[0]) return interaction.editReply('Player not found');

        const lastOnline = new Date(playerData[0].timestamps.lastOnline);
        const purgeDate = new Date(lastOnline);
        purgeDate.setDate(purgeDate.getDate() + 42);
        purgeDate.setUTCHours(10, 0, 0, 0);

        const embed = new EmbedBuilder()
            .setTitle(`⏰ Purge Calculator - ${player}`)
            .addFields(
                { name: 'Last Online', value: `<t:${Math.floor(lastOnline.getTime() / 1000)}:F>`, inline: true },
                { name: 'Purges On', value: `<t:${Math.floor(purgeDate.getTime() / 1000)}:F>`, inline: true }
            )
            .setColor('#FF0000')
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    }
};

module.exports = {
    data: [
        new SlashCommandBuilder()
            .setName('online')
            .setDescription('List online players in a town/nation')
            .addStringOption(option => 
                option.setName('location')
                    .setDescription('Town/Nation name')
                    .setRequired(true))
            .addStringOption(option => 
                option.setName('type')
                    .setDescription('Location type')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Town', value: 'town' },
                        { name: 'Nation', value: 'nation' }
                    )),
        new SlashCommandBuilder()
            .setName('calculatepurge')
            .setDescription('Calculate when a player will purge')
            .addStringOption(option => 
                option.setName('player')
                    .setDescription('Player name')
                    .setRequired(true))
    ],
    execute: async (interaction) => {
        return commands[interaction.commandName](interaction);
    }
};