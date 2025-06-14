// src/commands/admin.js
const { SlashCommandBuilder } = require('discord.js');
const Config = require('../config/config');
const { CHECK, X_MARK, FALLBACK } = require('../utils/emojis');

module.exports = {
    data: [
        new SlashCommandBuilder()
            .setName('authorize')
            .setDescription('Authorize or deauthorize a user to use the bot')
            .addStringOption(option => 
                option.setName('userid')
                    .setDescription('Discord User ID to authorize/deauthorize')
                    .setRequired(true))
            .addBooleanOption(option =>
                option.setName('authorized')
                    .setDescription('True to authorize, false to remove authorization')
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('whitelist')
            .setDescription('Enable/disable whitelist mode for the bot')
            .addBooleanOption(option =>
                option.setName('enabled')
                    .setDescription('True to enable whitelist (authorized users only), false for public access')
                    .setRequired(true))
    ],
    execute: async (interaction) => {
        // Only allow the owner to use admin commands
        if (interaction.user.id !== '1175990722437066784') {
            return interaction.reply({ 
                content: 'Not authorized to use this command', 
                ephemeral: true 
            });
        }

        if (interaction.commandName === 'authorize') {
            const userId = interaction.options.getString('userid');
            const authorized = interaction.options.getBoolean('authorized');

            if (authorized) {
                Config.whitelistedUsers.add(userId);
                await Config.saveAuthorizedUsers();
                return interaction.reply({ 
                    content: `User <@${userId}> (${userId}) has been authorized to use the bot`, 
                    ephemeral: true 
                });
            } else {
                Config.whitelistedUsers.delete(userId);
                await Config.saveAuthorizedUsers();
                return interaction.reply({ 
                    content: `User <@${userId}> (${userId}) has been removed from authorization`, 
                    ephemeral: true 
                });
            }
        }

        if (interaction.commandName === 'whitelist') {
            const enabled = interaction.options.getBoolean('enabled');
            Config.whitelistEnabled = enabled;
            await Config.saveAuthorizedUsers();

            const statusEmoji = enabled ? (CHECK || FALLBACK.CHECK) : (X_MARK || FALLBACK.X_MARK);
            const statusText = enabled ? 'enabled' : 'disabled';
            const description = enabled ? 
                'Only authorized users can use the bot' :
                'Bot is now public for everyone';

            return interaction.reply({
                content: `${statusEmoji} Whitelist mode **${statusText}** - ${description}`,
                ephemeral: true
            });
        }
    }
};