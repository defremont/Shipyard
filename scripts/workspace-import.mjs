#!/usr/bin/env node
// Rebuild a Shipyard workspace from a bundle made by workspace-export.mjs.
//
// Clones every repo under --root, unpacks the ones that had no remote,
// restores the gitignored .env files, and installs the Shipyard data dir with
// every path rewritten to this machine. Re-running it is safe: a checkout that
// is already there is left alone.
//
//   node scripts/workspace-import.mjs <bundle> --root <dir> [--install] [--dry-run]

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, statSync, rmSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { tmpdir } from 'os';

function parseArgs(argv) {
  const args = { bundle: null, root: null, install: false, dryRun: false, dataDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') args.root = argv[++i];
    else if (a === '--data-dir') args.dataDir = argv[++i];
    else if (a === '--install') args.install = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!args.bundle) args.bundle = a;
  }
  return args;
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function tryRun(cmd, cmdArgs, cwd) {
  try { execFileSync(cmd, cmdArgs, { cwd, stdio: 'inherit' }); return true; } catch { return false; }
}

function quiet(cmd, cmdArgs, cwd) {
  try { execFileSync(cmd, cmdArgs, { cwd, stdio: 'ignore' }); return true; } catch { return false; }
}

// Accept either the exported folder or its zip.
function resolveBundle(input) {
  const path = resolve(input);
  if (isDir(path)) return { dir: path, temp: null };
  if (!existsSync(path)) {
    console.error(`bundle not found: ${path}`);
    process.exit(1);
  }
  const temp = join(tmpdir(), `shipyard-import-${Date.now()}`);
  mkdirSync(temp, { recursive: true });
  // Same reason as the export: the MSYS tar on Windows cannot read a zip.
  const unpacked = path.endsWith('.zip') && process.platform === 'win32'
    ? quiet('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -Path '${path}' -DestinationPath '${temp}' -Force`])
    : quiet('tar', ['-x', '-f', path, '-C', temp]);
  if (!unpacked) {
    console.error('could not unpack the archive — extract it by hand and pass the folder');
    process.exit(1);
  }
  const dir = existsSync(join(temp, 'manifest.json'))
    ? temp
    : readdirSync(temp).map(n => join(temp, n)).filter(isDir).find(d => existsSync(join(d, 'manifest.json')));
  if (!dir) {
    console.error('manifest.json not found inside the bundle');
    process.exit(1);
  }
  return { dir, temp };
}

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else copyFileSync(from, to);
  }
}

