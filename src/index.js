const { Client, GatewayIntentBits } = require('discord.js');
const Config = require('./config/config');
const EarthMCClient = require('./services/earthmc');
const DataCollector = require('./services/dataCollector');
const commands = require('./commands');

// Import the datacollect command to set up the reference
const dataCollectCommand = require('./commands/datacollect');

const client = new Client({
   intents: [
       GatewayIntentBits.Guilds,
       GatewayIntentBits.GuildMessages
   ]
});

let dataCollector;

client.once('ready', async () => {
   console.log('AUSBOT ACTIVATE!');
   try {
       await Config.loadAuthorizedUsers();
       
       // Initialize data collector
       dataCollector = new DataCollector();
       dataCollectCommand.setDataCollector(dataCollector);
       console.log('Data collector initialized');
       
       // Register commands globally so they work on all servers
       await client.application.commands.set(commands.data);
       console.log('Commands registered globally');

       // Also register to test guild for faster updates during development
       const testGuild = client.guilds.cache.get('1187819440277037076');
       if (testGuild) {
           await testGuild.commands.set(commands.data);
           console.log(`Commands also registered to test guild: ${testGuild.name}`);
       }
       
       // Clear EarthMC API cache every 5 minutes
       setInterval(() => {
           EarthMCClient.clearCache();
           console.log('EarthMC API cache cleared');
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
       if (['authorize', 'whitelist', 'forceglobal', 'debugguild'].includes(interaction.commandName)) {
           if (interaction.user.id !== '1175990722437066784') {
               return interaction.reply({
                   content: 'Not authorized to use this command',
                   ephemeral: true
               });
           }
           return await command.execute(interaction);
       }

       // Government command - COMMENTED OUT FOR NOW
       // if (interaction.commandName === 'government') {
       //     await interaction.deferReply();
       //     return await command.execute(interaction);
       // }

       // Data collection and graph commands - check whitelist authorization
       if (['datacollect', 'graph'].includes(interaction.commandName)) {
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