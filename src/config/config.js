const fs = require('fs/promises');
const path = require('path');

class Config {
    static token = "errrrrr";
    static whitelistedUsers = new Set(['1175990722437066784']);
    static whitelistEnabled = true; // Default to whitelist enabled
    static baseUrl = 'https://api.earthmc.net/v3/aurora';
    static authFile = path.join(__dirname, '../../authorized_users.json');

    static async loadAuthorizedUsers() {
        try {
            const data = await fs.readFile(Config.authFile, 'utf8');
            const parsed = JSON.parse(data);
            Config.whitelistedUsers = new Set(parsed.whitelistedUsers);
            Config.whitelistEnabled = parsed.whitelistEnabled !== undefined ? parsed.whitelistEnabled : true;
            console.log('Loaded authorized users:', [...Config.whitelistedUsers]);
            console.log('Whitelist enabled:', Config.whitelistEnabled);
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
                    whitelistedUsers: [...Config.whitelistedUsers],
                    whitelistEnabled: Config.whitelistEnabled
                }, null, 2)
            );
            console.log('Saved authorized users and whitelist settings');
        } catch (error) {
            console.error('Error saving authorized users:', error);
        }
    }
}

module.exports = Config;
