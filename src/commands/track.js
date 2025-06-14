const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Config = require('../config/config');
const EarthMCClient = require('../services/earthmc');

// Dynamic import for ES module
let Aurora, Routes;
async function loadEarthMC() {
    if (!Aurora) {
        const earthmc = await import('earthmc');
        Aurora = earthmc.Aurora;
        Routes = earthmc.Routes;
    }
    return { Aurora, Routes };
}

// Store active trackers per user to prevent multiple tracking sessions
const activeTrackers = new Map();

const data = new SlashCommandBuilder()
    .setName('track')
    .setDescription('Track a player and receive DM updates on their location')
    .addSubcommand(subcommand =>
        subcommand
            .setName('start')
            .setDescription('Start tracking a player')
            .addStringOption(option =>
                option.setName('player')
                    .setDescription('Name of the player to track')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('interval')
                    .setDescription('Update interval in seconds (default: 10, min: 5, max: 60)')
                    .setMinValue(5)
                    .setMaxValue(60)
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('route')
                    .setDescription('Route type for directions')
                    .addChoices(
                        { name: 'Fastest', value: 'fastest' },
                        { name: 'Safest', value: 'safest' }
                    )
                    .setRequired(false)))
    .addSubcommand(subcommand =>
        subcommand
            .setName('stop')
            .setDescription('Stop tracking the current player'))
    .addSubcommand(subcommand =>
        subcommand
            .setName('status')
            .setDescription('Check your current tracking status'));

async function execute(interaction) {
    // Check authorization
    if (Config.whitelistEnabled && !Config.whitelistedUsers.has(interaction.user.id)) {
        return interaction.editReply({
            content: 'You are not authorized to use tracking commands.'
        });
    }

    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    switch (subcommand) {
        case 'start':
            return await handleStartTracking(interaction, userId);
        case 'stop':
            return await handleStopTracking(interaction, userId);
        case 'status':
            return await handleTrackingStatus(interaction, userId);
        default:
            return interaction.editReply({
                content: 'Invalid subcommand. Use `/track start`, `/track stop`, or `/track status`.'
            });
    }
}

async function handleStartTracking(interaction, userId) {
    // Check if user already has an active tracker
    if (activeTrackers.has(userId)) {
        return interaction.editReply({
            content: 'You already have an active tracking session. Use `/track stop` to stop it first.'
        });
    }

    const playerName = interaction.options.getString('player');
    const interval = (interaction.options.getInteger('interval') || 10) * 1000; // Convert to milliseconds
    const routeType = interaction.options.getString('route') || 'fastest';

    try {
        // Check if user can receive DMs first
        try {
            const testMessage = await interaction.user.send('🔍 Testing DM capability for player tracking...');
            // Delete the test message immediately
            setTimeout(() => testMessage.delete().catch(() => {}), 1000);
        } catch (error) {
            return interaction.editReply({
                content: 'I cannot send you DMs. Please enable DMs from server members to use player tracking.'
            });
        }

        // First, check if player is online using the standard EarthMC API
        let playerData;
        try {
            const playersResponse = await EarthMCClient.makeRequest('players', 'POST', { 
                query: [playerName] 
            });
            
            if (!playersResponse || playersResponse.length === 0) {
                return interaction.editReply({
                    content: `Player "${playerName}" not found on the server. Please check the spelling and make sure they are registered.`
                });
            }

            playerData = playersResponse[0];
            console.log(`Player ${playerData.name} online status:`, playerData.status?.isOnline);

            if (!playerData.status?.isOnline) {
                return interaction.editReply({
                    content: `Player "${playerData.name}" is currently offline. Player tracking only works for online players.`
                });
            }

        } catch (error) {
            console.error('Error checking player online status:', error);
            return interaction.editReply({
                content: `Error looking up player "${playerName}": ${error.message}`
            });
        }

        // Load EarthMC module for GPS tracking
        const { Aurora, Routes } = await loadEarthMC();

        // Start tracking - use the exact player name from API
        const routeEnum = routeType === 'safest' ? Routes.SAFEST : Routes.FASTEST;

        let tracker;
        try {
            tracker = await Aurora.GPS.track(playerData.name, interval, routeEnum);
            console.log(`Started GPS tracking for ${playerData.name} successfully`);
        } catch (trackError) {
            console.error(`GPS tracking failed for ${playerData.name}:`, trackError);
            
            // If the player is online but can't be tracked, they're likely underground
            if (trackError.err === 'INVALID_PLAYER' || trackError.message?.includes('INVALID_PLAYER')) {
                // Start tracking anyway and assume they're underground
                try {
                    // Create a mock tracker that will just monitor for when they come above ground
                    tracker = await startUndergroundTracking(playerData.name, interval, routeEnum, Aurora);
                    console.log(`Started underground monitoring for ${playerData.name}`);
                } catch (undergroundError) {
                    return interaction.editReply({
                        content: `Player "${playerData.name}" is online but cannot be tracked. They may be underground or in a location that doesn't support GPS tracking. Error: ${trackError.msg || trackError.message}`
                    });
                }
            } else {
                throw new Error(`Failed to start tracking: ${trackError.msg || trackError.message}`);
            }
        }

        // Store tracker info
        activeTrackers.set(userId, {
            tracker,
            playerName: playerData.name, // Use exact name from API
            startTime: new Date(),
            lastUpdate: null,
            updateCount: 0,
            isUnderground: tracker.isUndergroundTracker || false
        });

        // Set up event listeners
        setupTrackerListeners(tracker, interaction.user, playerData.name);

        const embed = new EmbedBuilder()
            .setTitle('🔍 Player Tracking Started')
            .setDescription(`Now tracking **${playerData.name}** with ${interval/1000}s intervals`)
            .addFields(
                { name: 'Route Type', value: routeType.charAt(0).toUpperCase() + routeType.slice(1), inline: true },
                { name: 'Update Interval', value: `${interval/1000} seconds`, inline: true },
                { name: 'DM Updates', value: 'Enabled ✅', inline: true },
                { name: 'Player Status', value: '🟢 Online', inline: true }
            )
            .setColor('#00FF00')
            .setTimestamp()
            .setFooter({ text: 'Use /track stop to end tracking' });

        if (tracker.isUndergroundTracker) {
            embed.addFields({ 
                name: 'Note', 
                value: '⚠️ Player appears to be underground. Monitoring for when they surface.', 
                inline: false 
            });
        }

        return interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error starting player tracking:', error);
        return interaction.editReply({
            content: `Error starting tracking: ${error.message}`
        });
    }
}

