// src/commands/datacollect.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Config = require('../config/config');
const Database = require('../services/database');
const { CHECK, X_MARK, FALLBACK } = require('../utils/emojis');

let dataCollector = null;

// This will be set from index.js
function setDataCollector(collector) {
    dataCollector = collector;
}

const data = new SlashCommandBuilder()
    .setName('datacollect')
    .setDescription('Manage nation data collection (Admin only)')
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('Check data collection status'))
    .addSubcommand(subcommand =>
        subcommand
            .setName('manual')
            .setDescription('Start manual data collection for all nations'))
    .addSubcommand(subcommand =>
        subcommand
            .setName('nation')
            .setDescription('Collect data for a specific nation')
            .addStringOption(option =>
                option.setName('name')
                    .setDescription('Nation name')
                    .setRequired(true)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('stats')
            .setDescription('Show data collection statistics'));

async function execute(interaction) {
    // Check authorization - only authorized users can use datacollect commands
    if (Config.whitelistEnabled && !Config.whitelistedUsers.has(interaction.user.id)) {
        return interaction.editReply({
            content: 'You are not authorized to use data collection commands.'
        });
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
        case 'status':
            return await handleStatus(interaction);
        case 'manual':
            return await handleManual(interaction);
        case 'nation':
            return await handleNation(interaction);
        case 'stats':
            return await handleStats(interaction);
    }
}

async function handleStatus(interaction) {
    if (!dataCollector) {
        return interaction.editReply('Data collector not initialized.');
    }

    const isCollecting = dataCollector.getCollectionStatus();
    const statusEmoji = isCollecting ? '🔄' : (CHECK || FALLBACK.CHECK);
    const statusText = isCollecting ? 'Currently collecting data...' : 'Idle';

    const embed = new EmbedBuilder()
        .setTitle('📊 Data Collection Status')
        .setDescription(`${statusEmoji} **Status:** ${statusText}`)
        .setColor('#FF0000')
        .addFields(
            { name: 'Scheduled Collection', value: 'Daily at 6:05 AM EST', inline: true },
            { name: 'Next Collection', value: getNextCollectionTime(), inline: true }
        )
        .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
}

async function handleManual(interaction) {
    if (!dataCollector) {
        return interaction.editReply('Data collector not initialized.');
    }

    if (dataCollector.getCollectionStatus()) {
        return interaction.editReply('Data collection is already in progress. Please wait for it to complete.');
    }

    await interaction.editReply('🔄 Starting manual data collection for all nations... This may take several minutes.');

    // Start collection in background
    dataCollector.manualCollection().then(() => {
        interaction.followUp('✅ Manual data collection completed!');
    }).catch(error => {
        console.error('Manual collection error:', error);
        interaction.followUp('❌ Manual data collection failed. Check logs for details.');
    });
}

async function handleNation(interaction) {
    const nationName = interaction.options.getString('name');

    if (!dataCollector) {
        return interaction.editReply('Data collector not initialized.');
    }

    const success = await dataCollector.collectSpecificNation(nationName);
    
    if (success) {
        const embed = new EmbedBuilder()
            .setTitle('✅ Data Collection Success')
            .setDescription(`Successfully collected current data for **${nationName}**`)
            .setColor('#00FF00')
            .setTimestamp();
        
        return interaction.editReply({ embeds: [embed] });
    } else {
        return interaction.editReply(`❌ Failed to collect data for **${nationName}**. Nation may not exist or API error occurred.`);
    }
}

async function handleStats(interaction) {
    try {
        const db = new Database();
        const nationsWithData = await db.getAllNationsWithData();
        
        // Get sample of data ranges
        const sampleNations = nationsWithData.slice(0, 5);
        const dataRanges = await Promise.all(
            sampleNations.map(async (nation) => {
                const range = await db.getDataRange(nation);
                return { nation, ...range };
            })
        );

        const embed = new EmbedBuilder()
            .setTitle('📈 Data Collection Statistics')
            .setColor('#FF0000')
            .addFields(
                { name: 'Nations Tracked', value: nationsWithData.length.toString(), inline: true },
                { name: 'Collection Status', value: dataCollector?.getCollectionStatus() ? 'Active' : 'Idle', inline: true },
                { name: 'Next Collection', value: getNextCollectionTime(), inline: true }
            );

        if (dataRanges.length > 0) {
            const oldestData = dataRanges.reduce((oldest, current) => 
                new Date(current.first_date) < new Date(oldest.first_date) ? current : oldest
            );
            
            embed.addFields(
                { name: 'Oldest Data', value: `${oldestData.nation}: ${new Date(oldestData.first_date).toLocaleDateString()}`, inline: true },
                { name: 'Sample Data Points', value: dataRanges.map(r => `${r.nation}: ${r.total_days} days`).join('\n'), inline: false }
            );
        }

        embed.setTimestamp();
        return interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error getting stats:', error);
        return interaction.editReply('Error retrieving data collection statistics.');
    }
}

function getNextCollectionTime() {
    const now = new Date();
    const est = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    
    const nextCollection = new Date(est);
    nextCollection.setHours(6, 5, 0, 0);
    
    if (est.getHours() >= 6 && est.getMinutes() >= 5) {
        nextCollection.setDate(nextCollection.getDate() + 1);
    }
    
    const offset = now.getTime() - est.getTime();
    const adjustedTime = new Date(nextCollection.getTime() + offset);
    
    return `<t:${Math.floor(adjustedTime.getTime() / 1000)}:R>`;
}

module.exports = { data, execute, setDataCollector };