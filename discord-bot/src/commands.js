const {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const BRAND_COLOR = 0xd2ff2a;

function placeholderStatFields() {
  return [
    { name: 'MMR', value: '—', inline: true },
    { name: 'Record', value: '—', inline: true },
    { name: 'Main game', value: '—', inline: true },
  ];
}

/**
 * Placeholder player lookup.
 *
 * TODO: Fill this from the existing `public.profiles` row
 * (gamer_tag, mmr, wins, losses, platform, main_game, total_kills,
 * total_deaths, total_assists). Profiles are publicly selectable
 * ("Profiles are viewable by everyone" in supabase-setup.sql) and gamer
 * tags are unique case-insensitively (profiles_gamer_tag_lower_uidx in
 * v144-profile-identity.sql). The desktop app already uses the Supabase
 * anon key in src/renderer/lib/supabase.js. There is no separate public
 * HTTP player-lookup route — do not invent one. `get_friend_profile` is
 * the wrong call: it requires a signed-in user who is friends with the
 * target. Query `profiles` by lower(gamer_tag) and return a not-found
 * embed when the row is missing.
 */
async function lookupPlayer(name) {
  return { name, placeholder: true };
}

function buildStatsEmbed(player) {
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(player.name)
    .setDescription('Player lookup is not connected yet. These stats are placeholders.')
    .addFields(placeholderStatFields())
    .setFooter({ text: 'NexForge · placeholder' });
}

function buildShareEmbed({ message, player, authorName }) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(player || 'NexForge')
    .setDescription(message)
    .setFooter({
      text: player
        ? `Shared by ${authorName} · stats are placeholders`
        : `Shared by ${authorName}`,
    });
  if (player) embed.addFields(placeholderStatFields());
  return embed;
}

const statsCommand = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Look up a NexForge player by gamer tag')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('player')
        .setDescription('Gamer tag')
        .setRequired(true)
        .setMaxLength(32)
    ),
  async execute(interaction) {
    const name = interaction.options.getString('player', true).trim();
    if (!name) {
      await interaction.reply({
        content: 'Enter a gamer tag.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const player = await lookupPlayer(name);
    await interaction.reply({ embeds: [buildStatsEmbed(player)] });
  },
};

const postCommand = {
  data: new SlashCommandBuilder()
    .setName('post')
    .setDescription('Post a short stats or share message to a channel')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('Short message to post')
        .setRequired(true)
        .setMaxLength(500)
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to post in (defaults to this channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addStringOption((option) =>
      option
        .setName('player')
        .setDescription('Optional gamer tag to show on the post')
        .setMaxLength(32)
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: 'You need Manage Server to post.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const message = interaction.options.getString('message', true).trim();
    const player = interaction.options.getString('player')?.trim() || '';
    const channel = interaction.options.getChannel('channel') || interaction.channel;

    if (!message) {
      await interaction.reply({
        content: 'Write a short message to post.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!channel?.isTextBased?.()) {
      await interaction.reply({
        content: 'Pick a text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const me = interaction.guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (!perms?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      await interaction.reply({
        content: `I can't post in ${channel}. I need Send Messages and Embed Links there.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = buildShareEmbed({
      message,
      player,
      authorName: interaction.user.username,
    });

    try {
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    } catch (err) {
      await interaction.reply({
        content: `Couldn't post in ${channel}: ${err.message}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: `Posted in ${channel}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

const commands = [statsCommand, postCommand];

module.exports = {
  commands,
  lookupPlayer,
  buildStatsEmbed,
  buildShareEmbed,
  placeholderStatFields,
};
