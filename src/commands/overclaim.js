const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const EarthMCClient = require('../services/earthmc');
const TimeUtils = require('../utils/time');
const Config = require('../config/config');
const { CHECK, X_MARK, FALLBACK } = require('../utils/emojis');

const CHUNKS_PER_RESIDENT = 12;
const DISCORD_DESCRIPTION_LIMIT = 4096;

// Nation bonus calculation based on nation resident count
const calculateNationBonus = (nationResidents) => {
    if (nationResidents >= 200) return 100;
    if (nationResidents >= 120) return 80;
    if (nationResidents >= 80) return 60;
    if (nationResidents >= 60) return 50;
    if (nationResidents >= 40) return 30;
    if (nationResidents >= 20) return 10;
    return 0;
};

const createTownOverclaimString = (town, nationBonus, nextNewday) => {
    const currentChunks = town.stats.numTownBlocks;
    const currentResidents = town.residents.length;
    const maxChunksAllowed = (currentResidents * CHUNKS_PER_RESIDENT) + nationBonus;
    const chunksOverLimit = Math.max(0, currentChunks - maxChunksAllowed);
    const isCurrentlyOverclaimed = chunksOverLimit > 0;
    
    if (!isCurrentlyOverclaimed && !town.willBeOverclaimable) {
        return null; // Skip towns that aren't overclaimed and won't be
    }

    const shieldCost = Math.ceil(chunksOverLimit / 4);
    
    let statusEmoji;
    let statusText;
    
    if (isCurrentlyOverclaimed) {
        statusEmoji = '🔴';
        statusText = `Currently overclaimable (${chunksOverLimit} chunks over, ${shieldCost}G/day)`;
    } else if (town.willBeOverclaimable) {
        const daysUntil = town.daysUntilOverclaimable;
        if (daysUntil === 0) {
            statusEmoji = '⚠️';
            statusText = `Overclaimable at next newday`;
        } else {
            statusEmoji = daysUntil <= 3 ? '🟡' : '🟢';
            statusText = `Overclaimable in ${daysUntil} days`;
        }
    }
    
    return `${statusEmoji} **${town.name}**\n` +
           `┗ ${statusText}\n` +
           `┗ Chunks: ${currentChunks}/${maxChunksAllowed} | Residents: ${currentResidents}\n` +
           `┗ Mayor: \`${town.mayor.name}\`\n\n`;
};

const data = new SlashCommandBuilder()
    .setName('overclaim')
    .setDescription('Overclaim information and calculations')
    .addSubcommand(subcommand =>
        subcommand
            .setName('info')
            .setDescription('Get detailed overclaim information for a town')
            .addStringOption(option =>
                option.setName('town')
                    .setDescription('Name of the town')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('list')
            .setDescription('List overclaimed towns in a nation')
            .addStringOption(option =>
                option.setName('nation')
                    .setDescription('Nation name')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('days')
                    .setDescription('Days ahead to check for overclaimable towns (default: 14)')
                    .setMinValue(1)
                    .setMaxValue(42)
                    .setRequired(false)));

async function execute(interaction) {
    // Check authorization
    if (Config.whitelistEnabled && !Config.whitelistedUsers.has(interaction.user.id)) {
        return interaction.editReply({
            content: 'You are not authorized to use overclaim commands.'
        });
    }

    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'info') {
        return await handleOverclaimInfo(interaction);
    } else if (subcommand === 'list') {
        return await handleOverclaimList(interaction);
    }
}

