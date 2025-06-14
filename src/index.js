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
       await client.application.commands.set(commands.data);
       
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

       if (interaction.commandName === 'authorize') {
           return await command.execute(interaction);
       }

       if (!Config.whitelistedUsers.has(interaction.user.id)) {
           return await interaction.reply({
               content: 'Not authorized',
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