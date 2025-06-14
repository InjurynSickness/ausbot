const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const EarthMCClient = require('../services/earthmc');
const TimeUtils = require('../utils/time');

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
        const days = interaction.options.getInteger('days') || 42;
        
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
            .filter(town => town && (town.fallsNextNewday || (town.daysUntilFalling <= 14)))
            .sort((a, b) => a.daysUntilFalling - b.daysUntilFalling);

        if (townsFalling.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle(`💸 Falling Towns in ${nation}`)
                .setDescription('No towns falling within specified timeframe')
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
            .setTitle(`💸 Falling Towns in ${nation}${pages.length > 1 ? ' (Page 1/' + pages.length + ')' : ''}`)
            .setDescription(pages[0])
            .setColor('#FF0000')
            .setTimestamp()
            .setFooter(footer);

        await interaction.editReply({ embeds: [firstEmbed] });

        // Send follow-up pages if any
        for (let i = 1; i < pages.length; i++) {
            const embed = new EmbedBuilder()
                .setTitle(`💸 Falling Towns in ${nation} (Page ${i + 1}/${pages.length})`)
                .setDescription(pages[i])
                .setColor('#FF0000')
                .setTimestamp()
                .setFooter(footer);

            await interaction.followUp({ embeds: [embed] });
        }
    },

    async respurge(interaction) {
        const town = interaction.options.getString('town');
        const townData = await EarthMCClient.makeRequest('towns', 'POST', { query: [town] });
        if (!townData[0]) return interaction.editReply('Town not found');

        const residentQueries = townData[0].residents.map(r => r.uuid);
        const residentsData = await EarthMCClient.makeRequest('players', 'POST', { query: residentQueries });

        const sortedResidents = residentsData
            .sort((a, b) => new Date(a.timestamps.lastOnline) - new Date(b.timestamps.lastOnline))
            .map(r => {
                const lastOnline = new Date(r.timestamps.lastOnline);
                return `${r.name}: <t:${Math.floor(lastOnline.getTime() / 1000)}:R>`;
            });

        const embed = new EmbedBuilder()
            .setTitle(`👥 Resident Purge Times - ${town}`)
            .setDescription(sortedResidents.join('\n'))
            .setColor('#FF0000')
            .setTimestamp()
            .setFooter({ text: `Total: ${sortedResidents.length} residents` });
        return interaction.editReply({ embeds: [embed] });
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
                    .setDescription('Days until falling (1-42)')
                    .setMinValue(1)
                    .setMaxValue(42)
                    .setRequired(false)),
        new SlashCommandBuilder()
            .setName('respurge')
            .setDescription('Check resident last online times')
            .addStringOption(option => 
                option.setName('town')
                    .setDescription('Town name')
                    .setRequired(true))
    ],
    execute: async (interaction) => {
        return commands[interaction.commandName](interaction);
    }
};