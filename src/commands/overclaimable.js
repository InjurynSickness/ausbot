const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const EarthMCClient = require('../services/earthmc');
const TimeUtils = require('../utils/time');
const Config = require('../config/config');

const CHUNKS_PER_RESIDENT = 12;

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

const data = new SlashCommandBuilder()
    .setName('overclaimable')
    .setDescription('Calculate when a town will be overclaimable OR list overclaimable towns in a nation')
    .addStringOption(option =>
        option.setName('name')
            .setDescription('Name of the town OR nation (use with list option)')
            .setRequired(true))
    .addBooleanOption(option =>
        option.setName('list')
            .setDescription('Set to true to list overclaimable towns in a nation within 7 days')
            .setRequired(false))
    .addBooleanOption(option =>
        option.setName('ephemeral')
            .setDescription('Set to true to make the response only visible to you')
            .setRequired(false));

async function execute(interaction) {
    // Check authorization
    if (Config.whitelistEnabled && !Config.whitelistedUsers.has(interaction.user.id)) {
        return interaction.editReply({
            content: 'You are not authorized to use overclaimable commands.'
        });
    }

    const name = interaction.options.getString('name');
    const isList = interaction.options.getBoolean('list') || false;
    const isEphemeral = interaction.options.getBoolean('ephemeral') || false;

    if (isList) {
        return await handleOverclaimableList(interaction, name, isEphemeral);
    } else {
        return await handleSingleTown(interaction, name, isEphemeral);
    }
}