async function handleStopTracking(interaction, userId) {
    const trackerInfo = activeTrackers.get(userId);
    
    if (!trackerInfo) {
        return interaction.editReply({
            content: 'You do not have any active tracking sessions.'
        });
    }

    try {
        // Mark tracker as stopped to prevent further event processing
        if (trackerInfo.tracker && typeof trackerInfo.tracker.markAsStopped === 'function') {
            trackerInfo.tracker.markAsStopped();
        }
        
        // Stop the tracker
        if (trackerInfo.tracker && typeof trackerInfo.tracker.stop === 'function') {
            trackerInfo.tracker.stop();
        }
        
        // Remove from active trackers
        activeTrackers.delete(userId);

        const duration = Math.floor((new Date() - trackerInfo.startTime) / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;

        const embed = new EmbedBuilder()
            .setTitle('⏹️ Player Tracking Stopped')
            .setDescription(`Stopped tracking **${trackerInfo.playerName}**`)
            .addFields(
                { name: 'Duration', value: `${minutes}m ${seconds}s`, inline: true },
                { name: 'Updates Received', value: trackerInfo.updateCount.toString(), inline: true }
            )
            .setColor('#FF0000')
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error stopping tracker:', error);
        activeTrackers.delete(userId); // Remove anyway
        return interaction.editReply({
            content: 'Tracking stopped (with some errors). You can start a new session.'
        });
    }
}

async function handleTrackingStatus(interaction, userId) {
    const trackerInfo = activeTrackers.get(userId);
    
    if (!trackerInfo) {
        return interaction.editReply({
            content: 'You do not have any active tracking sessions.'
        });
    }

    const duration = Math.floor((new Date() - trackerInfo.startTime) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;

    const embed = new EmbedBuilder()
        .setTitle('📊 Tracking Status')
        .setDescription(`Currently tracking **${trackerInfo.playerName}**`)
        .addFields(
            { name: 'Duration', value: `${minutes}m ${seconds}s`, inline: true },
            { name: 'Updates Received', value: trackerInfo.updateCount.toString(), inline: true },
            { name: 'Last Update', value: trackerInfo.lastUpdate ? `<t:${Math.floor(trackerInfo.lastUpdate.getTime() / 1000)}:R>` : 'None yet', inline: true }
        )
        .setColor('#0099FF')
        .setTimestamp()
        .setFooter({ text: 'Use /track stop to end tracking' });

    return interaction.editReply({ embeds: [embed] });
}

async function startUndergroundTracking(playerName, interval, routeEnum, Aurora) {
    // Create a custom tracker for underground players
    const EventEmitter = require('events');
    const undergroundTracker = new EventEmitter();
    undergroundTracker.isUndergroundTracker = true;
    
    let trackingInterval;
    let isTracking = true;

    const attemptTracking = async () => {
        if (!isTracking) return;
        
        try {
            // Try to start normal tracking
            const normalTracker = await Aurora.GPS.track(playerName, interval, routeEnum);
            
            // If successful, the player has surfaced
            clearInterval(trackingInterval);
            undergroundTracker.emit('surfaced', { playerName });
            
            // Transfer event listeners to the new tracker
            normalTracker.on('locationUpdate', (data) => undergroundTracker.emit('locationUpdate', data));
            normalTracker.on('underground', (data) => undergroundTracker.emit('underground', data));
            normalTracker.on('error', (data) => undergroundTracker.emit('error', data));
            
            // Replace the tracker reference
            undergroundTracker.realTracker = normalTracker;
            undergroundTracker.isUndergroundTracker = false;
            
        } catch (error) {
            // Still underground, continue monitoring
            if (error.err === 'INVALID_PLAYER') {
                // Player is still underground, continue checking
                return;
            } else {
                // Different error, emit it
                undergroundTracker.emit('error', error);
            }
        }
    };

    // Start monitoring every interval
    trackingInterval = setInterval(attemptTracking, interval);
    
    // Add stop method
    undergroundTracker.stop = () => {
        isTracking = false;
        if (trackingInterval) {
            clearInterval(trackingInterval);
        }
        if (undergroundTracker.realTracker && typeof undergroundTracker.realTracker.stop === 'function') {
            undergroundTracker.realTracker.stop();
        }
    };

    // Immediately send underground notification
    setTimeout(() => {
        undergroundTracker.emit('underground', { 
            playerName, 
            x: 'Unknown', 
            z: 'Unknown',
            message: 'Player is currently underground and cannot be tracked'
        });
    }, 1000);

    return undergroundTracker;
}

function setupTrackerListeners(tracker, user, playerName) {
    const userId = user.id;
    let hasNotifiedOffline = false; // Prevent duplicate offline notifications
    let hasBeenStopped = false; // Prevent processing events after stopping

    // Handle player surfacing from underground (custom event)
    tracker.on('surfaced', async (data) => {
        if (hasBeenStopped) return;
        
        try {
            const embed = new EmbedBuilder()
                .setTitle('🌅 Player Surfaced')
                .setDescription(`**${playerName}** has surfaced and can now be tracked normally!`)
                .setColor('#00FF00')
                .setTimestamp();

            await user.send({ embeds: [embed] });
            
            // Update tracker info
            const trackerInfo = activeTrackers.get(userId);
            if (trackerInfo) {
                trackerInfo.lastUpdate = new Date();
                trackerInfo.updateCount++;
                trackerInfo.isUnderground = false;
            }
        } catch (dmError) {
            console.error('Failed to send surfaced DM:', dmError);
        }
    });

    tracker.on('error', async (error) => {
        if (hasBeenStopped || hasNotifiedOffline) return; // Prevent duplicate processing
        
        console.error(`Tracking error for ${playerName}:`, error);
        
        // Always check if player is still online when we get any tracking error
        try {
            const playersResponse = await EarthMCClient.makeRequest('players', 'POST', { 
                query: [playerName] 
            });
            
            const playerStillOnline = playersResponse && 
                                    playersResponse.length > 0 && 
                                    playersResponse[0].status?.isOnline;
            
            if (!playerStillOnline) {
                // Set flag to prevent duplicate messages
                hasNotifiedOffline = true;
                hasBeenStopped = true;
                
                // Player went offline - stop tracking immediately
                const embed = new EmbedBuilder()
                    .setTitle('📴 Player Offline')
                    .setDescription(`**${playerName}** went offline`)
                    .addFields({ 
                        name: 'Status', 
                        value: '🔴 Tracking stopped - player is no longer online', 
                        inline: false 
                    })
                    .setColor('#FF0000')
                    .setTimestamp();

                await user.send({ embeds: [embed] });
                
                // Stop tracking and remove from active trackers
                const trackerInfo = activeTrackers.get(userId);
                if (trackerInfo) {
                    try {
                        if (trackerInfo.tracker && typeof trackerInfo.tracker.stop === 'function') {
                            trackerInfo.tracker.stop();
                        }
                    } catch (stopError) {
                        console.error('Error stopping tracker:', stopError);
                    }
                    activeTrackers.delete(userId);
                }
                return; // Exit early since we stopped tracking
            }
            
            // Player is still online, so they're likely underground
            const embed = new EmbedBuilder()
                .setTitle('🕳️ Player Underground')
                .setDescription(`**${playerName}** appears to be underground and cannot be tracked`)
                .addFields({ 
                    name: 'Status', 
                    value: '🟢 Player is online but not trackable - likely underground', 
                    inline: false 
                })
                .setColor('#8B4513')
                .setTimestamp();

            await user.send({ embeds: [embed] });
            
        } catch (apiError) {
            console.error('Error checking player online status:', apiError);
            
            // Set flag to prevent duplicate messages
            hasNotifiedOffline = true;
            hasBeenStopped = true;
            
            // If we can't check online status, assume they went offline and stop tracking
            const embed = new EmbedBuilder()
                .setTitle('📴 Connection Lost')
                .setDescription(`Lost connection to **${playerName}**`)
                .addFields({ 
                    name: 'Status', 
                    value: '🔴 Tracking stopped - unable to verify player status', 
                    inline: false 
                })
                .setColor('#FF0000')
                .setTimestamp();

            await user.send({ embeds: [embed] });
            
            // Stop tracking since we can't verify status
            const trackerInfo = activeTrackers.get(userId);
            if (trackerInfo) {
                try {
                    if (trackerInfo.tracker && typeof trackerInfo.tracker.stop === 'function') {
                        trackerInfo.tracker.stop();
                    }
                } catch (stopError) {
                    console.error('Error stopping tracker:', stopError);
                }
                activeTrackers.delete(userId);
            }
        }
    });

    tracker.on('underground', async (playerInfo) => {
        if (hasBeenStopped) return;
        
        try {
            const embed = new EmbedBuilder()
                .setTitle('🕳️ Player Underground')
                .setDescription(`**${playerName}** went underground and cannot be tracked`)
                .addFields(
                    { name: 'Last Known Location', value: `X: ${playerInfo.x}, Z: ${playerInfo.z}`, inline: true },
                    { name: 'Status', value: playerInfo.message || 'Underground', inline: true }
                )
                .setColor('#8B4513')
                .setTimestamp();

            await user.send({ embeds: [embed] });
            
            // Update tracker info
            const trackerInfo = activeTrackers.get(userId);
            if (trackerInfo) {
                trackerInfo.lastUpdate = new Date();
                trackerInfo.updateCount++;
            }
        } catch (dmError) {
            console.error('Failed to send underground DM:', dmError);
        }
    });

    tracker.on('locationUpdate', async (routeInfo) => {
        if (hasBeenStopped) return;
        
        try {
            const embed = new EmbedBuilder()
                .setTitle('📍 Location Update')
                .setDescription(`**${playerName}** location updated`)
                .addFields(
                    { name: 'Current Location', value: `X: ${routeInfo.x}, Z: ${routeInfo.z}`, inline: true },
                    { name: 'Distance', value: `${routeInfo.distance} blocks`, inline: true },
                    { name: 'Direction', value: routeInfo.direction, inline: true }
                )
                .setColor('#00FF00')
                .setTimestamp();

            if (routeInfo.nation) {
                embed.addFields({ 
                    name: 'Nearest Nation', 
                    value: `Type **/n spawn ${routeInfo.nation.name}** and head **${routeInfo.direction}**`, 
                    inline: false 
                });
            }

            await user.send({ embeds: [embed] });
            
            // Update tracker info
            const trackerInfo = activeTrackers.get(userId);
            if (trackerInfo) {
                trackerInfo.lastUpdate = new Date();
                trackerInfo.updateCount++;
            }
        } catch (dmError) {
            console.error('Failed to send location update DM:', dmError);
        }
    });

    // Add a method to mark this tracker as stopped
    tracker.markAsStopped = () => {
        hasBeenStopped = true;
    };
}

// Clean up trackers on bot restart/shutdown
process.on('SIGINT', () => {
    console.log('Cleaning up active trackers...');
    for (const [userId, trackerInfo] of activeTrackers) {
        try {
            if (trackerInfo.tracker && typeof trackerInfo.tracker.stop === 'function') {
                trackerInfo.tracker.stop();
            }
        } catch (error) {
            console.error(`Error stopping tracker for user ${userId}:`, error);
        }
    }
    activeTrackers.clear();
});

module.exports = { data, execute };