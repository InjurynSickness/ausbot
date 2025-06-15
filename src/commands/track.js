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
            .setName('defend')
            .setDescription('Monitor for nearby players and get alerted (excludes nation/alliance)')
            .addStringOption(option =>
                option.setName('player')
                    .setDescription('Your player name to monitor around')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('radius')
                    .setDescription('Alert radius in blocks (default: 100, max: 200)')
                    .setMinValue(50)
                    .setMaxValue(200)
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
        case 'defend':
            return await handleStartDefense(interaction, userId);
        case 'stop':
            return await handleStopTracking(interaction, userId);
        case 'status':
            return await handleTrackingStatus(interaction, userId);
        default:
            return interaction.editReply({
                content: 'Invalid subcommand. Use `/track start`, `/track defend`, `/track stop`, or `/track status`.'
            });
    }
}

async function handleStartDefense(interaction, userId) {
    // Check if user already has an active tracker
    if (activeTrackers.has(userId)) {
        return interaction.editReply({
            content: 'You already have an active tracking session. Use `/track stop` to stop it first.'
        });
    }

    const playerName = interaction.options.getString('player');
    const radius = interaction.options.getInteger('radius') || 100;

    try {
        // Check if user can receive DMs first
        try {
            await interaction.user.send('🛡️ Starting defense monitoring...');
        } catch (error) {
            return interaction.editReply({
                content: 'I cannot send you DMs. Please enable DMs from server members in your Discord privacy settings to use defense monitoring.'
            });
        }

        // Check if player exists and is online
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

            if (!playerData.status?.isOnline) {
                return interaction.editReply({
                    content: `Player "${playerData.name}" is currently offline. Defense monitoring only works for online players.`
                });
            }

        } catch (error) {
            console.error('Error checking player online status:', error);
            return interaction.editReply({
                content: `Error looking up player "${playerName}": ${error.message}`
            });
        }

        // Get player's nation and alliance info for exclusions
        let playerNation = null;
        let allianceNations = [];
        
        // The player data from POST request should include town/nation info
        if (playerData.nation?.name) {
            playerNation = playerData.nation.name;
            console.log(`Found player nation: ${playerNation}`);
            
            // Get alliance data to exclude alliance members
            try {
                const axios = require('axios');
                const allianceResponse = await axios.get('https://emctoolkit.vercel.app/api/aurora/alliances');
                const alliances = allianceResponse.data;
                
                // Find alliances this player's nation belongs to
                const playerAlliances = alliances.filter(alliance => 
                    alliance.nations.some(nation => nation.toLowerCase() === playerNation.toLowerCase())
                );
                
                console.log(`Found ${playerAlliances.length} alliances for ${playerNation}`);
                if (playerAlliances.length > 0) {
                    console.log(`Player is in alliance(s): ${playerAlliances.map(a => a.allianceName).join(', ')}`);
                }
                
                // Get all nations in those alliances
                allianceNations = playerAlliances.flatMap(alliance => 
                    alliance.nations.map(nation => nation.toLowerCase())
                );
                
                console.log(`Total alliance nations to exclude: ${allianceNations.length}`);
            } catch (error) {
                console.error('Error fetching alliance data:', error);
            }
        } else if (playerData.town?.name) {
            // Player has a town but no nation
            console.log(`Player ${playerData.name} is in town ${playerData.town.name} but town has no nation`);
        } else {
            console.log(`Player ${playerData.name} has no town or nation`);
        }

        // Start defense monitoring
        const defenseTracker = await startDefenseMonitoring(
            playerData.name, 
            radius, 
            playerNation, 
            allianceNations
        );

        // Store tracker info
        activeTrackers.set(userId, {
            tracker: defenseTracker,
            playerName: playerData.name,
            startTime: new Date(),
            lastUpdate: null,
            updateCount: 0,
            isDefenseMode: true,
            radius,
            playerNation,
            allianceNations: allianceNations.length
        });

        // Set up event listeners
        setupDefenseListeners(defenseTracker, interaction.user, playerData.name, radius, playerNation);

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Defense Monitoring Started')
            .setDescription(`Now monitoring for enemies near **${playerData.name}**`)
            .addFields(
                { name: 'Alert Radius', value: `${radius} blocks`, inline: true },
                { name: 'Your Nation', value: playerNation || 'None', inline: true },
                { name: 'Alliance Nations', value: allianceNations.length.toString(), inline: true },
                { name: 'Player Status', value: '🟢 Online', inline: true },
                { name: 'Exclusions', value: 'Nation & Alliance members', inline: true },
                { name: 'DM Alerts', value: 'Enabled ✅', inline: true }
            )
            .setColor('#FF6B35')
            .setTimestamp()
            .setFooter({ text: 'Use /track stop to end monitoring' });

        return interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Error starting defense monitoring:', error);
        return interaction.editReply({
            content: `Error starting defense monitoring: ${error.message}`
        });
    }
}

