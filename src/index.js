// src/index.js
const { Client, GatewayIntentBits } = require('discord.js');
const Config = require('./config/config');
console.log("Current working directory:", process.cwd());
console.log("ENV token:", process.env.BOT_TOKEN);
const EarthMCClient = require('./services/earthmc');
const commands = require('./commands');

const client = new Client({
   intents: [
       GatewayIntentBits.Guilds,
       GatewayIntentBits.GuildMessages
   ]
});

client.once('ready', async () => {
   console.log('AUSBOT ACTIVATE!');
   try {
       await Config.loadAuthorizedUsers();
       
       // Use guild-specific command registration for faster updates during testing
       const guild = client.guilds.cache.get('1187819440277037076');
       if (guild) {
           await guild.commands.set(commands.data);
           console.log(`Commands registered to guild: ${guild.name}`);
       } else {
           console.log('Guild not found, falling back to global commands');
           await client.application.commands.set(commands.data);
       }
       
       setInterval(() => {
           EarthMCClient.clearCache();
           console.log('Cache cleared');
       }, 300000);
   } catch (error) {
       console.error('Error during startup:', error);
   }
});

client.on('interactionCreate', async interaction => {
   if (!interaction.isCommand()) return;
   
   try {
       const command = commands.get(interaction.commandName);
       if (!command) return;

       // Admin commands - only allow owner
       if (['authorize', 'whitelist'].includes(interaction.commandName)) {
           if (interaction.user.id !== '1175990722437066784') {
               return interaction.reply({
                   content: 'Not authorized to use this command',
                   ephemeral: true
               });
           }
           return await command.execute(interaction);
       }

       // Government command - handle authorization checks within the command
       if (interaction.commandName === 'government') {
           await interaction.deferReply();
           return await command.execute(interaction);
       }

       // Regular commands - check whitelist if enabled
       if (Config.whitelistEnabled && !Config.whitelistedUsers.has(interaction.user.id)) {
           return await interaction.reply({
               content: 'This bot is currently in whitelist mode. You are not authorized to use commands.',
               ephemeral: true
           });
       }
       
       await interaction.deferReply();
       await command.execute(interaction);
   } catch (error) {
       console.error(`Error in command ${interaction.commandName}:`, error);
       const errorMessage = {
           content: 'An error occurred while processing your command.',
           ephemeral: true
       };
       
       if (interaction.deferred) {
           await interaction.editReply(errorMessage);
       } else {
           await interaction.reply(errorMessage);
       }
   }
});

client.login(Config.token);