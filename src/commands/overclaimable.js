const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const EarthMCClient = require('../services/earthmc');
const TimeUtils = require('../utils/time');

const CHUNKS_PER_RESIDENT = 12;

const data = new SlashCommandBuilder()
    .setName('overclaimable')
    .setDescription('Calculate when a town will be overclaimable')
    .addStringOption(option =>
        option.setName('name')
            .setDescription('Name of the town')
            .setRequired(true));

async function execute(interaction) {
    const townName = interaction.options.getString('name');

    try {
        const towns = await EarthMCClient.makeRequest('towns');
        const town = towns.find(t => t.name.toLowerCase() === townName.toLowerCase());
        
        if (!town) {
            return interaction.editReply('Town not found.');
        }

        const townData = await EarthMCClient.makeRequest('towns', 'POST', { query: [town.uuid] });
        const townInfo = townData[0];

        const residentQueries = townInfo.residents.map(r => r.uuid);
        const residentsData = await EarthMCClient.makeRequest('players', 'POST', { query: residentQueries });

        const now = new Date();
        const nextNewday = TimeUtils.getNextNewday();
        const nationBonus = townInfo.nation?.stats?.extraBonusBlocks || 0;
        const currentChunks = townInfo.stats.numTownBlocks;
        const currentResidents = townInfo.residents.length;
        
        const residentPurgeDates = residentsData.map(resident => {
            const lastOnline = new Date(resident.timestamps.lastOnline);
            const daysSinceLogin = Math.floor((now - lastOnline) / (24 * 60 * 60 * 1000));
            const daysUntilPurge = Math.max(0, 42 - daysSinceLogin);
            const purgeDate = new Date(lastOnline);
            purgeDate.setDate(purgeDate.getDate() + 42);
            purgeDate.setUTCHours(10, 0, 0, 0);
            
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
            const maxChunksAllowed = (remainingResidents * CHUNKS_PER_RESIDENT) + nationBonus;
            const willBeOverclaimable = currentChunks > maxChunksAllowed;
            
            if (willBeOverclaimable) {
                futurePurgeScenarios.push({
                    residentsNeeded: i,
                    date: i > 0 ? residentPurgeDates[i - 1].purgeDate : now,
                    maxChunks: maxChunksAllowed,
                    remainingResidents
                });
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(`Overclaim Calculator - ${townInfo.name}`)
            .setColor('#2ecc71');

        const fields = [
            {
                name: 'Current Status',
                value: `Chunks: ${currentChunks}\nNation Bonus: ${nationBonus}\nTotal Max Chunks: ${(currentResidents * CHUNKS_PER_RESIDENT) + nationBonus}\nResidents: ${currentResidents}`,
                inline: false
            }
        ];

        if (futurePurgeScenarios.length > 0) {
            const scenario = futurePurgeScenarios[0];
            const purgeList = residentPurgeDates
                .slice(0, scenario.residentsNeeded)
                .map(r => {
                    if (r.willPurgeNextNewday) {
                        return `${r.name}: Next newday`;
                    }
                    return `${r.name}: ${r.daysUntilPurge} days`;
                })
                .join('\n');

            fields.push({
                name: 'Overclaim Status',
                value: scenario.residentsNeeded === 0 ? 
                    'Town is currently overclaimable' :
                    `Needs ${scenario.residentsNeeded} more resident(s) to purge/leave to be overclaimable`,
                inline: false
            });

            if (purgeList) {
                fields.push({
                    name: 'Upcoming Purges',
                    value: purgeList,
                    inline: false
                });
            }

            if (scenario.residentsNeeded > 0) {
                fields.push({
                    name: 'Predicted Overclaimable Date',
                    value: `<t:${Math.floor(scenario.date.getTime() / 1000)}:R>`,
                    inline: false
                });
            }
        } else {
            fields.push({
                name: 'Overclaim Status',
                value: '❌ Town has enough residents to maintain chunks',
                inline: false
            });
        }

        embed.addFields(fields);

        return interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error calculating overclaim status:', error);
        return interaction.editReply('An error occurred while calculating overclaim status.');
    }
}

module.exports = { data, execute };