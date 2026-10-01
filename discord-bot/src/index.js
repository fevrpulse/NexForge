const { Client, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const { loadConfig } = require('./config');
const { commands } = require('./commands');
const { registerCommands } = require('./register-commands');
const { welcomeMember } = require('./welcome');

const config = loadConfig();
const byName = new Map(commands.map((command) => [command.data.name, command]));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  try {
    await registerCommands(config);
  } catch (err) {
    console.error(`Failed to register slash commands: ${err.message}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = byName.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`/${interaction.commandName} failed:`, err);
    const payload = {
      content: 'Something went wrong running that command.',
      flags: MessageFlags.Ephemeral,
    };
    const reply = interaction.replied || interaction.deferred
      ? interaction.followUp(payload)
      : interaction.reply(payload);
    await reply.catch(() => {});
  }
});

client.on(Events.GuildMemberAdd, (member) => {
  welcomeMember(member, config).catch((err) => {
    console.error(`Welcome handler failed: ${err.message}`);
  });
});

client.login(config.token);
