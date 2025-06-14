// src/config/config.js
const fs = require('fs/promises');
const path = require('path');

class Config {
    static token = "MTMxODQyMzQ4MTg1NTI0NjMzNg.GnvwX6.MFFNf0A2_i4xceb4WzJj90BFsuxQGqlzzrEHTY";
    static whitelistedUsers = new Set(['1175990722437066784']);
    static baseUrl = 'https://api.earthmc.net/v3/aurora';
    static authFile = path.join(__dirname, '../../authorized_users.json');

    static async loadAuthorizedUsers() {
        try {
            const data = await fs.readFile(Config.authFile, 'utf8');
            const parsed = JSON.parse(data);
            Config.whitelistedUsers = new Set(parsed.whitelistedUsers);
            console.log('Loaded authorized users:', [...Config.whitelistedUsers]);
        } catch (error) {
            console.log('Creating new authorized users file');
            await Config.saveAuthorizedUsers();
        }
    }

    static async saveAuthorizedUsers() {
        try {
            await fs.writeFile(
                Config.authFile,
                JSON.stringify({
                    whitelistedUsers: [...Config.whitelistedUsers]
                }, null, 2)
            );
            console.log('Saved authorized users');
        } catch (error) {
            console.error('Error saving authorized users:', error);
        }
    }
}

module.exports = Config;