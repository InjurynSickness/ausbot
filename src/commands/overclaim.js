const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const EarthMCClient = require('../services/earthmc');
const TimeUtils = require('../utils/time');
const { CHECK, X_MARK, FALLBACK } = require('../utils/emojis');

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
    .setName('overclaim')
    .setDescription('Calculate overclaim information for a town')
    .addSubcommand(subcommand =>
        subcommand
            .setName('info')
            .setDescription('Get detailed overclaim information for a town')
            .addStringOption(option =>
                option.setName('town')
                    .setDescription('Name of the town')
                    .setRequired(true)));

async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'info') {
        return await handleOverclaimInfo(interaction);
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
            .setColor('#FF0000'); // Discord blurple color

        // Basic overclaim info in 3-column layout
        embed.addFields(
            { name: 'Chunks', value: `${currentChunks}/${maxChunksAllowed}`, inline: true },
            { name: 'Residents', value: currentResidents.toString(), inline: true },
            { name: 'Nation Bonus', value: `${nationBonus} chunks`, inline: true }
        );

        const fields = [];

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

module.exports = { data, execute };