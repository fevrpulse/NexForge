const fs = require('fs');
const path = require('path');

/**
 * Publish the same NSIS installer under historical names so older
 * electron-updater clients (NexForge.exe, NexForge-Setup-x.y.z.exe,
 * "NexForge Setup x.y.z.exe") can still find the latest build.
 */
exports.default = async function afterAllArtifactBuild(buildResult) {
  const extra = [];
  const version = String(require('../package.json').version);
  const seen = new Set(buildResult.artifactPaths);

  for (const src of buildResult.artifactPaths) {
    if (!src.replace(/\\/g, '/').endsWith('/NexForge-Setup.exe') && path.basename(src) !== 'NexForge-Setup.exe') {
      continue;
    }
    const dir = path.dirname(src);
    const aliases = [
      path.join(dir, `NexForge-Setup-${version}.exe`),
      path.join(dir, `NexForge Setup ${version}.exe`),
      path.join(dir, 'NexForge.exe'),
    ];
    for (const dest of aliases) {
      if (seen.has(dest)) continue;
      fs.copyFileSync(src, dest);
      extra.push(dest);
      seen.add(dest);
    }
  }

  return extra;
};
