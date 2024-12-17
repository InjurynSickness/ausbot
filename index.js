const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const config = {
    token: 'MTMxODQxMDk5MTM5NDA5OTIzMQ.G_faem.djkhTrSNeUU5ULtmfO2_vYfJrZMO8gjsv0QDSs',
    whitelistedUsers: new Set(['1175990722437066784', 'USER_ID_2']),
    baseUrl: 'https://api.earthmc.net/v3/aurora',
    maxWatchlistSize: 5
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildPresences
    ]
});

const watchlist = new Map();
const onlineStatus = new Map();

async function makeRequest(endpoint, method = 'GET', data = null) {
    try {
        const response = await axios({
            method,
            url: `${config.baseUrl}/${endpoint}`,
            data
        });
        return response.data;
    } catch (error) {
        console.error(`API Error: ${error.message}`);
        throw error;
    }
}

function isWhitelisted(userId) {
    return config.whitelistedUsers.has(userId);
}

const commands = {
    // Statistics Commands
    async playercount() {
        const data = await makeRequest('');
        return `Current online players: ${data.stats.numOnlinePlayers}`;
    },

    async commonspawns(interaction) {
        const date = interaction.options.getString('date');
        return 'Top 25 most time-spent spawns for ' + date;
    },

    async frequentspawns(interaction) {
        const date = interaction.options.getString('date');
        return 'Top 25 most visited spawns for ' + date;
    },

    async visits(interaction) {
        const location = interaction.options.getString('location');
        return `Visit statistics for ${location}`;
    },

    async playeractivity(interaction) {
        const player = interaction.options.getString('player');
        const playerData = await makeRequest('players', 'POST', { query: [player] });
        return `Activity statistics for ${player}`;
    },

    async recentspawns(interaction) {
        const player = interaction.options.getString('player');
        const playerData = await makeRequest('players', 'POST', { query: [player] });
        return `Recent spawns for ${player}: [Data would be here]`;
    },

    // Premium Commands
    async overclaim() {
        const allTowns = await makeRequest('towns');
        const overclaimedTowns = [];
        
        for (const town of allTowns) {
            const townData = await makeRequest('towns', 'POST', { query: [town.uuid] });
            if (townData[0].status.isOverClaimed) {
                overclaimedTowns.push(townData[0].name);
            }
        }
        
        return `Overclaimed towns: ${overclaimedTowns.join(', ')}`;
    },

    async respurge(interaction) {
        const townName = interaction.options.getString('town');
        const townData = await makeRequest('towns', 'POST', { query: [townName] });

        if (!townData[0]) return 'Town not found';

        const residents = await Promise.all(townData[0].residents.map(async resident => {
            const resData = await makeRequest('players', 'POST', { query: [resident.uuid] });
            return {
                name: resident.name,
                lastOnline: new Date(resData[0].timestamps.lastOnline)
            };
        }));

        return residents
            .sort((a, b) => a.lastOnline - b.lastOnline)
            .map(r => `${r.name}: ${r.lastOnline.toLocaleDateString()}`)
            .join('\n');
    },

    async forsalenear(interaction) {
        const town = interaction.options.getString('town');
        const range = interaction.options.getInteger('range') || 1000;
        
        const townData = await makeRequest('towns', 'POST', { query: [town] });
        if (!townData[0]) return 'Town not found';

        const allTowns = await makeRequest('towns');
        const nearbyTowns = [];

        for (const t of allTowns) {
            const targetTown = await makeRequest('towns', 'POST', { query: [t.uuid] });
            if (targetTown[0].status.isForSale && targetTown[0].stats.balance < 60000) {
                nearbyTowns.push({
                    name: targetTown[0].name,
                    price: targetTown[0].stats.forSalePrice
                });
            }
        }

        return nearbyTowns.map(t => `${t.name}: ${t.price}g`).join('\n');
    },

    async town_falling() {
        const allTowns = await makeRequest('towns');
        const fallingTowns = [];

        for (const town of allTowns) {
            const townData = await makeRequest('towns', 'POST', { query: [town.uuid] });
            if (townData[0].stats.balance < 1000) {
                fallingTowns.push(townData[0].name);
            }
        }

        return `Falling towns: ${fallingTowns.join(', ')}`;
    },

    async fallingin(interaction) {
        const nation = interaction.options.getString('nation');
        const nationData = await makeRequest('nations', 'POST', { query: [nation] });
        
        if (!nationData[0]) return 'Nation not found';
        
        const fallingTowns = [];
        for (const town of nationData[0].towns) {
            const townData = await makeRequest('towns', 'POST', { query: [town.uuid] });
            if (townData[0].stats.balance < 1000) {
                fallingTowns.push(townData[0].name);
            }
        }

        return `Falling towns in ${nation}: ${fallingTowns.join(', ')}`;
    },

    async watch(interaction) {
        const userId = interaction.user.id;
        const playerName = interaction.options.getString('player');
        
        if (!watchlist.has(userId)) {
            watchlist.set(userId, new Set());
        }
        
        if (watchlist.get(userId).size >= config.maxWatchlistSize) {
            return 'You can only watch up to 5 players. Remove some using /unwatch first.';
        }
        
        watchlist.get(userId).add(playerName);
        return `Now watching ${playerName}`;
    },

    async unwatch(interaction) {
        const userId = interaction.user.id;
        const playerName = interaction.options.getString('player');
        
        if (!watchlist.has(userId) || !watchlist.get(userId).has(playerName)) {
            return 'You are not watching this player.';
        }
        
        watchlist.get(userId).delete(playerName);
        return `Stopped watching ${playerName}`;
    },

    async watchlist(interaction) {
        const userId = interaction.user.id;
        if (!watchlist.has(userId) || watchlist.get(userId).size === 0) {
            return 'You are not watching any players.';
        }
        
        return `Currently watching: ${Array.from(watchlist.get(userId)).join(', ')}`;
    },

    async permson() {
        const allTowns = await makeRequest('towns');
        const townsWithPerms = [];

        for (const town of allTowns) {
            const townData = await makeRequest('towns', 'POST', { query: [town.uuid] });
            if (Object.values(townData[0].perms).some(perm => perm.some(p => p === true))) {
                townsWithPerms.push(townData[0].name);
            }
        }

        return `Towns with permissions on: ${townsWithPerms.join(', ')}`;
    },

    async flagson(interaction) {
        const filter = interaction.options.getString('filter');
        const allTowns = await makeRequest('towns');
        const townsWithFlags = [];

        for (const town of allTowns) {
            const townData = await makeRequest('towns', 'POST', { query: [town.uuid] });
            if (filter) {
                if (townData[0].perms.flags[filter]) {
                    townsWithFlags.push(townData[0].name);
                }
            } else {
                if (Object.values(townData[0].perms.flags).some(flag => flag === true)) {
                    townsWithFlags.push(townData[0].name);
                }
            }
        }

        return `Towns with flags on: ${townsWithFlags.join(', ')}`;
    },

    async vp() {
        const data = await makeRequest('');
        return `Votes needed for next Vote Party: ${data.voteParty.numRemaining}`;
    },

    async discord(interaction) {
        const username = interaction.options.getString('username');
        const response = await makeRequest('discord', 'POST', {
            query: [{
                type: 'minecraft',
                target: username
            }]
        });
        return `Discord ID for ${username}: ${response[0].id}`;
    },

    async username(interaction) {
        const discordId = interaction.options.getString('discordid');
        const response = await makeRequest('discord', 'POST', {
            query: [{
                type: 'discord',
                target: discordId
            }]
        });
        return `Username for Discord ID ${discordId}: ${response[0].name}`;
    },

    async staff() {
        return 'Online staff members: [Staff list would go here]';
    },

    async seen(interaction) {
        const player = interaction.options.getString('player');
        const playerData = await makeRequest('players', 'POST', { query: [player] });
        
        if (!playerData[0]) return 'Player not found';
        
        const lastOnline = new Date(playerData[0].timestamps.lastOnline);
        const isOnline = playerData[0].status.isOnline;
        
        if (isOnline) {
            return `${player} is currently online`;
        }
        return `${player} was last seen on ${lastOnline.toLocaleString()}`;
    },

    async online(interaction) {
        const location = interaction.options.getString('location');
        const type = interaction.options.getString('type');
        
        if (type === 'town') {
            const townData = await makeRequest('towns', 'POST', { query: [location] });
            if (!townData[0]) return 'Town not found';
            
            const onlineResidents = [];
            for (const resident of townData[0].residents) {
                const playerData = await makeRequest('players', 'POST', { query: [resident.uuid] });
                if (playerData[0].status.isOnline) {
                    onlineResidents.push(playerData[0].name);
                }
            }
            
            return `Online players in ${location}: ${onlineResidents.join(', ')}`;
        } else {
            const nationData = await makeRequest('nations', 'POST', { query: [location] });
            if (!nationData[0]) return 'Nation not found';
            
            const onlineResidents = [];
            for (const town of nationData[0].towns) {
                const townData = await makeRequest('towns', 'POST', { query: [town.uuid] });
                for (const resident of townData[0].residents) {
                    const playerData = await makeRequest('players', 'POST', { query: [resident.uuid] });
                    if (playerData[0].status.isOnline) {
                        onlineResidents.push(playerData[0].name);
                    }
                }
            }
            
            return `Online players in ${location}: ${onlineResidents.join(', ')}`;
        }
    },

    async npcs() {
        const allPlayers = await makeRequest('players');
        const npcs = [];

        for (const player of allPlayers) {
            const playerData = await makeRequest('players', 'POST', { query: [player.uuid] });
            if (playerData[0].status.isNPC) {
                npcs.push({
                    name: playerData[0].name,
                    town: playerData[0].town?.name || 'No town'
                });
            }
        }

        return npcs.map(npc => `${npc.name} in ${npc.town}`).join('\n');
    },

    async links() {
        return `
EMC Links:
- Map: https://earthmc.net/map/aurora/
- Wiki: https://earthmc.fandom.com/
- Discord: https://discord.gg/earthmc
- Reddit: https://reddit.com/r/EarthMC
- Store: https://store.earthmc.net/`;
    },

    async listnations(interaction) {
        const filter = interaction.options.getString('filter') || 'residents';
        const nations = await makeRequest('nations');
        const detailedNations = await Promise.all(
            nations.map(n => makeRequest('nations', 'POST', { query: [n.uuid] }))
        );

        const sortedNations = detailedNations.sort((a, b) => {
            switch(filter) {
                case 'residents': return b[0].stats.numResidents - a[0].stats.numResidents;
                case 'towns': return b[0].stats.numTowns - a[0].stats.numTowns;
                case 'balance': return b[0].stats.balance - a[0].stats.balance;
                default: return 0;
            }
        });

        return sortedNations.slice(0, 10).map(n => 
            `${n[0].name}: ${n[0].stats[filter]} ${filter}`
        ).join('\n');
    },

    async listtowns(interaction) {
        const filter = interaction.options.getString('filter') || 'residents';
        const towns = await makeRequest('towns');
        const detailedTowns = await Promise.all(
            towns.map(t => makeRequest('towns', 'POST', { query: [t.uuid] }))
        );

        const sortedTowns = detailedTowns.sort((a, b) => {
            switch(filter) {
                case 'residents': return b[0].stats.numResidents - a[0].stats.numResidents;
                case 'balance': return b[0].stats.balance - a[0].stats.balance;
                case 'area': return b[0].stats.numTownBlocks - a[0].stats.numTownBlocks;
                default: return 0;
            }
        });

        return sortedTowns.slice(0, 10).map(t => 
            `${t[0].name}: ${t[0].stats[filter]} ${filter}`
        ).join('\n');
    },

    async calculatepurge(interaction) {
        const player = interaction.options.getString('player');
        const playerData = await makeRequest('players', 'POST', { query: [player] });
        if (!playerData[0]) return 'Player not found';

        const lastOnline = new Date(playerData[0].timestamps.lastOnline);
        const purgeDate = new Date(lastOnline.getTime() + (42 * 24 * 60 * 60 * 1000));
        return `${player} will purge on: ${purgeDate.toLocaleDateString()}`;
    },

    async checkpremium(interaction) {
        const user = interaction.options.getUser('user');
        return `Premium status check would go here for ${user.username}`;
    },

    async coords(interaction) {
        const x = interaction.options.getInteger('x');
        const z = interaction.options.getInteger('z');
        
        const locationData = await makeRequest('location', 'POST', {
            query: [[x, z]]
        });

        if (locationData[0].isWilderness) {
            return `Coordinates (${x}, ${z}) are in wilderness`;
        }

        return `Coordinates (${x}, ${z}) are in: ${locationData[0].town.name}`;
    },

    async locate(interaction) {
        const name = interaction.options.getString('name');
        const towns = await makeRequest('towns');
        const nations = await makeRequest('nations');

        const town = towns.find(t => t.name.toLowerCase() === name.toLowerCase());
        if (town) {
            const townData = await makeRequest('towns', 'POST', { query: [town.uuid] });
            const coords = townData[0].coordinates.spawn;
            return `${name} is a town at: https://earthmc.net/map/aurora/?zoom=6&x=${coords.x}&z=${coords.z}`;
        }

        const nation = nations.find(n => n.name.toLowerCase() === name.toLowerCase());
        if (nation) {
            const nationData = await makeRequest('nations', 'POST', { query: [nation.uuid] });
            const coords = nationData[0].coordinates.spawn;
            return `${name} is a nation at: https://earthmc.net/map/aurora/?zoom=6&x=${coords.x}&z=${coords.z}`;
        }

        return `${name} not found`;
    },

    async baltop(interaction) {
        const category = interaction.options.getString('category') || 'residents';
        let data;
        
        switch(category) {
            case 'residents':
                const players = await makeRequest('players');
                data = await Promise.all(players.map(p => 
                    makeRequest('players', 'POST', { query: [p.uuid] })
                ));
                data.sort((a, b) => b[0].stats.balance - a[0].stats.balance);
                return data.slice(0, 10).map(p => 
                    `${p[0].name}: ${p[0].stats.balance}g`
                ).join('\n');
                
            case 'towns':
                const towns = await makeRequest('towns');
                data = await Promise.all(towns.map(t => 
                    makeRequest('towns', 'POST', { query: [t.uuid] })
                ));
                data.sort((a, b) => b[0].stats.balance - a[0].stats.balance);
                return data.slice(0, 10).map(t => 
                    `${t[0].name}: ${t[0].stats.balance}g`
                ).join('\n');
                
            case 'nations':
                const nations = await makeRequest('nations');
                data = await Promise.all(nations.map(n => 
                    makeRequest('nations', 'POST', { query: [n.uuid] })
                ));
                data.sort((a, b) => b[0].stats.balance - a[0].stats.balance);
                return data.slice(0, 10).map(n => 
                    `${n[0].name}: ${n[0].stats.balance}g`
                ).join('\n');
        }
    },

    async economy() {
        const [players, towns, nations] = await Promise.all([
            makeRequest('players'),
            makeRequest('towns'),
            makeRequest('nations')
        ]);

        const [playerData, townData, nationData] = await Promise.all([
            Promise.all(players.map(p => makeRequest('players', 'POST', { query: [p.uuid] }))),
            Promise.all(towns.map(t => makeRequest('towns', 'POST', { query: [t.uuid] }))),
            Promise.all(nations.map(n => makeRequest('nations', 'POST', { query: [n.uuid] })))
        ]);

        const totalPlayerGold = playerData.reduce((sum, p) => sum + p[0].stats.balance, 0);
        const totalTownGold = townData.reduce((sum, t) => sum + t[0].stats.balance, 0);
        const totalNationGold = nationData.reduce((sum, n) => sum + n[0].stats.balance, 0);

        return `Total Economy:
Players: ${totalPlayerGold}g
Towns: ${totalTownGold}g
Nations: ${totalNationGold}g
Total: ${totalPlayerGold + totalTownGold + totalNationGold}g`;
    },

    async newday() {
        const towns = await makeRequest('towns');
        const fallingTowns = [];

        for (const town of towns) {
            const townData = await makeRequest('towns', 'POST', { query: [town.uuid] });
            if (townData[0].stats.balance < townData[0].stats.upkeepCost) {
                fallingTowns.push(townData[0].name);
            }
        }

        return `Towns falling next newday: ${fallingTowns.join(', ')}`;
    },

    async towns_forsale() {
        const towns = await makeRequest('towns');
        const forsaleTowns = [];

        for (const town of towns) {
            const townData = await makeRequest('towns', 'POST', { query: [town.uuid] });
            if (townData[0].status.isForSale && townData[0].stats.forSalePrice < 60000) {
                forsaleTowns.push({
                    name: townData[0].name,
                    price: townData[0].stats.forSalePrice
                });
            }
        }

        return forsaleTowns
            .sort((a, b) => a.price - b.price)
            .map(t => `${t.name}: ${t.price}g`)
            .join('\n');
    }
};

