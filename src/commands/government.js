const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs/promises');
const path = require('path');
const Config = require('../config/config');
const { AUSTRALIA_FLAG, CHECK, X_MARK, FALLBACK } = require('../utils/emojis');

const govFile = path.join(__dirname, '../data/government.json');

// Default government data structure
const defaultGovData = {
    primeMinister: null,
    deputyPrimeMinister: null,
    parliament: [], // Array of objects: { name: "PlayerName", seat: 1 }
    maxSeats: 15,
    cabinet: [], // Array of objects: { name: "PlayerName", position: "Minister of Defense" }
    advisors: [], // Array of names
    nextElection: null, // ISO date string
    campaignStart: null, // ISO date string
    regent: null,
    regentVoteDate: null // Next regent renewal vote
};

class GovernmentData {
    static async load() {
        try {
            const data = await fs.readFile(govFile, 'utf8');
            return { ...defaultGovData, ...JSON.parse(data) };
        } catch (error) {
            console.log('Creating new government data file');
            await this.save(defaultGovData);
            return defaultGovData;
        }
    }

    static async save(data) {
        try {
            await fs.mkdir(path.dirname(govFile), { recursive: true });
            await fs.writeFile(govFile, JSON.stringify(data, null, 2));
            console.log('Saved government data');
        } catch (error) {
            console.error('Error saving government data:', error);
        }
    }
}

const data = new SlashCommandBuilder()
    .setName('government')
    .setDescription('Australian Government Information')
    .addSubcommand(subcommand =>
        subcommand
            .setName('info')
            .setDescription('Display current Australian government information'))
    .addSubcommand(subcommand =>
        subcommand
            .setName('set')
            .setDescription('Update government information (Authorized users only)')
            .addStringOption(option =>
                option.setName('type')
                    .setDescription('What to update')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Prime Minister', value: 'pm' },
                        { name: 'Deputy Prime Minister', value: 'dpm' },
                        { name: 'Add Parliament Member', value: 'add_mp' },
                        { name: 'Remove Parliament Member', value: 'remove_mp' },
                        { name: 'Add Cabinet Member', value: 'add_cabinet' },
                        { name: 'Remove Cabinet Member', value: 'remove_cabinet' },
                        { name: 'Add Advisor', value: 'add_advisor' },
                        { name: 'Remove Advisor', value: 'remove_advisor' },
                        { name: 'Next Election Date', value: 'election_date' },
                        { name: 'Campaign Start Date', value: 'campaign_date' },
                        { name: 'Regent', value: 'regent' },
                        { name: 'Regent Vote Date', value: 'regent_vote' }
                    ))
            .addStringOption(option =>
                option.setName('value')
                    .setDescription('The value to set (name, date, position, etc.)')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('extra')
                    .setDescription('Extra info (cabinet position, parliament seat number)')
                    .setRequired(false)));

async function execute(interaction) {
    // Restrict to specific guild (Australian server or testing server)
    if (interaction.guildId !== '966170446015893535' && interaction.guildId !== '1187819440277037076') {
        return interaction.editReply({
            content: 'This command can only be used in the Australian Discord server.'
        });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'info') {
        return await showGovernmentInfo(interaction);
    } else if (subcommand === 'set') {
        // Check authorization
        if (!Config.whitelistedUsers.has(interaction.user.id)) {
            return interaction.editReply({
                content: 'You are not authorized to update government information.'
            });
        }
        return await updateGovernmentInfo(interaction);
    }
}

