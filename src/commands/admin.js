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
                    .setRequired(true)),
        new SlashCommandBuilder()
            .setName('forceglobal')
            .setDescription('Force refresh global commands everywhere (Owner only)'),
        new SlashCommandBuilder()
            .setName('debugguild')
            .setDescription('Debug commands in a specific guild')
            .addStringOption(option =>
                option.setName('guildid')
                    .setDescription('Guild ID to check (leave empty for current guild)')
                    .setRequired(false))
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

        if (interaction.commandName === 'forceglobal') {
            try {
                // Clear all global commands first
                await interaction.client.application.commands.set([]);
                await interaction.reply({ 
                    content: '🔄 Clearing global commands...', 
                    ephemeral: true 
                });
                
                // Wait 3 seconds
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Re-register all global commands
                const commands = require('./index');
                await interaction.client.application.commands.set(commands.data);
                
                await interaction.editReply({ 
                    content: '✅ Global commands refreshed! May take up to 1 hour to appear in all servers.\n\n' +
                            '**Users in affected servers should:**\n' +
                            '• Restart Discord completely\n' +
                            '• Wait 10-15 minutes\n' +
                            '• Try using Discord web/mobile if desktop doesn\'t work'
                });
                
            } catch (error) {
                console.error('Error refreshing global commands:', error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.editReply({ 
                        content: '❌ Error refreshing global commands: ' + error.message
                    });
                } else {
                    await interaction.reply({ 
                        content: '❌ Error refreshing global commands: ' + error.message,
                        ephemeral: true
                    });
                }
            }
        }

        if (interaction.commandName === 'debugguild') {
            const targetGuildId = interaction.options.getString('guildid') || interaction.guildId;
            
            try {
                // Get the target guild
                const targetGuild = interaction.client.guilds.cache.get(targetGuildId);
                if (!targetGuild) {
                    return interaction.reply({
                        content: `❌ Bot is not in guild ${targetGuildId} or guild not found`,
                        ephemeral: true
                    });
                }

                // Fetch global commands
                const globalCommands = await interaction.client.application.commands.fetch();
                
                // Fetch guild-specific commands
                const guildCommands = await targetGuild.commands.fetch();

                // Check bot permissions in that guild
                const botMember = targetGuild.members.cache.get(interaction.client.user.id);
                const hasSlashPerms = botMember?.permissions.has('UseApplicationCommands');
                
                // Look for our specific problematic commands
                const problematicCommands = ['overclaimable', 'track'];
                let debugInfo = `**Debug Info for ${targetGuild.name} (${targetGuildId})**\n\n`;
                
                debugInfo += `**Bot Status:**\n`;
                debugInfo += `• Bot in guild: ✅\n`;
                debugInfo += `• Slash command perms: ${hasSlashPerms ? '✅' : '❌'}\n`;
                debugInfo += `• Bot role position: ${botMember?.roles.highest.position || 'Unknown'}\n\n`;
                
                debugInfo += `**Command Registration:**\n`;
                debugInfo += `• Global commands: ${globalCommands.size}\n`;
                debugInfo += `• Guild commands: ${guildCommands.size}\n\n`;
                
                debugInfo += `**Problematic Commands Status:**\n`;
                for (const cmdName of problematicCommands) {
                    const globalCmd = globalCommands.find(c => c.name === cmdName);
                    const guildCmd = guildCommands.find(c => c.name === cmdName);
                    
                    debugInfo += `• \`${cmdName}\`:\n`;
                    debugInfo += `  - Global: ${globalCmd ? '✅ Registered' : '❌ Missing'}\n`;
                    debugInfo += `  - Guild: ${guildCmd ? '✅ Registered' : '❌ Missing'}\n`;
                    if (globalCmd) {
                        debugInfo += `  - Global ID: ${globalCmd.id}\n`;
                    }
                }
                
                debugInfo += `\n**All Global Commands:**\n`;
                globalCommands.forEach(cmd => {
                    debugInfo += `• ${cmd.name}\n`;
                });
                
                if (guildCommands.size > 0) {
                    debugInfo += `\n**Guild-Specific Commands:**\n`;
                    guildCommands.forEach(cmd => {
                        debugInfo += `• ${cmd.name}\n`;
                    });
                }

                // Check if message is too long for Discord
                if (debugInfo.length > 2000) {
                    // Split into multiple messages
                    const chunks = debugInfo.match(/[\s\S]{1,1900}/g) || [];
                    if (interaction.replied || interaction.deferred) {
                        await interaction.editReply({ content: chunks[0] });
                    } else {
                        await interaction.reply({ content: chunks[0], ephemeral: true });
                    }
                    for (let i = 1; i < chunks.length; i++) {
                        await interaction.followUp({ content: chunks[i], ephemeral: true });
                    }
                } else {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.editReply({ content: debugInfo });
                    } else {
                        await interaction.reply({ content: debugInfo, ephemeral: true });
                    }
                }

            } catch (error) {
                console.error('Error debugging guild:', error);
                await interaction.reply({
                    content: `❌ Error debugging guild: ${error.message}`,
                    ephemeral: true
                });
            }
        }
    }
};