const { registerCommands } = require('./register-commands');

registerCommands()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
