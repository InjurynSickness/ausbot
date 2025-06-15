const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const EarthMCClient = require('../services/earthmc');
const TimeUtils = require('../utils/time');
const Config = require('../config/config');

const DISCORD_DESCRIPTION_LIMIT = 4096;
const DISCORD_TOTAL_LIMIT = 6000;

const createTownString = (town, nextNewday) => {
    const emoji = town.fallsNextNewday ? '⚠️' : 
                 town.daysUntilFalling <= 3 ? '🔴' :
                 town.daysUntilFalling <= 7 ? '🟡' : '🟢';
    
    return `${emoji} **${town.name}**\n` +
           `┗ ${town.fallsNextNewday ? 
               `Falls at: <t:${Math.floor(nextNewday.getTime() / 1000)}:F>` : 
               `Falls in: \`${town.daysUntilFalling}\` days`}\n` +
           `┗ Mayor: \`${town.mayor}\` (Last online: <t:${Math.floor(town.lastOnline.getTime() / 1000)}:F>)\n\n`;
};

const commands = {
    async vp(interaction) {
        const data = await EarthMCClient.makeRequest('');
        const embed = new EmbedBuilder()
            .setTitle('🗳️ Vote Party Progress')
            .setDescription(`**Votes needed:** ${data.voteParty.numRemaining}`)
            .setColor('#FF0000')
            .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
    },

    async fallingin(interaction) {
        
        const nation = interaction.options.getString('nation');
        const days = interaction.options.getInteger('days') || 42; // Default to 42 instead of hardcoded 14
        
        const nationData = await EarthMCClient.makeRequest('nations', 'POST', { query: [nation] });
        if (!nationData[0]) return interaction.editReply('Nation not found');
        
        const townQueries = nationData[0].towns.map(t => t.uuid);
        const townsData = await EarthMCClient.makeRequest('towns', 'POST', { query: townQueries });
        
        const mayorQueries = townsData.map(t => t.mayor.uuid);
        const mayorsData = await EarthMCClient.makeRequest('players', 'POST', { query: mayorQueries });
        
        const nextNewday = TimeUtils.getNextNewday();
        const now = new Date();
        
        const townsFalling = townsData
            .map(town => {
                const mayor = mayorsData.find(m => m.uuid === town.mayor.uuid);
                if (!mayor) return null;

                const lastOnline = new Date(mayor.timestamps.lastOnline);
                const daysSinceLogin = Math.floor((now - lastOnline) / (24 * 60 * 60 * 1000));
                
                let daysUntilFalling = 42 - daysSinceLogin;
                let fallsNextNewday = false;
                
                if (daysSinceLogin >= 41) {
                    const hoursUntilNewday = (nextNewday - now) / (1000 * 60 * 60);
                    if (hoursUntilNewday < 24) {
                        daysUntilFalling = 0;
                        fallsNextNewday = true;
                    }
                }

                return {
                    name: town.name,
                    mayor: mayor.name,
                    daysUntilFalling,
                    fallsNextNewday,
                    lastOnline
                };
            })
            .filter(town => town && (town.fallsNextNewday || (town.daysUntilFalling <= days && town.daysUntilFalling >= 0))) // Use the days parameter
            .sort((a, b) => a.daysUntilFalling - b.daysUntilFalling);

        if (townsFalling.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle(`💸 Falling Towns in ${nation}`)
                .setDescription(`No towns falling within ${days} days`)
                .setColor('#FF0000')
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        let pages = [];
        let currentPage = '';
        
        for (const town of townsFalling) {
            const townString = createTownString(town, nextNewday);
            
            if ((currentPage + townString).length > DISCORD_DESCRIPTION_LIMIT - 200) {
                pages.push(currentPage);
                currentPage = townString;
            } else {
                currentPage += townString;
            }
        }
        
        if (currentPage) {
            pages.push(currentPage);
        }

        const footer = { 
            text: `⚠️ Next newday | 🔴 ≤ 3 days | 🟡 ≤ 7 days | 🟢 Other | Next newday: ${nextNewday.toLocaleString()} UTC` 
        };

        // Send first page
        const firstEmbed = new EmbedBuilder()
            .setTitle(`💸 Falling Towns in ${nation}${pages.length > 1 ? ' (Page 1/' + pages.length + ')' : ''} (≤${days} days)`)
            .setDescription(pages[0])
            .setColor('#FF0000')
            .setTimestamp()
            .setFooter(footer);

        await interaction.editReply({ embeds: [firstEmbed] });

        // Send follow-up pages if any
        for (let i = 1; i < pages.length; i++) {
            const embed = new EmbedBuilder()
                .setTitle(`💸 Falling Towns in ${nation} (Page ${i + 1}/${pages.length}) (≤${days} days)`)
                .setDescription(pages[i])
                .setColor('#FF0000')
                .setTimestamp()
                .setFooter(footer);

            await interaction.followUp({ embeds: [embed] });
        }
    },

    async respurge(interaction) {
        // Check authorization
        if (Config.whitelistEnabled && !Config.whitelistedUsers.has(interaction.user.id)) {
            return interaction.editReply({
                content: 'You are not authorized to use respurge commands.'
            });
        }

        const name = interaction.options.getString('name');
        const type = interaction.options.getString('type') || 'auto';
        const days = interaction.options.getInteger('days');
        const isEphemeral = interaction.options.getBoolean('ephemeral') || false;
        
        console.log(`Respurge command: name="${name}", type="${type}", days=${days}`);
        
        try {
            let allResidents = [];
            let locationName = '';
            let locationMayors = new Set(); // Track who are mayors
            let isNation = false;
            
            if (type === 'town') {
                // Force town lookup
                console.log(`Forcing town lookup for: ${name}`);
                const townData = await EarthMCClient.makeRequest('towns', 'POST', { query: [name] });
                if (!townData || !townData[0]) {
                    const response = { content: `Town "${name}" not found.`, ephemeral: isEphemeral };
                    return isEphemeral ? interaction.followUp(response) : interaction.editReply(response);
                }
                
                locationName = townData[0].name;
                allResidents = townData[0].residents || [];
                if (townData[0].mayor) {
                    locationMayors.add(townData[0].mayor.uuid);
                }
                console.log(`Found town: ${locationName} with ${allResidents.length} residents`);
                
            } else if (type === 'nation') {
                // Force nation lookup
                console.log(`Forcing nation lookup for: ${name}`);
                const nationData = await EarthMCClient.makeRequest('nations', 'POST', { query: [name] });
                if (!nationData || !nationData[0]) {
                    const response = { content: `Nation "${name}" not found.`, ephemeral: isEphemeral };
                    return isEphemeral ? interaction.followUp(response) : interaction.editReply(response);
                }
                
                isNation = true;
                locationName = nationData[0].name;
                console.log(`Found nation: ${locationName} with ${nationData[0].towns.length} towns`);
                
                // Get all towns in the nation
                if (nationData[0].towns && nationData[0].towns.length > 0) {
                    const townQueries = nationData[0].towns.map(t => t.uuid);
                    console.log(`Fetching data for ${townQueries.length} towns...`);
                    const townsData = await EarthMCClient.makeRequest('towns', 'POST', { query: townQueries });
                    console.log(`Got data for ${townsData.length} towns`);
                    
                    // Collect all residents and track mayors
                    for (const town of townsData) {
                        if (town.residents) {
                            allResidents.push(...town.residents);
                        }
                        if (town.mayor) {
                            locationMayors.add(town.mayor.uuid);
                        }
                    }
                    
                    // Remove duplicates
                    const uniqueResidents = [];
                    const seenUuids = new Set();
                    for (const resident of allResidents) {
                        if (!seenUuids.has(resident.uuid)) {
                            seenUuids.add(resident.uuid);
                            uniqueResidents.push(resident);
                        }
                    }
                    allResidents = uniqueResidents;
                    console.log(`Found ${allResidents.length} unique residents, ${locationMayors.size} mayors`);
                }
                
            } else {
                // Auto-detect (try town first, then nation)
                console.log(`Auto-detecting type for: ${name}`);
                let townData = null;
                
                try {
                    console.log(`Trying ${name} as town...`);
                    townData = await EarthMCClient.makeRequest('towns', 'POST', { query: [name] });
                    console.log(`Town query result:`, townData && townData[0] ? 'Found' : 'Not found');
                } catch (townError) {
                    console.log(`Town query failed:`, townError.message);
                }
                
                if (townData && townData[0]) {
                    // Found as town
                    locationName = townData[0].name;
                    allResidents = townData[0].residents || [];
                    if (townData[0].mayor) {
                        locationMayors.add(townData[0].mayor.uuid);
                    }
                    console.log(`Auto-detected as town: ${locationName} with ${allResidents.length} residents`);
                } else {
                    // Try as nation
                    try {
                        console.log(`Trying ${name} as nation...`);
                        const nationData = await EarthMCClient.makeRequest('nations', 'POST', { query: [name] });
                        console.log(`Nation query result:`, nationData && nationData[0] ? 'Found' : 'Not found');
                        
                        if (!nationData || !nationData[0]) {
                            const response = { content: `"${name}" not found as either a town or nation.`, ephemeral: isEphemeral };
                            return isEphemeral ? interaction.followUp(response) : interaction.editReply(response);
                        }
                        
                        isNation = true;
                        locationName = nationData[0].name;
                        console.log(`Auto-detected as nation: ${locationName} with ${nationData[0].towns.length} towns`);
                        
                        // Get all towns in the nation
                        if (nationData[0].towns && nationData[0].towns.length > 0) {
                            const townQueries = nationData[0].towns.map(t => t.uuid);
                            console.log(`Fetching data for ${townQueries.length} towns...`);
                            const townsData = await EarthMCClient.makeRequest('towns', 'POST', { query: townQueries });
                            console.log(`Got data for ${townsData.length} towns`);
                            
                            // Collect all residents and track mayors
                            for (const town of townsData) {
                                if (town.residents) {
                                    allResidents.push(...town.residents);
                                }
                                if (town.mayor) {
                                    locationMayors.add(town.mayor.uuid);
                                }
                            }
                            
                            // Remove duplicates
                            const uniqueResidents = [];
                            const seenUuids = new Set();
                            for (const resident of allResidents) {
                                if (!seenUuids.has(resident.uuid)) {
                                    seenUuids.add(resident.uuid);
                                    uniqueResidents.push(resident);
                                }
                            }
                            allResidents = uniqueResidents;
                            console.log(`Found ${allResidents.length} unique residents, ${locationMayors.size} mayors`);
                        }
                    } catch (nationError) {
                        console.log(`Nation query failed:`, nationError.message);
                        const response = { content: `"${name}" not found as either a town or nation.`, ephemeral: isEphemeral };
                        return isEphemeral ? interaction.followUp(response) : interaction.editReply(response);
                    }
                }
            }

            if (allResidents.length === 0) {
                const response = { content: `No residents found in ${locationName}.`, ephemeral: isEphemeral };
                return isEphemeral ? interaction.followUp(response) : interaction.editReply(response);
            }

            // Get detailed resident data in smaller batches to avoid API limits
            console.log(`Fetching detailed data for ${allResidents.length} residents...`);
            const batchSize = 50; // Process in smaller batches
            let residentsData = [];
            
            for (let i = 0; i < allResidents.length; i += batchSize) {
                const batch = allResidents.slice(i, i + batchSize);
                const residentQueries = batch.map(r => r.uuid);
                
                try {
                    const batchData = await EarthMCClient.makeRequest('players', 'POST', { query: residentQueries });
                    residentsData.push(...batchData);
                    console.log(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allResidents.length / batchSize)}`);
                } catch (batchError) {
                    console.error(`Error processing batch ${Math.floor(i / batchSize) + 1}:`, batchError.message);
                    // Continue with other batches
                }
            }

            console.log(`Got detailed data for ${residentsData.length} residents`);

            const now = new Date();
            
            const residentPurgeInfo = residentsData
                .map(r => {
                    const lastOnline = new Date(r.timestamps.lastOnline);
                    const daysUntilPurge = TimeUtils.calculateDaysUntilPurge(lastOnline);

                    // Calculate purge date - 42 days from last online, at newday time
                    const purgeDate = new Date(lastOnline);
                    purgeDate.setDate(purgeDate.getDate() + 42);

                    // Set to the same time as your newday calculation (6 AM ET)
                    const nyTime = new Date(purgeDate.toLocaleString("en-US", { timeZone: "America/New_York" }));
                    nyTime.setHours(6, 0, 0, 0);
                    const offset = purgeDate.getTime() - new Date(purgeDate.toLocaleString("en-US", { timeZone: "America/New_York" })).getTime();
                    purgeDate.setTime(nyTime.getTime() + offset);
                    
                    const isMayor = locationMayors.has(r.uuid);
                    
                    return {
                        name: r.name,
                        uuid: r.uuid,
                        lastOnline,
                        purgeDate,
                        daysUntilPurge,
                        isMayor
                    };
                })
                .filter(r => days === null || r.daysUntilPurge <= days) // Filter by days if specified
                .sort((a, b) => a.purgeDate - b.purgeDate); // Sort by purge date

            console.log(`After filtering: ${residentPurgeInfo.length} residents${days ? ` within ${days} days` : ''}`);

            if (residentPurgeInfo.length === 0) {
                const daysText = days ? ` within ${days} days` : '';
                const response = { content: `No residents found purging${daysText} in ${locationName}.`, ephemeral: isEphemeral };
                return isEphemeral ? interaction.followUp(response) : interaction.editReply(response);
            }

            // Format resident list with mayor highlighting
            const sortedResidents = residentPurgeInfo.map(r => {
                const mayorPrefix = r.isMayor ? '👑 ' : '';
                return `${mayorPrefix}${r.name}: <t:${Math.floor(r.purgeDate.getTime() / 1000)}:F>`;
            });

            // Create title based on filtering
            let title = `👥 Resident Purge Times - ${locationName}`;
            if (days !== null) {
                title += ` (≤${days} days)`;
            }

            // Handle pagination if the list is too long
            const footer = { 
                text: `Total: ${sortedResidents.length} residents${days ? ` purging within ${days} days` : ''} | 👑 = Mayor` 
            };
            
            if (sortedResidents.join('\n').length <= DISCORD_DESCRIPTION_LIMIT - 200) {
                // Single page
                const embed = new EmbedBuilder()
                    .setTitle(title)
                    .setDescription(sortedResidents.join('\n'))
                    .setColor('#FF0000')
                    .setTimestamp()
                    .setFooter(footer);
                
                const response = { embeds: [embed], ephemeral: isEphemeral };
                return isEphemeral ? interaction.followUp(response) : interaction.editReply(response);
            }

            // Multiple pages needed
            const pages = [];
            let currentPage = '';
            
            for (const resident of sortedResidents) {
                if ((currentPage + resident + '\n').length > DISCORD_DESCRIPTION_LIMIT - 300) {
                    pages.push(currentPage);
                    currentPage = resident + '\n';
                } else {
                    currentPage += resident + '\n';
                }
            }
            
            if (currentPage) {
                pages.push(currentPage);
            }

            // Send first page
            const firstEmbed = new EmbedBuilder()
                .setTitle(`${title}${pages.length > 1 ? ` (Page 1/${pages.length})` : ''}`)
                .setDescription(pages[0])
                .setColor('#FF0000')
                .setTimestamp()
                .setFooter(footer);

            const response = { embeds: [firstEmbed], ephemeral: isEphemeral };
            const sentMessage = isEphemeral ? await interaction.followUp(response) : await interaction.editReply(response);

            // Send follow-up pages if any
            for (let i = 1; i < pages.length; i++) {
                const embed = new EmbedBuilder()
                    .setTitle(`${title} (Page ${i + 1}/${pages.length})`)
                    .setDescription(pages[i])
                    .setColor('#FF0000')
                    .setTimestamp()
                    .setFooter(footer);

                const pageResponse = { embeds: [embed], ephemeral: isEphemeral };
                await interaction.followUp(pageResponse);
            }

        } catch (error) {
            console.error('Error fetching resident purge times:', error);
            const response = { content: `An error occurred while fetching resident purge times: ${error.message}`, ephemeral: isEphemeral };
            return isEphemeral ? interaction.followUp(response) : interaction.editReply(response);
        }
    }
};

module.exports = {
    data: [
        new SlashCommandBuilder()
            .setName('vp')
            .setDescription('Check votes needed for next Vote Party'),
        new SlashCommandBuilder()
            .setName('fallingin')
            .setDescription('List falling towns in a nation')
            .addStringOption(option => 
                option.setName('nation')
                    .setDescription('Nation name')
                    .setRequired(true))
            .addIntegerOption(option => 
                option.setName('days')
                    .setDescription('Days until falling (1-42, default: 42)')
                    .setMinValue(1)
                    .setMaxValue(42)
                    .setRequired(false)),
        new SlashCommandBuilder()
            .setName('respurge')
            .setDescription('Check resident purge times for a town or nation')
            .addStringOption(option => 
                option.setName('name')
                    .setDescription('Town or Nation name')
                    .setRequired(true))
            .addStringOption(option => 
                option.setName('type')
                    .setDescription('Specify if this is a town or nation')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Town', value: 'town' },
                        { name: 'Nation', value: 'nation' },
                        { name: 'Auto-detect', value: 'auto' }
                    ))
            .addIntegerOption(option => 
                option.setName('days')
                    .setDescription('Only show residents purging within this many days (default: all)')
                    .setMinValue(1)
                    .setMaxValue(42)
                    .setRequired(false))
            .addBooleanOption(option =>
                option.setName('ephemeral')
                    .setDescription('Set to true to make the response only visible to you')
                    .setRequired(false))
    ],
    execute: async (interaction) => {
        return commands[interaction.commandName](interaction);
    }
};