async function handleSingleTown(interaction, townName, isEphemeral) {
    try {
        const towns = await EarthMCClient.makeRequest('towns');
        const town = towns.find(t => t.name.toLowerCase() === townName.toLowerCase());
        
        if (!town) {
            const response = { content: 'Town not found.', ephemeral: isEphemeral };
            return isEphemeral ? interaction.followUp(response) : interaction.editReply(response);
        }

        const townData = await EarthMCClient.makeRequest('towns', 'POST', { query: [town.uuid] });
        const townInfo = townData[0];

        // Get nation bonus
        let nationBonus = 0;
        let nationName = 'None';
        if (townInfo.nation) {
            const nationData = await EarthMCClient.makeRequest('nations', 'POST', { query: [townInfo.nation.uuid] });
            if (nationData[0]) {
                nationBonus = calculateNationBonus(nationData[0].stats.numResidents);
                nationName = nationData[0].name;
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
                futurePurgeScenarios.push({
                    residentsNeeded: i,
                    date: i > 0 ? residentPurgeDates[i - 1].purgeDate : now,
                    maxChunks: maxChunksAllowedFuture,
                    remainingResidents,
                    chunksOver: currentChunks - maxChunksAllowedFuture
                });
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(`⚔️ Overclaim Calculator - ${townInfo.name}`)
            .setColor(isCurrentlyOverclaimed ? '#FF0000' : '#2ecc71');

        // Current status section
        embed.addFields(
            { name: 'Current Chunks', value: `${currentChunks}/${maxChunksAllowed}`, inline: true },
            { name: 'Residents', value: currentResidents.toString(), inline: true },
            { name: 'Nation', value: nationName, inline: true }
        );

        // Nation bonus and calculation breakdown
        embed.addFields(
            { name: 'Base Allowance', value: `${currentResidents * CHUNKS_PER_RESIDENT} chunks (${currentResidents} × 12)`, inline: true },
            { name: 'Nation Bonus', value: `${nationBonus} chunks`, inline: true },
            { name: 'Total Allowance', value: `${maxChunksAllowed} chunks`, inline: true }
        );

        if (isCurrentlyOverclaimed) {
            const shieldCost = Math.ceil(chunksOverLimit / 4);
            embed.addFields(
                { name: 'Overclaim Status', value: `🔴 **Currently overclaimable**\n${chunksOverLimit} chunks over limit`, inline: false },
                { name: 'Shield Cost', value: `${shieldCost}G per day`, inline: true },
                { name: 'Shield Status', value: townInfo.status?.hasOverclaimShield ? '✅ Active' : '❌ Inactive', inline: true }
            );
        } else if (futurePurgeScenarios.length > 0) {
            const scenario = futurePurgeScenarios[0];
            const purgeList = residentPurgeDates
                .slice(0, scenario.residentsNeeded)
                .map(r => {
                    if (r.willPurgeNextNewday) {
                        return `${r.name}: Next newday`;
                    }
                    return `${r.name}: ${r.daysUntilPurge} days`;
                })
                .slice(0, 8) // Limit to 8 residents to avoid embed limits
                .join('\n');

            embed.addFields(
                { name: 'Overclaim Status', value: scenario.residentsNeeded === 0 ? 
                    '🔴 Town is currently overclaimable' :
                    `⚠️ Needs ${scenario.residentsNeeded} more resident(s) to purge/leave to be overclaimable`, inline: false }
            );

            if (purgeList && scenario.residentsNeeded > 0) {
                embed.addFields(
                    { name: 'Upcoming Purges', value: purgeList + (residentPurgeDates.length > 8 ? '\n*...and more*' : ''), inline: true },
                    { name: 'Predicted Date', value: `<t:${Math.floor(scenario.date.getTime() / 1000)}:R>`, inline: true },
                    { name: 'Future Chunks Over', value: `${scenario.chunksOver} chunks`, inline: true }
                );
            }
        } else {
            embed.addFields({
                name: 'Overclaim Status',
                value: '✅ Town has enough residents to maintain all chunks',
                inline: false
            });
        }

        // Add next newday reference
        embed.addFields({
            name: 'Next Newday',
            value: `<t:${Math.floor(nextNewday.getTime() / 1000)}:F>`,
            inline: false
        });

        const response = { embeds: [embed], ephemeral: isEphemeral };
        return isEphemeral ? interaction.followUp(response) : interaction.editReply(response);

    } catch (error) {
        console.error('Error calculating overclaim status:', error);
        const response = { content: 'An error occurred while calculating overclaim status.', ephemeral: isEphemeral };
        return isEphemeral ? interaction.followUp(response) : interaction.editReply(response);
    }
}

async function handleOverclaimableList(interaction, nation, isEphemeral) {
    const daysAhead = 7; // Fixed to 7 days as requested
    
    try {
        // Get nation data
        const nationData = await EarthMCClient.makeRequest('nations', 'POST', { query: [nation] });
        if (!nationData[0]) {
            const response = { content: 'Nation not found.', ephemeral: isEphemeral };
            return isEphemeral ? interaction.followUp(response) : interaction.editReply(response);
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
            
            // Only look for future overclaimable towns, not currently overclaimed ones
            let willBeOverclaimable = false;
            let daysUntilOverclaimable = null;
            
            if (!isCurrentlyOverclaimed) {
                // Calculate minimum chunks allowed (mayor only + nation bonus)
                const minChunksAllowed = (1 * CHUNKS_PER_RESIDENT) + nationBonus; // 1 = mayor only
                
                // First check: Can this town EVER be overclaimable through resident purges?
                if (currentChunks <= minChunksAllowed) {
                    // Town can NEVER be overclaimable through resident purges
                    // because even with just the mayor, they have enough chunk allowance
                    willBeOverclaimable = false;
                } else {
                    // Town CAN become overclaimable if enough residents purge
                    // Calculate how many residents need to purge to make it overclaimable
                    for (let lostResidents = 1; lostResidents <= currentResidents - 1; lostResidents++) {
                        const remainingResidents = currentResidents - lostResidents;
                        const futureMaxChunks = (remainingResidents * CHUNKS_PER_RESIDENT) + nationBonus;
                        
                        if (currentChunks > futureMaxChunks) {
                            // This would make the town overclaimable
                            // Only include if it's realistic (few residents need to purge and within timeframe)
                            if (lostResidents <= 3 && lostResidents * 2 <= daysAhead) {
                                willBeOverclaimable = true;
                                daysUntilOverclaimable = Math.min(daysAhead, lostResidents * 2);
                            }
                            break;
                        }
                    }
                }
                
                // Mayor purge check: Only matters if ALL residents would purge around the same time
                // When mayor purges, mayorship transfers to another resident, so town doesn't become ruins
                // Town only becomes ruins if ALL residents purge, not just the mayor
                // We already handled the resident purge scenarios above, so no additional mayor-specific logic needed
            }
            
            return {
                ...town,
                mayor,
                isCurrentlyOverclaimed,
                willBeOverclaimable,
                daysUntilOverclaimable,
                currentChunks,
                maxChunksAllowed,
                minChunksAllowed: (1 * CHUNKS_PER_RESIDENT) + nationBonus,
                chunksOverLimit: Math.max(0, currentChunks - maxChunksAllowed),
                nationBonus
            };
        }).filter(town => town && town.willBeOverclaimable && !town.isCurrentlyOverclaimed) // Only future overclaimable, not currently overclaimed
          .sort((a, b) => {
              // Sort by days until overclaimable
              if (a.daysUntilOverclaimable !== null && b.daysUntilOverclaimable !== null) {
                  return a.daysUntilOverclaimable - b.daysUntilOverclaimable;
              }
              return 0;
          });

        if (townAnalysis.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle(`💸 Future Overclaimable Towns - ${nation}`)
                .setDescription(`No towns will be overclaimable within ${daysAhead} days.`)
                .setColor('#00FF00')
                .addFields(
                    { name: 'Nation Bonus', value: `${nationBonus} chunks`, inline: true },
                    { name: 'Total Towns', value: nationInfo.towns.length.toString(), inline: true },
                    { name: 'Nation Residents', value: nationInfo.stats.numResidents.toString(), inline: true }
                )
                .setTimestamp();
            
            const response = { embeds: [embed], ephemeral: isEphemeral };
            return isEphemeral ? interaction.followUp(response) : interaction.editReply(response);
        }

        // Create response content
        const DISCORD_DESCRIPTION_LIMIT = 4096;
        let pages = [];
        let currentPage = '';
        
        for (const town of townAnalysis) {
            const emoji = town.daysUntilOverclaimable === 0 ? '⚠️' :
                         town.daysUntilOverclaimable <= 3 ? '🟡' : '🟢';
            
            // Calculate the date when town becomes overclaimable
            const overclaimableDate = new Date();
            overclaimableDate.setDate(overclaimableDate.getDate() + town.daysUntilOverclaimable);
            const timestamp = Math.floor(overclaimableDate.getTime() / 1000);
            
            let statusText;
            if (town.daysUntilOverclaimable === 0) {
                statusText = `Overclaimable at next newday`;
            } else {
                statusText = `Overclaimable: <t:${timestamp}:D>`;
            }
            
            const townString = `${emoji} **${town.name}** | Chunks: ${town.currentChunks}/${town.maxChunksAllowed} | Mayor: \`${town.mayor.name}\` | ${statusText}\n`;
            
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

        const footer = { 
            text: `⚠️ Next newday | 🟡 ≤ 3 days | 🟢 ≤ ${daysAhead} days | Nation bonus: ${nationBonus} chunks` 
        };

        // Send first page
        const firstEmbed = new EmbedBuilder()
            .setTitle(`💸 Future Overclaimable Towns - ${nation}${pages.length > 1 ? ` (Page 1/${pages.length})` : ''}`)
            .setDescription(pages[0])
            .setColor('#FF0000')
            .addFields(
                { name: 'Towns Found', value: townAnalysis.length.toString(), inline: true },
                { name: 'Nation Bonus', value: `${nationBonus} chunks`, inline: true },
                { name: 'Time Range', value: `≤${daysAhead} days`, inline: true }
            )
            .setTimestamp()
            .setFooter(footer);

        const response = { embeds: [firstEmbed], ephemeral: isEphemeral };
        const sentMessage = isEphemeral ? await interaction.followUp(response) : await interaction.editReply(response);

        // Send follow-up pages if any
        for (let i = 1; i < pages.length; i++) {
            const embed = new EmbedBuilder()
                .setTitle(`💸 Future Overclaimable Towns - ${nation} (Page ${i + 1}/${pages.length})`)
                .setDescription(pages[i])
                .setColor('#FF0000')
                .setTimestamp()
                .setFooter(footer);

            const pageResponse = { embeds: [embed], ephemeral: isEphemeral };
            await interaction.followUp(pageResponse);
        }

    } catch (error) {
        console.error('Error in overclaimable list:', error);
        const response = { content: 'An error occurred while calculating overclaimable information.', ephemeral: isEphemeral };
        return isEphemeral ? interaction.followUp(response) : interaction.editReply(response);
    }
}

module.exports = { data, execute };