async function startDefenseMonitoring(playerName, radius, playerNation, allianceNations) {
    const EventEmitter = require('events');
    const defenseTracker = new EventEmitter();
    
    let monitoringInterval;
    let isMonitoring = true;
    let lastKnownNearbyPlayers = new Set();

    // Load EarthMC module for GPS tracking
    const { Aurora } = await loadEarthMC();

    const checkNearbyPlayers = async () => {
        if (!isMonitoring) return;
        
        try {
            console.log(`=== Defense monitoring check for ${playerName} ===`);
            
            // Use EarthMC-NPM to get player location with GPS
            let targetPlayer;
            try {
                targetPlayer = await Aurora.Players.get(playerName);
                if (!targetPlayer) {
                    console.log(`Target player ${playerName} not found via EarthMC-NPM`);
                    defenseTracker.emit('playerOffline', { playerName });
                    return;
                }
                
                console.log(`Target player ${playerName} location: x=${targetPlayer.x}, z=${targetPlayer.z}, online=${targetPlayer.online}`);
                
                if (!targetPlayer.online) {
                    console.log(`Target player ${playerName} is offline`);
                    defenseTracker.emit('playerOffline', { playerName });
                    return;
                }
                
                // If player doesn't have coordinates (underground), we can't monitor
                if (targetPlayer.x === undefined || targetPlayer.z === undefined) {
                    console.log(`Target player ${playerName} has no coordinates (underground)`);
                    return;
                }
            } catch (playerError) {
                console.log(`Could not get location for ${playerName}:`, playerError.message);
                // Player might be underground or offline
                return;
            }
            
            // Get all online players using EarthMC-NPM
            let allPlayers;
            try {
                allPlayers = await Aurora.Players.online();
                console.log(`Found ${allPlayers.length} online players via EarthMC-NPM`);
            } catch (playersError) {
                console.error('Error getting online players:', playersError);
                return;
            }
            
            const onlinePlayers = allPlayers.filter(p => 
                p.name !== playerName && 
                p.x !== undefined && p.z !== undefined // Only players with visible coordinates
            );

            console.log(`Filtered online players with coordinates (excluding ${playerName}): ${onlinePlayers.length}`);
            console.log(`First few online players:`, onlinePlayers.slice(0, 3).map(p => ({ 
                name: p.name, 
                x: p.x, 
                z: p.z, 
                nation: p.nation || 'None' 
            })));

            const nearbyPlayers = [];
            
            for (const player of onlinePlayers) {
                // Calculate distance
                const distance = Math.sqrt(
                    Math.pow(player.x - targetPlayer.x, 2) + 
                    Math.pow(player.z - targetPlayer.z, 2)
                );
                
                console.log(`Player ${player.name}: distance=${Math.round(distance)}, nation=${player.nation || 'None'}, coords=(${player.x}, ${player.z})`);
                
                if (distance <= radius) {
                    console.log(`✓ ${player.name} is within ${radius} block radius (${Math.round(distance)} blocks)`);
                    
                    // Check if player should be excluded
                    let shouldExclude = false;
                    let exclusionReason = '';
                    
                    // Exclude if same nation
                    if (playerNation && player.nation === playerNation) {
                        shouldExclude = true;
                        exclusionReason = `same nation (${playerNation})`;
                    }
                    
                    // Exclude if in alliance
                    if (player.nation && allianceNations.includes(player.nation.toLowerCase())) {
                        shouldExclude = true;
                        exclusionReason = `allied nation (${player.nation})`;
                    }
                    
                    if (shouldExclude) {
                        console.log(`✗ Excluding ${player.name} - ${exclusionReason}`);
                    } else {
                        console.log(`⚠️ Adding ${player.name} as threat - distance: ${Math.round(distance)}, nation: ${player.nation || 'None'}`);
                        nearbyPlayers.push({
                            name: player.name,
                            distance: Math.round(distance),
                            nation: player.nation || 'None',
                            town: player.town || 'None',
                            x: player.x,
                            z: player.z
                        });
                    }
                } else {
                    console.log(`✗ ${player.name} is too far (${Math.round(distance)} > ${radius} blocks)`);
                }
            }

            console.log(`Final nearby threats: ${nearbyPlayers.length}`);

            // Check for new threats
            const currentNearbyNames = new Set(nearbyPlayers.map(p => p.name));
            const newThreats = nearbyPlayers.filter(p => !lastKnownNearbyPlayers.has(p.name));
            const leftPlayers = [...lastKnownNearbyPlayers].filter(name => !currentNearbyNames.has(name));

            if (newThreats.length > 0) {
                console.log(`🚨 NEW THREATS DETECTED: ${newThreats.map(t => t.name).join(', ')}`);
            }
            if (leftPlayers.length > 0) {
                console.log(`✅ Threats left: ${leftPlayers.join(', ')}`);
            }

            // Emit events for new threats
            if (newThreats.length > 0) {
                defenseTracker.emit('newThreats', {
                    playerName,
                    threats: newThreats,
                    totalNearby: nearbyPlayers.length
                });
            }

            // Emit events for players leaving
            if (leftPlayers.length > 0) {
                defenseTracker.emit('threatsLeft', {
                    playerName,
                    leftPlayers,
                    remaining: nearbyPlayers.length
                });
            }

            lastKnownNearbyPlayers = currentNearbyNames;
            console.log(`=== End defense monitoring check ===`);
            
        } catch (error) {
            console.error('Defense monitoring error:', error);
            defenseTracker.emit('monitoringError', error);
        }
    };

    // Check every 10 seconds
    monitoringInterval = setInterval(checkNearbyPlayers, 10000);
    
    // Initial check
    setTimeout(checkNearbyPlayers, 2000);
    
    // Add stop method
    defenseTracker.stop = () => {
        isMonitoring = false;
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
        }
    };

    defenseTracker.markAsStopped = () => {
        isMonitoring = false;
    };

    return defenseTracker;
}