// Command Registration
const commandsData = [
    new SlashCommandBuilder().setName('playercount').setDescription('Get current online player count'),
    
    new SlashCommandBuilder().setName('commonspawns')
        .setDescription('Get top 25 spawns by time spent')
        .addStringOption(option => option.setName('date').setDescription('Date (YYYY-MM-DD)').setRequired(true)),
        
    new SlashCommandBuilder().setName('frequentspawns')
        .setDescription('Get top 25 most visited spawns')
        .addStringOption(option => option.setName('date').setDescription('Date (YYYY-MM-DD)').setRequired(true)),
        
    new SlashCommandBuilder().setName('visits')
        .setDescription('Get visit statistics')
        .addStringOption(option => option.setName('location').setDescription('Town/Nation name').setRequired(true)),
        
    new SlashCommandBuilder().setName('playeractivity')
        .setDescription('Get player activity stats')
        .addStringOption(option => option.setName('player').setDescription('Player name').setRequired(true)),
        
    new SlashCommandBuilder().setName('overclaim')
        .setDescription('List overclaimed towns'),
        
    new SlashCommandBuilder().setName('respurge')
        .setDescription('Check resident last online times')
        .addStringOption(option => option.setName('town').setDescription('Town name').setRequired(true)),
        
    new SlashCommandBuilder().setName('forsalenear')
        .setDescription('Find towns for sale nearby')
        .addStringOption(option => option.setName('town').setDescription('Town name').setRequired(true))
        .addIntegerOption(option => option.setName('range').setDescription('Search range')),
        
    new SlashCommandBuilder().setName('town_falling')
        .setDescription('View falling towns'),
        
    new SlashCommandBuilder().setName('fallingin')
        .setDescription('View falling towns in nation')
        .addStringOption(option => option.setName('nation').setDescription('Nation name').setRequired(true)),
        
    new SlashCommandBuilder().setName('watch')
        .setDescription('Watch a player')
        .addStringOption(option => option.setName('player').setDescription('Player name').setRequired(true)),
        
    new SlashCommandBuilder().setName('unwatch')
        .setDescription('Stop watching a player')
        .addStringOption(option => option.setName('player').setDescription('Player name').setRequired(true)),
        
    new SlashCommandBuilder().setName('watchlist')
        .setDescription('View your watched players'),
        
    new SlashCommandBuilder().setName('permson')
        .setDescription('List towns with permissions on'),
        
    new SlashCommandBuilder().setName('flagson')
        .setDescription('List towns with flags on')
        .addStringOption(option => option.setName('filter').setDescription('Flag type')),
        
    new SlashCommandBuilder().setName('vp')
        .setDescription('Check votes needed for Vote Party'),
        
    new SlashCommandBuilder().setName('discord')
        .setDescription('Get Discord ID from username')
        .addStringOption(option => option.setName('username').setDescription('Minecraft username').setRequired(true)),
        
    new SlashCommandBuilder().setName('username')
        .setDescription('Get username from Discord ID')
        .addStringOption(option => option.setName('discordid').setDescription('Discord ID').setRequired(true)),
        
    new SlashCommandBuilder().setName('staff')
        .setDescription('View online staff'),
        
    new SlashCommandBuilder().setName('seen')
        .setDescription('Check player last seen')
        .addStringOption(option => option.setName('player').setDescription('Player name').setRequired(true)),
        
    new SlashCommandBuilder().setName('online')
        .setDescription('View online players in town/nation')
        .addStringOption(option => option.setName('location').setDescription('Town/Nation name').setRequired(true))
        .addStringOption(option => option.setName('type').setDescription('Town or Nation').setRequired(true)),
        
    new SlashCommandBuilder().setName('npcs')
        .setDescription('List all NPCs'),
        
    new SlashCommandBuilder().setName('recentspawns')
        .setDescription('View recent spawns')
        .addStringOption(option => option.setName('player').setDescription('Player name').setRequired(true)),
        
    new SlashCommandBuilder().setName('links')
        .setDescription('Get EMC-related links'),
        
    new SlashCommandBuilder().setName('listnations')
        .setDescription('List nations by filter')
        .addStringOption(option => option.setName('filter').setDescription('Sort filter').setRequired(true)),
        
    new SlashCommandBuilder().setName('listtowns')
        .setDescription('List towns by filter')
        .addStringOption(option => option.setName('filter').setDescription('Sort filter').setRequired(true)),
        
    new SlashCommandBuilder().setName('calculatepurge')
        .setDescription('Calculate player purge date')
        .addStringOption(option => option.setName('player').setDescription('Player name').setRequired(true)),
        
    new SlashCommandBuilder().setName('checkpremium')
        .setDescription('Check premium status')
        .addUserOption(option => option.setName('user').setDescription('Discord user').setRequired(true)),
        
    new SlashCommandBuilder().setName('coords')
        .setDescription('Check coordinates location')
        .addIntegerOption(option => option.setName('x').setDescription('X coordinate').setRequired(true))
        .addIntegerOption(option => option.setName('z').setDescription('Z coordinate').setRequired(true)),
        
    new SlashCommandBuilder().setName('locate')
        .setDescription('Get location info and map link')
        .addStringOption(option => option.setName('name').setDescription('Town/Nation name').setRequired(true)),
        
    new SlashCommandBuilder().setName('baltop')
        .setDescription('View richest players/towns/nations')
        .addStringOption(option => option.setName('category').setDescription('Category type').setRequired(true)),
        
    new SlashCommandBuilder().setName('economy')
        .setDescription('View total economy stats'),
        
    new SlashCommandBuilder().setName('newday')
        .setDescription('View towns falling next newday'),
        
    new SlashCommandBuilder().setName('towns_forsale')
        .setDescription('List towns for sale')
];

