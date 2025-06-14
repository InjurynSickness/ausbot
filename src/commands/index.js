const { Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = new Collection();
const commandData = [];

const commandFiles = fs.readdirSync(__dirname)
    .filter(file => file !== 'index.js' && file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./${file}`);
    
    // Handle array of commands (like in admin.js, info.js)
    if (Array.isArray(command.data)) {
        command.data.forEach(cmd => {
            commands.set(cmd.name, {
                execute: command.execute,
                data: cmd
            });
            commandData.push(cmd);
        });
    }
    // Handle single command (like in town.js)
    else if (command.data?.name) {
        commands.set(command.data.name, command);
        commandData.push(command.data);
    }
}

module.exports = {
    get: (name) => commands.get(name),
    data: commandData
};