async function handleOverclaimInfo(interaction) {
    const townName = interaction.options.getString('town');

    try {
        const towns = await EarthMCClient.makeRequest('towns');
        const town = towns.find(t => t.name.toLowerCase() === townName.toLowerCase());
        
        if (!town) {
            return interaction.editReply('Town not found.');
        }

        const townData = await EarthMCClient.makeRequest('towns', 'POST', { query: [town.uuid] });
        const townInfo = townData[0];

        // Get nation data if town is in a nation
        let nationBonus = 0;
        if (townInfo.nation) {
            const nationData = await EarthMCClient.makeRequest('nations', 'POST', { query: [townInfo.nation.uuid] });
            if (nationData[0]) {
                nationBonus = calculateNationBonus(nationData[0].stats.numResidents);
            }
        }

        const residentQueries = townInfo.residents.map(r => r.uuid);
        const residentsData = await EarthMCClient.makeRequest('players', 'POST', { query: residentQueries });

        const now = new Date();
        const nextNewday = TimeUtils.getNextNewday();
        const currentChunks = townInfo.stats.numTownBlocks;
        const currentResidents = townInfo.residents.length;
        const maxChunksAllowed = (currentResidents * CHUNKS_PER_RESIDENT) + nationBonus;
        const chunksOverLimit = Math.max(0, currentChunks - maxChunksAllowed);
        const isCurrentlyOverclaimed = chunksOverLimit > 0;
        
        // Calculate shield cost (1 gold per 4 chunks over limit per day)
        const shieldCostPerDay = Math.ceil(chunksOverLimit / 4);
        
        const residentPurgeDates = residentsData.map(resident => {
            const lastOnline = new Date(resident.timestamps.lastOnline);
            const daysSinceLogin = Math.floor((now - lastOnline) / (24 * 60 * 60 * 1000));
            const daysUntilPurge = Math.max(0, 42 - daysSinceLogin);
            const purgeDate = new Date(lastOnline);
            purgeDate.setDate(purgeDate.getDate() + 42);
            purgeDate.setUTCHours(11, 0, 0, 0); // 6 AM EST = 11 AM UTC
            
            return {
                name: resident.name,
                purgeDate,
                daysUntilPurge,
                willPurgeNextNewday: daysSinceLogin >= 41 && (nextNewday - now) < (24 * 60 * 60 * 1000)
            };
        }).sort((a, b) => a.purgeDate - b.purgeDate);

        let futurePurgeScenarios = [];
        for (let i = 0; i <= residentPurgeDates.length; i++) {
            const remainingResidents = currentResidents - i;
            const maxChunksAllowedFuture = (remainingResidents * CHUNKS_PER_RESIDENT) + nationBonus;
            const willBeOverclaimable = currentChunks > maxChunksAllowedFuture;
            
            if (willBeOverclaimable) {
                const chunksOverLimitFuture = currentChunks - maxChunksAllowedFuture;
                const shieldCostFuture = Math.ceil(chunksOverLimitFuture / 4);
                
                futurePurgeScenarios.push({
                    residentsNeeded: i,
                    date: i > 0 ? residentPurgeDates[i - 1].purgeDate : now,
                    maxChunks: maxChunksAllowedFuture,
                    remainingResidents,
                    chunksOver: chunksOverLimitFuture,
                    shieldCost: shieldCostFuture
                });
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(`Overclaim Info for ${townInfo.name}`)
            .setColor('#FF0000');

        // Basic overclaim info in 3-column layout
        embed.addFields(
            { name: 'Chunks', value: `${currentChunks}/${maxChunksAllowed}`, inline: true },
            { name: 'Residents', value: currentResidents.toString(), inline: true },
            { name: 'Nation Bonus', value: `${nationBonus} chunks`, inline: true }
        );

        // Second row with overclaim details
        embed.addFields(
            { name: 'Over Limit', value: `${chunksOverLimit} chunks`, inline: true },
            { name: 'Shield Cost/Day', value: isCurrentlyOverclaimed ? `${shieldCostPerDay}G` : '0G', inline: true },
            { name: 'Shield Active', value: townInfo.status?.hasOverclaimShield ? (CHECK || FALLBACK.CHECK) : (X_MARK || FALLBACK.X_MARK), inline: true }
        );

        // Status section
        const statusValue = isCurrentlyOverclaimed ? 
            'Currently overclaimable' : 
            'Town has enough residents to maintain all chunks';
        
        embed.addFields(
            { name: 'Overclaim Status', value: statusValue, inline: false }
        );

        if (isCurrentlyOverclaimed) {
            // Shield cost breakdown
            const costBreakdown = [
                `Daily: ${shieldCostPerDay}G`,
                `Weekly: ${shieldCostPerDay * 7}G`,
                `Monthly: ${shieldCostPerDay * 30}G`
            ];
            
            embed.addFields(
                { name: 'Shield Costs', value: costBreakdown.join('\n'), inline: true }
            );
        }

        if (futurePurgeScenarios.length > 0 && !isCurrentlyOverclaimed) {
            const scenario = futurePurgeScenarios[0];
            
            // Future prediction section
            embed.addFields(
                { name: 'Residents to Purge', value: scenario.residentsNeeded.toString(), inline: true },
                { name: 'Overclaimable Date', value: `<t:${Math.floor(scenario.date.getTime() / 1000)}:F>`, inline: true },
                { name: 'Future Shield Cost', value: `${scenario.shieldCost}G/day`, inline: true }
            );

            const purgeList = residentPurgeDates
                .slice(0, scenario.residentsNeeded)
                .map(r => {
                    if (r.willPurgeNextNewday) {
                        return `${r.name}: Next newday`;
                    }
                    return `${r.name}: <t:${Math.floor(r.purgeDate.getTime() / 1000)}:F>`;
                })
                .slice(0, 10)
                .join('\n');

            if (purgeList) {
                embed.addFields({
                    name: 'Upcoming Purges',
                    value: purgeList + (residentPurgeDates.length > 10 ? '\n*...and more*' : ''),
                    inline: false
                });
            }
        }

        // Next newday info
        embed.addFields({
            name: 'Next Newday',
            value: `<t:${Math.floor(nextNewday.getTime() / 1000)}:F>`,
            inline: false
        });

        return interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error calculating overclaim info:', error);
        return interaction.editReply('An error occurred while calculating overclaim information.');
    }
}

async function handleOverclaimList(interaction) {
    const nation = interaction.options.getString('nation');
    const daysAhead = interaction.options.getInteger('days') || 14;
    
    try {
        // Get nation data
        const nationData = await EarthMCClient.makeRequest('nations', 'POST', { query: [nation] });
        if (!nationData[0]) {
            return interaction.editReply('Nation not found.');
        }

        const nationInfo = nationData[0];
        const nationBonus = calculateNationBonus(nationInfo.stats.numResidents);
        
        // Get all towns in the nation
        const townQueries = nationInfo.towns.map(t => t.uuid);
        const townsData = await EarthMCClient.makeRequest('towns', 'POST', { query: townQueries });
        
        // Get all mayors for last online data
        const mayorQueries = townsData.map(t => t.mayor.uuid);
        const mayorsData = await EarthMCClient.makeRequest('players', 'POST', { query: mayorQueries });
        
        const now = new Date();
        const nextNewday = TimeUtils.getNextNewday();
        
        // Process each town
        const townAnalysis = townsData.map(town => {
            const mayor = mayorsData.find(m => m.uuid === town.mayor.uuid);
            if (!mayor) return null;

            const currentChunks = town.stats.numTownBlocks;
            const currentResidents = town.residents.length;
            const maxChunksAllowed = (currentResidents * CHUNKS_PER_RESIDENT) + nationBonus;
            const isCurrentlyOverclaimed = currentChunks > maxChunksAllowed;
            
            // Calculate when town will be overclaimable based on mayor purge
            let willBeOverclaimable = false;
            let daysUntilOverclaimable = null;
            
            if (!isCurrentlyOverclaimed) {
                const lastOnline = new Date(mayor.timestamps.lastOnline);
                const daysSinceLogin = Math.floor((now - lastOnline) / (24 * 60 * 60 * 1000));
                const daysUntilMayorPurge = Math.max(0, 42 - daysSinceLogin);
                
                // If mayor purges, town becomes ruins and overclaimable
                if (daysUntilMayorPurge <= daysAhead) {
                    willBeOverclaimable = true;
                    daysUntilOverclaimable = daysUntilMayorPurge;
                }
            }
            
            return {
                ...town,
                mayor,
                isCurrentlyOverclaimed,
                willBeOverclaimable,
                daysUntilOverclaimable,
                currentChunks,
                maxChunksAllowed,
                chunksOverLimit: Math.max(0, currentChunks - maxChunksAllowed)
            };
        }).filter(town => town && (town.isCurrentlyOverclaimed || town.willBeOverclaimable))
          .sort((a, b) => {
              // Sort: currently overclaimed first, then by days until overclaimable
              if (a.isCurrentlyOverclaimed && !b.isCurrentlyOverclaimed) return -1;
              if (!a.isCurrentlyOverclaimed && b.isCurrentlyOverclaimed) return 1;
              if (a.daysUntilOverclaimable !== null && b.daysUntilOverclaimable !== null) {
                  return a.daysUntilOverclaimable - b.daysUntilOverclaimable;
              }
              return 0;
          });

        if (townAnalysis.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle(`💸 Overclaim Status - ${nation}`)
                .setDescription(`No towns are currently overclaimed or will be overclaimable within ${daysAhead} days.`)
                .setColor('#00FF00')
                .addFields(
                    { name: 'Nation Bonus', value: `${nationBonus} chunks`, inline: true },
                    { name: 'Total Towns', value: nationInfo.towns.length.toString(), inline: true },
                    { name: 'Nation Residents', value: nationInfo.stats.numResidents.toString(), inline: true }
                )
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] });
        }

        // Create pages for large results
        let pages = [];
        let currentPage = '';
        
        for (const town of townAnalysis) {
            const townString = createTownOverclaimString(town, nationBonus, nextNewday);
            if (!townString) continue;
            
            if ((currentPage + townString).length > DISCORD_DESCRIPTION_LIMIT - 300) {
                pages.push(currentPage);
                currentPage = townString;
            } else {
                currentPage += townString;
            }
        }
        
        if (currentPage) {
            pages.push(currentPage);
        }

        // Count current vs future overclaimed
        const currentlyOverclaimed = townAnalysis.filter(t => t.isCurrentlyOverclaimed).length;
        const futureOverclaimable = townAnalysis.filter(t => !t.isCurrentlyOverclaimed && t.willBeOverclaimable).length;

        const footer = { 
            text: `🔴 Currently overclaimed | ⚠️ Next newday | 🟡 ≤ 3 days | 🟢 ≤ ${daysAhead} days | Nation bonus: ${nationBonus} chunks` 
        };

        // Send first page
        const firstEmbed = new EmbedBuilder()
            .setTitle(`💸 Overclaim Status - ${nation}${pages.length > 1 ? ' (Page 1/' + pages.length + ')' : ''}`)
            .setDescription(pages[0])
            .setColor('#FF0000')
            .addFields(
                { name: 'Currently Overclaimed', value: currentlyOverclaimed.toString(), inline: true },
                { name: 'Future Overclaimable', value: futureOverclaimable.toString(), inline: true },
                { name: 'Nation Bonus', value: `${nationBonus} chunks`, inline: true }
            )
            .setTimestamp()
            .setFooter(footer);

        await interaction.editReply({ embeds: [firstEmbed] });

        // Send follow-up pages if any
        for (let i = 1; i < pages.length; i++) {
            const embed = new EmbedBuilder()
                .setTitle(`💸 Overclaim Status - ${nation} (Page ${i + 1}/${pages.length})`)
                .setDescription(pages[i])
                .setColor('#FF0000')
                .setTimestamp()
                .setFooter(footer);

            await interaction.followUp({ embeds: [embed] });
        }

    } catch (error) {
        console.error('Error in overclaim list:', error);
        return interaction.editReply('An error occurred while calculating overclaim information.');
    }
}

module.exports = { data, execute };