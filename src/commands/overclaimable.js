// src/commands/overclaimable.js
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
    .setDescription('Calculate when a town will be overclaimable')
    .addStringOption(option =>
        option.setName('name')
            .setDescription('Name of the town')
            .setRequired(true));

async function execute(interaction) {
    // Check authorization
    if (Config.whitelistEnabled && !Config.whitelistedUsers.has(interaction.user.id)) {
        return interaction.editReply({
            content: 'You are not authorized to use overclaimable commands.'
        });
    }

    const townName = interaction.options.getString('name');

    try {
        const towns = await EarthMCClient.makeRequest('towns');
        const town = towns.find(t => t.name.toLowerCase() === townName.toLowerCase());
        
        if (!town) {
            return interaction.editReply('Town not found.');
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

        return interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error calculating overclaim status:', error);
        return interaction.editReply('An error occurred while calculating overclaim status.');
    }
}

module.exports = { data, execute };