function restoreRepo(repo, { bundleRoot, projectDir, projectId, failures, label }) {
  const dest = repo.rel ? join(projectDir, ...repo.rel.split('/')) : projectDir;

  if (isDir(join(dest, '.git'))) {
    console.log(`  = ${label}: already here`);
  } else if (repo.remote) {
    console.log(`  + ${label}: cloning`);
    mkdirSync(dirname(dest), { recursive: true });
    if (!tryRun('git', ['clone', repo.remote, dest])) {
      failures.push(`${label}: clone failed (${repo.remote})`);
      return;
    }
    if (repo.branch && repo.branch !== 'HEAD') quiet('git', ['checkout', repo.branch], dest);
  } else if (repo.bundle) {
    const file = join(bundleRoot, 'bundles', repo.bundle);
    if (!existsSync(file)) {
      failures.push(`${label}: bundle file missing`);
      return;
    }
    console.log(`  + ${label}: unpacking bundle`);
    mkdirSync(dirname(dest), { recursive: true });
    if (!tryRun('git', ['clone', file, dest])) {
      failures.push(`${label}: could not unpack the bundle`);
      return;
    }
    // The bundle lived in a temp folder; leaving it as origin would rot.
    quiet('git', ['remote', 'remove', 'origin'], dest);
    if (repo.branch && repo.branch !== 'HEAD') quiet('git', ['checkout', repo.branch], dest);
    failures.push(`${label}: restored from bundle, it still has no remote`);
  } else {
    failures.push(`${label}: nothing to restore from`);
    return;
  }

  for (const secret of repo.secrets || []) {
    const parts = [...(repo.rel ? repo.rel.split('/') : []), ...secret.split('/')];
    const from = join(bundleRoot, 'secrets', projectId, ...parts);
    if (!existsSync(from)) continue;
    const to = join(dest, ...secret.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    console.log(`      ${secret}`);
  }

  return dest;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.bundle) {
    console.log('usage: node scripts/workspace-import.mjs <bundle> --root <dir> [--data-dir <path>] [--install] [--dry-run]');
    process.exit(args.help ? 0 : 1);
  }
  if (!args.root) {
    console.error('--root is required: the folder where the repos should live (e.g. C:\\Code)');
    process.exit(1);
  }

  // A copy of this script travels inside the bundle, so the data dir cannot be
  // guessed from where the file sits: it is stated, or inherited, or refused.
  const DATA_DIR = args.dataDir
    ? resolve(args.dataDir)
    : process.env.SHIPYARD_DATA_DIR
      ? resolve(process.env.SHIPYARD_DATA_DIR)
      : existsSync(resolve(import.meta.dirname, '..', 'package.json'))
        ? resolve(import.meta.dirname, '..', 'data')
        : null;
  if (!DATA_DIR) {
    console.error('cannot tell where the Shipyard data dir is. Pass --data-dir <path>, or set SHIPYARD_DATA_DIR.');
    console.error('  Electron app: %APPDATA%\Shipyard\data   ·   pnpm dev: <shipyard repo>/data');
    process.exit(1);
  }

  const { dir: bundleRoot, temp } = resolveBundle(args.bundle);
  const manifest = JSON.parse(readFileSync(join(bundleRoot, 'manifest.json'), 'utf8'));
  const root = resolve(args.root);
  const repoCount = manifest.projects.reduce((n, p) => n + p.repos.length, 0);

  console.log(`bundle from ${manifest.createdAt} (${manifest.sourcePlatform})`);
  console.log(`${manifest.projects.length} project(s) · ${repoCount} repo(s) → ${root}`);
  if (args.dryRun) console.log('dry run: nothing will be written\n');

  if (!args.dryRun) mkdirSync(root, { recursive: true });

  const pathMap = new Map();
  const failures = [];
  const installTargets = [];

  for (const project of manifest.projects) {
    const rel = project.rel || project.name;
    const projectDir = join(root, ...rel.split(/[\\/]/));
    pathMap.set(project.abs, projectDir);

    if (args.dryRun) {
      console.log(`  ${project.name} → ${projectDir}`);
      for (const repo of project.repos) {
        const how = repo.remote ? 'clone' : repo.bundle ? 'bundle' : 'MISSING';
        console.log(`      ${repo.rel || '.'} (${how})`);
      }
      continue;
    }

    console.log(`\n· ${project.name}`);
    mkdirSync(projectDir, { recursive: true });
    for (const repo of project.repos) {
      const label = repo.rel || project.name;
      const dest = restoreRepo(repo, { bundleRoot, projectDir, projectId: project.id, failures, label });
      if (dest && existsSync(join(dest, 'package.json'))) installTargets.push(dest);
    }
  }

  if (args.dryRun) {
    console.log(`\ndata dir would be written to ${DATA_DIR}`);
    if (temp) rmSync(temp, { recursive: true, force: true });
    return;
  }

  if (args.install) {
    for (const dest of installTargets) {
      console.log(`\npnpm install in ${dest}`);
      if (!tryRun('pnpm', ['install'], dest)) failures.push(`${dest}: pnpm install failed`);
    }
  }

  // Shipyard's own state, with every absolute path pointing at this machine.
  if (existsSync(DATA_DIR) && readdirSync(DATA_DIR).some(f => f !== '.gitkeep')) {
    const backup = `${DATA_DIR}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    renameSync(DATA_DIR, backup);
    console.log(`\nprevious data dir moved to ${backup}`);
  }
  copyTree(join(bundleRoot, 'data'), DATA_DIR);

  const settingsPath = join(DATA_DIR, 'settings.json');
  if (existsSync(settingsPath)) {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    settings.selectedProjects = (settings.selectedProjects || []).map(p => pathMap.get(p)).filter(Boolean);
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  const projectsPath = join(DATA_DIR, 'projects.json');
  if (existsSync(projectsPath)) {
    const file = JSON.parse(readFileSync(projectsPath, 'utf8'));
    file.projects = (file.projects || []).map(p => {
      const next = pathMap.get(p.path);
      return next ? { ...p, path: next } : p;
    });
    writeFileSync(projectsPath, JSON.stringify(file, null, 2));
  }

  console.log(`\ndata dir written to ${DATA_DIR}`);
  if (failures.length) {
    console.log('\nneeds your attention:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log('\nstart Shipyard and the projects should be exactly as they were.\n');

  if (temp) rmSync(temp, { recursive: true, force: true });
}

main();
