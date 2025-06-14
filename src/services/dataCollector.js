// src/services/dataCollector.js
const cron = require('node-cron');
const EarthMCClient = require('./earthmc');
const Database = require('./database');

class DataCollector {
    constructor() {
        this.db = new Database();
        this.setupScheduledCollection();
        this.isCollecting = false;
    }

    setupScheduledCollection() {
        // Run daily at 6:05 AM EST (after newday)
        cron.schedule('5 11 * * *', async () => {
            console.log('Starting scheduled daily nation data collection...');
            await this.collectAllNationData();
        }, {
            timezone: "America/New_York"
        });

        console.log('Scheduled data collection task set up for 6:05 AM EST daily');
    }

    async collectAllNationData() {
        if (this.isCollecting) {
            console.log('Data collection already in progress, skipping...');
            return;
        }

        this.isCollecting = true;
        let collected = 0;
        let errors = 0;

        try {
            const nations = await EarthMCClient.makeRequest('nations');
            console.log(`Starting collection for ${nations.length} nations...`);
            
            for (const nation of nations) {
                try {
                    const detailedNation = await EarthMCClient.makeRequest('nations', 'POST', { 
                        query: [nation.uuid] 
                    });
                    
                    if (detailedNation[0]) {
                        await this.db.saveNationSnapshot(detailedNation[0]);
                        collected++;
                        
                        if (collected % 10 === 0) {
                            console.log(`Collected data for ${collected} nations...`);
                        }
                    }
                    
                    // Rate limiting - 1 second between requests
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error(`Error collecting data for ${nation.name}:`, error.message);
                    errors++;
                }
            }
            
            console.log(`Daily data collection completed: ${collected} nations collected, ${errors} errors`);
        } catch (error) {
            console.error('Error in daily data collection:', error);
        } finally {
            this.isCollecting = false;
        }
    }

    async collectSpecificNation(nationName) {
        try {
            const nationData = await EarthMCClient.makeRequest('nations', 'POST', { 
                query: [nationName] 
            });
            
            if (nationData[0]) {
                await this.db.saveNationSnapshot(nationData[0]);
                console.log(`Collected data for ${nationName}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`Error collecting data for ${nationName}:`, error);
            return false;
        }
    }

    async manualCollection() {
        console.log('Starting manual data collection...');
        await this.collectAllNationData();
    }

    getCollectionStatus() {
        return this.isCollecting;
    }
}

module.exports = DataCollector;