async function showGovernmentInfo(interaction) {
    const govData = await GovernmentData.load();

    const embed = new EmbedBuilder()
        .setTitle(`${AUSTRALIA_FLAG || FALLBACK.FLAG} Australian Government Information`)
        .setColor('#FF0000');

    // Leadership section
    embed.addFields(
        { name: 'Prime Minister', value: govData.primeMinister || 'Vacant', inline: true },
        { name: 'Deputy Prime Minister', value: govData.deputyPrimeMinister || 'Vacant', inline: true },
        { name: 'Regent', value: govData.regent || 'None', inline: true }
    );

    // Parliament section
    const filledSeats = govData.parliament.length;
    const parliamentList = govData.parliament.length > 0 ? 
        govData.parliament
            .sort((a, b) => a.seat - b.seat)
            .map(mp => `${mp.seat}. ${mp.name}`)
            .join('\n') : 
        'No members elected';

    embed.addFields({
        name: `Parliament [${filledSeats}/${govData.maxSeats}]`,
        value: `\`\`\`\n${parliamentList}\n\`\`\``,
        inline: false
    });

    // Cabinet section
    if (govData.cabinet.length > 0) {
        const cabinetList = govData.cabinet
            .map(member => `${member.position}: ${member.name}`)
            .join('\n');
        
        embed.addFields({
            name: `Cabinet [${govData.cabinet.length}]`,
            value: `\`\`\`\n${cabinetList}\n\`\`\``,
            inline: false
        });
    }

    // Advisors section
    if (govData.advisors.length > 0) {
        const advisorsList = govData.advisors.join(', ');
        embed.addFields({
            name: `Advisors [${govData.advisors.length}]`,
            value: `\`\`\`\n${advisorsList}\n\`\`\``,
            inline: false
        });
    }

    // Election information
    let electionInfo = '';
    if (govData.campaignStart) {
        electionInfo += `**Campaign Period:** <t:${Math.floor(new Date(govData.campaignStart).getTime() / 1000)}:F>\n`;
    }
    if (govData.nextElection) {
        electionInfo += `**Next Election:** <t:${Math.floor(new Date(govData.nextElection).getTime() / 1000)}:F>\n`;
    }
    if (govData.regentVoteDate) {
        electionInfo += `**Next Regent Vote:** <t:${Math.floor(new Date(govData.regentVoteDate).getTime() / 1000)}:F>`;
    }

    if (electionInfo) {
        embed.addFields({
            name: 'Election Schedule',
            value: electionInfo,
            inline: false
        });
    }

    embed.setFooter({ text: 'Australian Constitution • Elections held bimonthly' });

    return interaction.editReply({ embeds: [embed] });
}

async function updateGovernmentInfo(interaction) {
    const type = interaction.options.getString('type');
    const value = interaction.options.getString('value');
    const extra = interaction.options.getString('extra');

    const govData = await GovernmentData.load();

    try {
        switch (type) {
            case 'pm':
                govData.primeMinister = value;
                break;
            case 'dpm':
                govData.deputyPrimeMinister = value;
                break;
            case 'add_mp':
                const seat = extra ? parseInt(extra) : govData.parliament.length + 1;
                govData.parliament.push({ name: value, seat });
                break;
            case 'remove_mp':
                govData.parliament = govData.parliament.filter(mp => mp.name !== value);
                break;
            case 'add_cabinet':
                if (!extra) {
                    return interaction.editReply({ content: 'Please provide a position in the extra field.' });
                }
                govData.cabinet.push({ name: value, position: extra });
                break;
            case 'remove_cabinet':
                govData.cabinet = govData.cabinet.filter(member => member.name !== value);
                break;
            case 'add_advisor':
                if (!govData.advisors.includes(value)) {
                    govData.advisors.push(value);
                }
                break;
            case 'remove_advisor':
                govData.advisors = govData.advisors.filter(advisor => advisor !== value);
                break;
            case 'election_date':
                govData.nextElection = new Date(value).toISOString();
                break;
            case 'campaign_date':
                govData.campaignStart = new Date(value).toISOString();
                break;
            case 'regent':
                govData.regent = value === 'none' ? null : value;
                break;
            case 'regent_vote':
                govData.regentVoteDate = new Date(value).toISOString();
                break;
        }

        await GovernmentData.save(govData);

        return interaction.editReply({
            content: `${CHECK || FALLBACK.CHECK} Successfully updated ${type.replace('_', ' ')} to: ${value}${extra ? ` (${extra})` : ''}`
        });

    } catch (error) {
        console.error('Error updating government data:', error);
        return interaction.editReply({
            content: 'Error updating government information. Please check your input format.'
        });
    }
}

module.exports = { data, execute };