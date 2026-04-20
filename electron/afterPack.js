const { execSync } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

/**
 * After electron-builder creates the unpacked directory,
 * install server production dependencies using npm (flat node_modules).
 * pnpm's symlink-based node_modules doesn't survive packaging.
 *
 * Native modules (node-pty) ship prebuilt binaries via prebuild-install.
 * We pass npm_config_target_platform/arch so the correct binary is fetched
 * for the target platform even when building on a different host (e.g.
 * building a Linux .deb on Windows).
 */
exports.default = async function (context) {
  const appDir = path.join(context.appOutDir, 'resources', 'app');

  if (!existsSync(appDir)) {
    console.log('[afterPack] No app dir found, skipping dependency install');
    return;
  }

  const serverDir = path.join(appDir, 'server');

  if (!existsSync(path.join(serverDir, 'package.json'))) {
    console.log('[afterPack] No server/package.json found, skipping');
    return;
  }

  // Map electron-builder context to npm target env vars
  const platformMap = { win32: 'win32', linux: 'linux', darwin: 'darwin', mas: 'darwin' };
  const archMap = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' };
  const targetPlatform = platformMap[context.electronPlatformName] || context.electronPlatformName;
  const targetArch = archMap[context.arch] || 'x64';

  const env = {
    ...process.env,
    npm_config_target_platform: targetPlatform,
    npm_config_target_arch: targetArch,
    // Tell prebuild-install to fetch the prebuilt binary for the target
    prebuild_install_platform: targetPlatform,
    prebuild_install_arch: targetArch,
  };

  console.log(`[afterPack] Installing server deps for ${targetPlatform}-${targetArch} in:`, serverDir);

  // Install WITHOUT --ignore-scripts so node-pty's install hook runs and
  // fetches the prebuilt binary for the target platform. The --os/--cpu
  // flags (npm 10+) keep optionalDependencies filtered to the target.
  const installCmd = `npm install --omit=dev --os=${targetPlatform} --cpu=${targetArch}`;

  try {
    execSync(installCmd, {
      cwd: serverDir,
      stdio: 'inherit',
      env,
      timeout: 300000,
    });
    console.log('[afterPack] Dependencies installed successfully');
  } catch (err) {
    console.error('[afterPack] npm install failed:', err.message);
    // Fallback: retry without optional deps (native terminal disabled, but app still works)
    try {
      execSync(`${installCmd} --no-optional`, {
        cwd: serverDir,
        stdio: 'inherit',
        env,
        timeout: 300000,
      });
      console.warn('[afterPack] Dependencies installed WITHOUT optional (node-pty unavailable — integrated terminal disabled)');
    } catch (err2) {
      console.error('[afterPack] CRITICAL: Could not install dependencies');
      throw err2;
    }
  }
};
