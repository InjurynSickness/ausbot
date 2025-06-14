// src/commands/info.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const EarthMCClient = require('../services/earthmc');

const commands = {
    async playercount(interaction) {
        const data = await EarthMCClient.makeRequest('');
        const embed = new EmbedBuilder()
            .setTitle('📊 Player Count')
            .setDescription(`**Current Online Players:** ${data.stats.numOnlinePlayers}`)
            .setColor('#2ecc71')
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    },

    async seen(interaction) {
        const player = interaction.options.getString('player');
        const playerData = await EarthMCClient.makeRequest('players', 'POST', { query: [player] });
        if (!playerData[0]) return interaction.editReply('Player not found');
        
        const lastOnline = new Date(playerData[0].timestamps.lastOnline);
        const status = playerData[0].status.isOnline ? 
            '🟢 Currently Online' : 
            `🔴 Last seen <t:${Math.floor(lastOnline.getTime() / 1000)}:R>`;

        const embed = new EmbedBuilder()
            .setTitle(`👤 Player Status - ${player}`)
            .setDescription(status)
            .setColor(playerData[0].status.isOnline ? '#2ecc71' : '#e74c3c')
            .setTimestamp();
            
        return interaction.editReply({ embeds: [embed] });
    }
};

module.exports = {
    data: [
        new SlashCommandBuilder()
            .setName('playercount')
            .setDescription('Get current online player count'),
        new SlashCommandBuilder()
            .setName('seen')
            .setDescription('Check when a player was last online')
            .addStringOption(option => 
                option.setName('player')
                    .setDescription('Player name')
                    .setRequired(true))
    ],
    execute: async (interaction) => {
        return commands[interaction.commandName](interaction);
    }
};