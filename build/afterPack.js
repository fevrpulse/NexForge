const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');

/**
 * Stamp NexForge.exe so Task Manager shows "NexForge" instead of "Electron".
 *
 * Uses pure-JS resedit (no winCodeSign / symlink privileges required).
 * Kept separate from signAndEditExecutable because that path fails on
 * machines without Developer Mode symlink rights.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const productName = context.packager.appInfo.productName || 'NexForge';
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const version = String(context.packager.appInfo.version || '0.0.0');
  const parts = version.split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 4) parts.push(0);

  const data = fs.readFileSync(exePath);
  const exe = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const versionInfoList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = versionInfoList[0] || ResEdit.Resource.VersionInfo.createEmpty();

  vi.setFileVersion(parts[0], parts[1], parts[2], parts[3], 1033);
  vi.setProductVersion(parts[0], parts[1], parts[2], parts[3], 1033);
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      CompanyName: 'fevrpulse',
      FileDescription: productName,
      ProductName: productName,
      InternalName: productName,
      OriginalFilename: exeName,
      ProductVersion: version,
      FileVersion: version,
      LegalCopyright: `Copyright © fevrpulse`,
    },
  );
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  // Write via temp + replace to avoid EBUSY when Defender briefly locks the exe.
  const out = Buffer.from(exe.generate());
  const tmp = `${exePath}.tmp`;
  fs.writeFileSync(tmp, out);
  try {
    fs.unlinkSync(exePath);
  } catch {
    /* may already be replaceable */
  }
  fs.renameSync(tmp, exePath);
  console.log(`Stamped Task Manager name "${productName}" on ${exeName}`);
};