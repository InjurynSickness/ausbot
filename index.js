const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const config = {
    token: 'YOUR_BOT_TOKEN',
    whitelistedUsers: new Set(['USER_ID_1', 'USER_ID_2']),
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
