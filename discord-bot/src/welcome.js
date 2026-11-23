function buildWelcomeMessage({ mention, guildName, roleMention }) {
  const lines = [
    `Welcome ${mention} to **${guildName}**.`,
    'This is the NexForge server for game stats, the overlay, friends, and squads.',
    'Use `/stats` to look up a player.',
  ];
  if (roleMention) lines.push(`You have been given ${roleMention}.`);
  return lines.join('\n');
}

async function assignWelcomeRole(member, roleId) {
  try {
    const role = await member.guild.roles.fetch(roleId);
    if (!role) {
      console.warn(`WELCOME_ROLE_ID ${roleId} was not found in ${member.guild.name}.`);
      return null;
    }
    await member.roles.add(role, 'NexForge welcome role');
    return `${role}`;
  } catch (err) {
    console.error(`Could not assign welcome role in ${member.guild.name}: ${err.message}`);
    return null;
  }
}

async function resolveWelcomeChannel(guild, channelId) {
  try {
    if (channelId) {
      const channel = await guild.channels.fetch(channelId);
      if (channel?.isTextBased()) return channel;
      console.warn(`WELCOME_CHANNEL_ID ${channelId} is not a text channel.`);
      return null;
    }
    return guild.systemChannel;
  } catch (err) {
    console.error(`Could not resolve welcome channel: ${err.message}`);
    return null;
  }
}

async function welcomeMember(member, config) {
  if (member.user?.bot) return;

  const roleMention = config.welcomeRoleId
    ? await assignWelcomeRole(member, config.welcomeRoleId)
    : null;

  const channel = await resolveWelcomeChannel(member.guild, config.welcomeChannelId);
  if (!channel) {
    console.warn(
      `No welcome channel for ${member.guild.name}. Set WELCOME_CHANNEL_ID or a system channel.`
    );
    return;
  }

  const content = buildWelcomeMessage({
    mention: `${member}`,
    guildName: member.guild.name,
    roleMention,
  });
  await channel.send({ content, allowedMentions: { users: [member.id] } });
}

module.exports = { buildWelcomeMessage, welcomeMember };
