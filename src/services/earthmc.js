// src/services/earthmc.js
const axios = require('axios');
const Config = require('../config/config');

class EarthMCClient {
    static cache = new Map();
    static cacheTime = 60000;
    static rateLimiter = {
        lastCall: 0,
        minInterval: 1000
    };

    static async makeRequest(endpoint, method = 'GET', data = null) {
        const cacheKey = `${endpoint}-${method}-${JSON.stringify(data)}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheTime) {
            return cached.data;
        }

        await this.handleRateLimit();
        try {
            const response = await axios({
                method,
                url: `${Config.baseUrl}/${endpoint}`,
                data
            });
            
            this.cache.set(cacheKey, {
                data: response.data,
                timestamp: Date.now()
            });
            
            return response.data;
        } catch (error) {
            console.error(`API Error: ${error.message}`);
            throw error;
        }
    }

    static async handleRateLimit() {
        const now = Date.now();
        const timeSinceLastCall = now - this.rateLimiter.lastCall;
        if (timeSinceLastCall < this.rateLimiter.minInterval) {
            await new Promise(resolve => 
                setTimeout(resolve, this.rateLimiter.minInterval - timeSinceLastCall)
            );
        }
        this.rateLimiter.lastCall = Date.now();
    }

    static clearCache() {
        this.cache.clear();
    }
}

module.exports = EarthMCClient;