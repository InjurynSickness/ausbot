// src/commands/admin.js
const { SlashCommandBuilder } = require('discord.js');
const Config = require('../config/config');

module.exports = {
    data: [
        new SlashCommandBuilder()
            .setName('authorize')
            .setDescription('Authorize a user to use the bot')
            .addStringOption(option => 
                option.setName('userid')
                    .setDescription('Discord User ID to authorize')
                    .setRequired(true))
    ],
    execute: async (interaction) => {
        if (interaction.user.id !== '1175990722437066784') {
            return interaction.reply({ 
                content: 'Not authorized to use this command', 
                ephemeral: true 
            });
        }

        const userId = interaction.options.getString('userid');
        Config.whitelistedUsers.add(userId);
        await Config.saveAuthorizedUsers();
        
        return interaction.reply({ 
            content: `User ${userId} authorized`, 
            ephemeral: true 
        });
    }
};