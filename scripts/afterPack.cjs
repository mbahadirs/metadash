/**
 * electron-builder afterPack hook: flips Electron fuses on the packaged binary.
 * - runAsNode off        → ELECTRON_RUN_AS_NODE cannot turn the app into a plain Node runtime
 * - NODE_OPTIONS / --inspect off
 * - onlyLoadAppFromAsar  → the app cannot be swapped for an unpacked folder
 * - asar integrity (macOS) → a modified app.asar refuses to start
 */
const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const productFilename = packager.appInfo.productFilename;
  let binary;
  if (electronPlatformName === 'darwin') binary = path.join(appOutDir, `${productFilename}.app`, 'Contents', 'MacOS', productFilename);
  else if (electronPlatformName === 'win32') binary = path.join(appOutDir, `${productFilename}.exe`);
  else binary = path.join(appOutDir, packager.executableName ?? productFilename.toLowerCase());

  await flipFuses(binary, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: false, // true would make Chromium open the macOS Keychain ("MetaDash Safe Storage") at startup → password prompt
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: electronPlatformName === 'darwin',
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true, // file:// must keep asar access for loadFile()
  });
  console.log(`  • fuses flipped for ${electronPlatformName}: ${binary}`);
};