client.once('ready', async () => {
    console.log('Bot is ready!');
    try {
        await client.application.commands.set(commandsData);
        console.log('Slash commands registered successfully');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    if (!isWhitelisted(interaction.user.id)) {
        await interaction.reply('You are not authorized to use this bot.');
        return;
    }
    
    const { commandName } = interaction;
    
    try {
        if (commands[commandName]) {
            await interaction.deferReply();
            const response = await commands[commandName](interaction);
            await interaction.editReply(response);
        }
    } catch (error) {
        console.error(`Command error: ${error.message}`);
        await interaction.editReply('An error occurred while processing your command.');
    }
});

client.on('presenceUpdate', async (oldPresence, newPresence) => {
    const userId = newPresence.userId;
    const status = newPresence.status;
    
    if (onlineStatus.get(userId) !== status) {
        onlineStatus.set(userId, status);
        
        for (const [watcherId, watchedPlayers] of watchlist.entries()) {
            if (watchedPlayers.has(userId)) {
                const channel = await client.channels.fetch(watcherId);
                await channel.send(`${userId} is now ${status}`);
            }
        }
    }
});

client.on('guildCreate', async guild => {
    try {
        const invite = `https://discord.com/oauth2/authorize?client_id=1318410991394099231&permissions=8&scope=bot%20applications.commands`;
        console.log(`Bot invited to ${guild.name}. Invite link: ${invite}`);
    } catch (error) {
        console.error('Error handling guild join:', error); 
    }
});

client.login(config.token);
