// src/commands/graph.js
const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const Database = require('../services/database');
const Config = require('../config/config');

const chartJSNodeCanvas = new ChartJSNodeCanvas({ 
    width: 800, 
    height: 400,
    backgroundColour: 'white',
    chartCallback: (ChartJS) => {
        // Register any additional plugins if needed
        ChartJS.defaults.font.family = 'Arial, sans-serif';
    }
});

const data = new SlashCommandBuilder()
    .setName('graph')
    .setDescription('Generate graphs for nation statistics over time')
    .addStringOption(option =>
        option.setName('nation')
            .setDescription('Name of the nation')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('metric')
            .setDescription('What to graph')
            .setRequired(true)
            .addChoices(
                { name: 'Residents', value: 'residents' },
                { name: 'Chunks', value: 'chunks' },
                { name: 'Towns', value: 'towns' },
                { name: 'Bank Balance', value: 'bank_balance' }
            ))
    .addIntegerOption(option =>
        option.setName('days')
            .setDescription('Number of days to show (default: 30)')
            .setMinValue(7)
            .setMaxValue(365)
            .setRequired(false));

async function execute(interaction) {
    // Check authorization
    if (Config.whitelistEnabled && !Config.whitelistedUsers.has(interaction.user.id)) {
        return interaction.editReply({
            content: 'You are not authorized to use graph commands.'
        });
    }

    const nationName = interaction.options.getString('nation');
    const metric = interaction.options.getString('metric');
    const days = interaction.options.getInteger('days') || 30;

    try {
        const db = new Database();
        const history = await db.getNationHistory(nationName, days);

        if (history.length === 0) {
            return interaction.editReply({
                content: `No historical data found for **${nationName}**. Data collection may not have started yet, or the nation name might be incorrect.\n\nTip: Use \`/datacollect nation ${nationName}\` to manually collect current data.`
            });
        }

        if (history.length < 2) {
            return interaction.editReply({
                content: `Only ${history.length} day(s) of data available for **${nationName}**. Graphs require at least 2 data points. Please try again in a few days.`
            });
        }

        const chartConfig = {
            type: 'line',
            data: {
                labels: history.map(row => {
                    const date = new Date(row.date);
                    return date.toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric' 
                    });
                }),
                datasets: [{
                    label: getMetricLabel(metric),
                    data: history.map(row => row[metric]),
                    borderColor: '#FF0000',
                    backgroundColor: 'rgba(255, 0, 0, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.1,
                    pointBackgroundColor: '#FF0000',
                    pointBorderColor: '#FFFFFF',
                    pointBorderWidth: 2,
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: {
                        display: true,
                        text: `${nationName} - ${getMetricLabel(metric)} Over Time`,
                        font: { size: 16, weight: 'bold' },
                        color: '#333333'
                    },
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: getMetricLabel(metric),
                            font: { weight: 'bold' }
                        },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Date',
                            font: { weight: 'bold' }
                        },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        }
                    }
                }
            }
        };

        const imageBuffer = await chartJSNodeCanvas.renderToBuffer(chartConfig);
        const attachment = new AttachmentBuilder(imageBuffer, { name: 'graph.png' });

        const embed = new EmbedBuilder()
            .setTitle(`📊 ${nationName} Statistics`)
            .setDescription(`${getMetricLabel(metric)} over the last ${days} days`)
            .setImage('attachment://graph.png')
            .setColor('#FF0000')
            .setTimestamp();

        // Calculate statistics
        const currentValue = history[history.length - 1][metric];
        const previousValue = history.length > 1 ? history[history.length - 2][metric] : currentValue;
        const firstValue = history[0][metric];
        const change = currentValue - previousValue;
        const totalChange = currentValue - firstValue;
        const changeText = change > 0 ? `+${change}` : change.toString();
        const totalChangeText = totalChange > 0 ? `+${totalChange}` : totalChange.toString();
        
        // Calculate average
        const average = Math.round(history.reduce((sum, row) => sum + row[metric], 0) / history.length);
        
        embed.addFields(
            { 
                name: 'Current Value', 
                value: formatValue(currentValue, metric), 
                inline: true 
            },
            { 
                name: 'Daily Change', 
                value: formatValue(changeText, metric), 
                inline: true 
            },
            { 
                name: `${days}-Day Change`, 
                value: formatValue(totalChangeText, metric), 
                inline: true 
            },
            { 
                name: 'Average', 
                value: formatValue(average, metric), 
                inline: true 
            },
            { 
                name: 'Data Points', 
                value: `${history.length} days`, 
                inline: true 
            },
            { 
                name: 'Date Range', 
                value: `${new Date(history[0].date).toLocaleDateString()} - ${new Date(history[history.length - 1].date).toLocaleDateString()}`, 
                inline: true 
            }
        );

        return interaction.editReply({ 
            embeds: [embed], 
            files: [attachment] 
        });

    } catch (error) {
        console.error('Error generating graph:', error);
        return interaction.editReply('An error occurred while generating the graph. Please try again later.');
    }
}

function getMetricLabel(metric) {
    const labels = {
        'residents': 'Residents',
        'chunks': 'Chunks',
        'towns': 'Towns',
        'bank_balance': 'Bank Balance'
    };
    return labels[metric] || metric;
}

function formatValue(value, metric) {
    if (metric === 'bank_balance') {
        return `${value}G`;
    }
    return value.toString();
}

module.exports = { data, execute };