function setupDefenseListeners(tracker, user, playerName, radius, playerNation) {
    const userId = user.id;
    let hasBeenStopped = false;

    tracker.on('playerOffline', async (data) => {
        if (hasBeenStopped) return;
        hasBeenStopped = true;
        
        try {
            const embed = new EmbedBuilder()
                .setTitle('📴 Player Offline')
                .setDescription(`**${playerName}** went offline`)
                .addFields({ 
                    name: 'Status', 
                    value: '🔴 Defense monitoring stopped - player is no longer online', 
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
                    console.error('Error stopping defense tracker:', stopError);
                }
                activeTrackers.delete(userId);
            }
            
        } catch (dmError) {
            console.error('Failed to send offline DM:', dmError);
        }
    });

    tracker.on('newThreats', async (data) => {
        if (hasBeenStopped) return;
        
        try {
            console.log(`Sending threat alert DM to user ${userId} for ${data.threats.length} threats`);
            
            const embed = new EmbedBuilder()
                .setTitle('⚠️ Enemy Players Detected!')
                .setDescription(`**${data.threats.length}** enemy player(s) detected near **${playerName}**`)
                .setColor('#FF0000')
                .setTimestamp();

            let threatsList = '';
            for (const threat of data.threats.slice(0, 5)) { // Limit to 5 threats to avoid embed limits
                threatsList += `**${threat.name}** (${threat.nation})\n`;
                threatsList += `┗ Distance: ${threat.distance} blocks\n`;
                threatsList += `┗ Location: ${threat.x}, ${threat.z}\n\n`;
            }

            if (data.threats.length > 5) {
                threatsList += `*...and ${data.threats.length - 5} more*`;
            }

            embed.addFields(
                { name: 'Threats Detected', value: threatsList, inline: false },
                { name: 'Alert Radius', value: `${radius} blocks`, inline: true },
                { name: 'Total Nearby', value: data.totalNearby.toString(), inline: true }
            );

            await user.send({ embeds: [embed] });
            console.log(`Successfully sent threat alert DM to user ${userId}`);
            
            // Update tracker info
            const trackerInfo = activeTrackers.get(userId);
            if (trackerInfo) {
                trackerInfo.lastUpdate = new Date();
                trackerInfo.updateCount++;
            }
        } catch (dmError) {
            console.error('Failed to send threat detection DM:', dmError);
        }
    });

    tracker.on('threatsLeft', async (data) => {
        if (hasBeenStopped) return;
        
        try {
            const embed = new EmbedBuilder()
                .setTitle('✅ Threats Cleared')
                .setDescription(`**${data.leftPlayers.length}** player(s) left the area around **${playerName}**`)
                .addFields(
                    { name: 'Players Left', value: data.leftPlayers.join(', '), inline: false },
                    { name: 'Remaining Threats', value: data.remaining.toString(), inline: true }
                )
                .setColor('#00FF00')
                .setTimestamp();

            await user.send({ embeds: [embed] });
            
            // Update tracker info
            const trackerInfo = activeTrackers.get(userId);
            if (trackerInfo) {
                trackerInfo.lastUpdate = new Date();
                trackerInfo.updateCount++;
            }
        } catch (dmError) {
            console.error('Failed to send threat cleared DM:', dmError);
        }
    });

    tracker.on('monitoringError', async (error) => {
        if (hasBeenStopped) return;
        
        console.error('Defense monitoring error:', error);
        // Don't spam user with every error, just log them
    });

    // Add a method to mark this tracker as stopped
    tracker.markAsStopped = () => {
        hasBeenStopped = true;
    };
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
            .setTitle('⏹️ Tracking Stopped')
            .setDescription(trackerInfo.isDefenseMode ? 
                `Stopped defense monitoring for **${trackerInfo.playerName}**` :
                `Stopped tracking **${trackerInfo.playerName}**`)
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
        .setDescription(trackerInfo.isDefenseMode ? 
            `Defense monitoring **${trackerInfo.playerName}**` :
            `Currently tracking **${trackerInfo.playerName}**`)
        .addFields(
            { name: 'Duration', value: `${minutes}m ${seconds}s`, inline: true },
            { name: 'Updates Received', value: trackerInfo.updateCount.toString(), inline: true },
            { name: 'Last Update', value: trackerInfo.lastUpdate ? `<t:${Math.floor(trackerInfo.lastUpdate.getTime() / 1000)}:R>` : 'None yet', inline: true }
        )
        .setColor(trackerInfo.isDefenseMode ? '#FF6B35' : '#0099FF')
        .setTimestamp()
        .setFooter({ text: 'Use /track stop to end tracking' });

    if (trackerInfo.isDefenseMode) {
        embed.addFields(
            { name: 'Alert Radius', value: `${trackerInfo.radius} blocks`, inline: true },
            { name: 'Your Nation', value: trackerInfo.playerNation || 'None', inline: true },
            { name: 'Alliance Nations', value: trackerInfo.allianceNations.toString(), inline: true }
        );
    }

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