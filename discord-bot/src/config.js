const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function readEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string') return '';
  return value.trim();
}

function requireEnv(name) {
  const value = readEnv(name);
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy discord-bot/.env.example to discord-bot/.env and fill it in.`
    );
  }
  return value;
}

function loadConfig() {
  return {
    token: requireEnv('DISCORD_TOKEN'),
    clientId: requireEnv('CLIENT_ID'),
    guildId: readEnv('GUILD_ID'),
    welcomeChannelId: readEnv('WELCOME_CHANNEL_ID'),
    welcomeRoleId: readEnv('WELCOME_ROLE_ID'),
  };
}

module.exports = { loadConfig, readEnv };
