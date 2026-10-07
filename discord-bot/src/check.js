const assert = require('assert');
const { PermissionFlagsBits } = require('discord.js');
const { commands, lookupPlayer, buildStatsEmbed, buildShareEmbed } = require('./commands');
const { buildWelcomeMessage } = require('./welcome');

async function main() {
  const names = commands.map((command) => command.data.name).sort();
  assert.deepEqual(names, ['post', 'stats']);

  const stats = commands.find((command) => command.data.name === 'stats').data.toJSON();
  assert.equal(stats.dm_permission, false);
  assert.equal(stats.options[0].name, 'player');
  assert.equal(stats.options[0].required, true);

  const player = await lookupPlayer('Ace');
  assert.equal(player.placeholder, true);
  assert.equal(player.name, 'Ace');

  const statsEmbed = buildStatsEmbed(player).toJSON();
  assert.equal(statsEmbed.title, 'Ace');
  assert.match(statsEmbed.description, /placeholder/i);
  assert.deepEqual(
    statsEmbed.fields.map((field) => field.name),
    ['MMR', 'Record', 'Main game']
  );
  assert.ok(statsEmbed.fields.every((field) => field.value === '—'));

  const post = commands.find((command) => command.data.name === 'post').data.toJSON();
  assert.equal(post.default_member_permissions, String(PermissionFlagsBits.ManageGuild));
  assert.equal(post.dm_permission, false);
  assert.equal(post.options.find((option) => option.name === 'message').required, true);

  const share = buildShareEmbed({
    message: 'Squad queue is open.',
    player: 'Ace',
    authorName: 'mod',
  }).toJSON();
  assert.equal(share.title, 'Ace');
  assert.equal(share.description, 'Squad queue is open.');
  assert.match(share.footer.text, /placeholders/);
  assert.equal(share.fields.length, 3);

  const plain = buildShareEmbed({
    message: 'Patch notes are up.',
    player: '',
    authorName: 'mod',
  }).toJSON();
  assert.equal(plain.title, 'NexForge');
  assert.equal(plain.fields, undefined);

  const welcome = buildWelcomeMessage({
    mention: '<@1>',
    guildName: 'NexForge',
    roleMention: '<@&2>',
  });
  assert.match(welcome, /Welcome <@1> to \*\*NexForge\*\*/);
  assert.match(welcome, /\/stats/);
  assert.match(welcome, /<@&2>/);

  const noRole = buildWelcomeMessage({ mention: '<@1>', guildName: 'NexForge' });
  assert.equal(noRole.includes('given'), false);

  console.log('discord-bot checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
