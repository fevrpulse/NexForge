const { REST, Routes } = require('discord.js');
const { loadConfig } = require('./config');
const { commands } = require('./commands');

async function registerCommands(config = loadConfig()) {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const body = commands.map((command) => command.data.toJSON());

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
    console.log(`Registered ${body.length} slash commands for guild ${config.guildId}.`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.clientId), { body });
  console.log(`Registered ${body.length} global slash commands. They can take up to an hour to appear.`);
}

module.exports = { registerCommands };
