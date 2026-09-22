#!/usr/bin/env node
// Export the Shipyard workspace so another machine can rebuild it.
//
// The bundle carries only what git does not: the Shipyard data dir, the
// gitignored .env files, and a manifest saying where each repo comes from.
// Repos with a remote are cloned on the other side; repos without one travel
// as a git bundle, which is the full history in a single file and never
// includes node_modules.
//
//   node scripts/workspace-export.mjs [--out <dir>] [--no-secrets] [--zip]

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, statSync, rmSync } from 'fs';
import { resolve, join, relative, basename, dirname, sep } from 'path';
import { homedir, tmpdir } from 'os';

const DATA_DIR = process.env.SHIPYARD_DATA_DIR
  ? resolve(process.env.SHIPYARD_DATA_DIR)
  : resolve(import.meta.dirname, '..', 'data');

// Runtime noise and machine-local state: never travels.
const DATA_SKIP = new Set(['server.log', 'terminal-clipboard', 'worktrees', 'agent-prompts', '.gitkeep']);
// Encrypted credentials plus the key that opens them.
const DATA_SECRETS = new Set(['.claude-key', 'ai-config.json', 'deploy-config.json', 'mcp-auth.json', 'mcp-config.json', 'sync-config.json', 'claude.json']);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.vite', 'vendor', '.venv', 'target', 'release', '__pycache__']);
const ENV_DEPTH = 3;

function parseArgs(argv) {
  const args = { out: null, secrets: true, zip: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--only') args.only = (argv[++i] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    else if (argv[i] === '--no-secrets') args.secrets = false;
    else if (argv[i] === '--zip') args.zip = true;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

function git(cwd, ...gitArgs) {
  try {
    return execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
}

// Longest path prefix shared by every project, so the other machine can
// re-root the whole tree with a single --root.
function commonRoot(paths) {
  if (!paths.length) return null;
  const split = paths.map(p => p.split(/[\\/]/));
  const first = split[0];
  let i = 0;
  while (i < first.length && split.every(parts => parts[i] === first[i])) i++;
  if (i >= first.length) i = first.length - 1;
  if (i < 1) return null;
  return first.slice(0, i).join(sep) || null;
}

// Same one-level scan projectDiscovery.detectSubRepos does, so a client folder
// holding a dozen checkouts exports as a dozen repos.
function detectSubRepos(projectPath) {
  const found = [];
  let entries;
  try { entries = readdirSync(projectPath, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    if (existsSync(join(projectPath, entry.name, '.git'))) found.push(entry.name);
  }
  return found;
}

function findEnvFiles(root) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > ENV_DEPTH) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), depth + 1);
      } else if (entry.name === '.env' || entry.name.startsWith('.env.')) {
        found.push(join(dir, entry.name));
      }
    }
  };
  walk(root, 0);
  return found;
}

// Only files git refuses to track are missing on the other machine —
// .env.example already lives in the repo and must not be duplicated here.
function keepIgnoredOnly(repoPath, files, isRepo) {
  if (!files.length) return [];
  if (!isRepo) return files;
  try {
    const rel = files.map(f => relative(repoPath, f).split(sep).join('/'));
    const out = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: repoPath, input: rel.join('\n'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
    });
    const ignored = new Set(out.split('\n').map(s => s.trim()).filter(Boolean));
    return files.filter(f => ignored.has(relative(repoPath, f).split(sep).join('/')));
  } catch {
    // check-ignore exits 1 when nothing matched — a real answer, not a failure.
    return [];
  }
}

function copyTree(src, dest, skip = new Set()) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    // 1.4 GB of these piled up here once: corruption backups are local debris.
    if (entry.name.includes('.corrupt-') || entry.name.endsWith('.tmp') || entry.name.endsWith('.bak')) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to, skip);
    else copyFileSync(from, to);
  }
}

// A briefing the other machine's agent can act on without guessing: it knows
// where Shipyard comes from, what --root meant here, and what is still loose.
function writePrompt(outDir, { manifest, shipyardRemote, dataDirEnvUsed, repoCount, bundleCount, taskCount }) {
  const releasesUrl = shipyardRemote && shipyardRemote.includes('github.com')
    ? shipyardRemote.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/') + '/releases/latest'
    : null;
  const loose = manifest.projects.flatMap(p =>
    p.repos.filter(r => !r.remote).map(r => `${p.name}${r.rel ? '/' + r.rel : ''}`)
  );
  const shaky = manifest.projects.flatMap(p =>
    p.repos.filter(r => r.dirty || r.unpushed).map(r => {
      const label = `${p.name}${r.rel ? '/' + r.rel : ''}`;
      const bits = [
        r.dirty ? `${r.dirty} alteração(ões) sem commit` : null,
        r.unpushed ? `${r.unpushed} commit(s) sem push` : null,
      ].filter(Boolean);
      return `- \`${label}\` — ficou com ${bits.join(' e ')} na máquina de origem, então pode faltar trabalho recente aqui`;
    })
  );

  const attention = [
    ...loose.map(l => `- \`${l}\` — veio como \`git bundle\` e continua **sem remote** depois do import. Me lembre de criar um repositório remoto: enquanto não tiver, esse histórico existe em dois computadores e em nenhum servidor.`),
    ...shaky,
  ];

  const text = `# Prompt para o Claude Code no outro computador

Copie tudo abaixo da linha e cole no Claude Code do computador novo.

---

Vou configurar o Shipyard neste computador a partir de um bundle exportado da minha outra máquina. Faça o processo inteiro e só me pergunte o que não der para decidir sozinho.

**O bundle está em:** \`<COLE AQUI O CAMINHO DO BUNDLE NESTE COMPUTADOR>\`

**O que ele contém** (gerado em ${manifest.createdAt} num ${manifest.sourcePlatform}):
- ${manifest.projects.length} projetos, ${repoCount} repositórios git${bundleCount ? `, ${bundleCount} deles empacotados como \`git bundle\` por não terem remote` : ' — todos com remote, então todos vêm por clone'}
- ${taskCount} arquivos de tarefas do Shipyard, mais as credenciais cifradas (Trello/ClickUp, Railway, IA) e a chave \`.claude-key\` que as abre
- os arquivos \`.env\` que o git não versiona

**Passos:**

1. Confirme que \`git\`, \`node\` e \`pnpm\` estão instalados. Se faltar o pnpm: \`npm i -g pnpm\`.

2. Instale o Shipyard. São dois caminhos — me pergunte qual eu quero:
   - **App pronto**: baixe o instalador mais recente em ${releasesUrl || '<pagina de releases>'} e instale. A data dir fica em \`%APPDATA%\\Shipyard\\data\`.
   - **Do código** (necessário se eu for mexer no próprio Shipyard):
     \`\`\`
     git clone ${shipyardRemote || '<remote do Shipyard>'} <pasta onde o Shipyard deve ficar>
     cd <essa pasta>
     pnpm install
     \`\`\`
     A data dir aí é a pasta \`data/\` do repositório.

3. Decida comigo onde os repositórios de trabalho vão ficar. Na máquina de origem a raiz era \`${manifest.root || '(mista)'}\`. Se aqui for a mesma, use a mesma; senão me pergunte.

4. Rode o import. O próprio bundle traz uma cópia do script, então use a que estiver mais nova — se o Shipyard que você clonou já tem \`scripts/workspace-import.mjs\`, use essa; senão use a de dentro do bundle:
   \`\`\`
   node scripts/workspace-import.mjs "<caminho do bundle>" --root "<raiz escolhida>" --data-dir "<data dir>" --install
   \`\`\`
   Ele clona cada repositório, desempacota os que vieram em bundle, restaura os \`.env\` e instala a configuração do Shipyard com todos os caminhos reescritos para este computador. Sem \`--install\` ele pula o \`pnpm install\` de cada projeto — o que é mais rápido se eu quiser instalar só nos que for usar. Rodar de novo é seguro.

5. **Importante sobre a data dir.** Na máquina de origem o Shipyard lê${dataDirEnvUsed ? ' a variável de ambiente `SHIPYARD_DATA_DIR`, apontada para `' + manifest.sourceDataDir + '`' : ' a pasta `data/` dentro do próprio repositório'}. O import escreve na data dir que estiver valendo neste computador. Antes de rodar, confirme comigo qual é o caso aqui:
   - se eu for usar o app Electron instalado, a data dir é \`%APPDATA%\\Shipyard\\data\`
   - se eu for rodar \`pnpm dev\`, é a pasta \`data/\` do repositório
   Defina \`SHIPYARD_DATA_DIR\` antes de rodar o import se for preciso, para não escrever no lugar errado.

6. Suba o Shipyard (\`pnpm dev\`, ou o app se eu tiver instalado) e confira comigo que os projetos aparecem com as tarefas, o Trello/ClickUp conectado e os deploys do Railway.

**O que vai precisar de atenção no fim:**
${attention.length ? attention.join('\n') : '- nada pendente'}

**Não faça:** não suba o bundle para nenhum lugar público nem o comite. Ele contém \`.env\` e a chave que abre minhas credenciais. Depois que o import terminar e eu confirmar que está tudo certo, me pergunte se pode apagar o bundle deste computador.
`;

  writeFileSync(join(outDir, 'PROMPT.md'), text);
}

// Git Bash ships an MSYS tar that cannot write zip, so on Windows the
// archive goes through PowerShell instead of guessing which tar is on PATH.
function makeArchive(dir) {
  const zip = `${dir}.zip`;
  rmSync(zip, { force: true });
  if (process.platform === 'win32') {
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Compress-Archive -Path '${dir}\\*' -DestinationPath '${zip}' -Force`], { stdio: 'ignore' });
      return existsSync(zip) ? zip : null;
    } catch {
      return null;
    }
  }
  const tgz = `${dir}.tar.gz`;
  try {
    rmSync(tgz, { force: true });
    execFileSync('tar', ['-czf', tgz, '-C', dirname(dir), basename(dir)], { stdio: 'ignore' });
    return existsSync(tgz) ? tgz : null;
  } catch {
    return null;
  }
}

// One checkout: the unit that is cloned, bundled and carries its own .env files.
function describeRepo(repoPath, { projectId, rel, bundleDir, collectSecrets }) {
  const repo = {
    rel,
    remote: git(repoPath, 'remote', 'get-url', 'origin'),
    branch: git(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: (git(repoPath, 'status', '--porcelain') || '').split('\n').filter(Boolean).length,
    unpushed: 0,
    bundle: null,
    secrets: [],
  };

  if (repo.remote) {
    repo.unpushed = (git(repoPath, 'log', '--branches', '--not', '--remotes', '--oneline') || '').split('\n').filter(Boolean).length;
  } else {
    // No remote anywhere: this history exists only on this machine, so it
    // travels whole inside a bundle file.
    const name = `${projectId}${rel ? '--' + slugify(rel) : ''}.bundle`;
    const dest = join(bundleDir, name);
    mkdirSync(bundleDir, { recursive: true });
    try {
      execFileSync('git', ['bundle', 'create', dest, '--all'], { cwd: repoPath, stdio: ['ignore', 'ignore', 'ignore'] });
      repo.bundle = name;
    } catch {
      repo.bundle = null;
    }
  }

  if (collectSecrets) {
    repo.secrets = keepIgnoredOnly(repoPath, findEnvFiles(repoPath), true)
      .map(f => relative(repoPath, f).split(sep).join('/'));
  }

  return repo;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: node scripts/workspace-export.mjs [--out <dir>] [--only a,b,c] [--no-secrets] [--zip]');
    console.log('  --only  export just these projects, by folder name (the data dir always travels whole)');
    return;
  }

  if (!existsSync(DATA_DIR)) {
    console.error(`data dir not found: ${DATA_DIR}`);
    process.exit(1);
  }

  const settingsPath = join(DATA_DIR, 'settings.json');
  const projectsPath = join(DATA_DIR, 'projects.json');
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : { selectedProjects: [] };
  const projectsFile = existsSync(projectsPath) ? JSON.parse(readFileSync(projectsPath, 'utf8')) : { projects: [] };

  // Paths from a machine that no longer exists are dropped here, not carried over.
  const present = (settings.selectedProjects || []).filter(isDir);
  const dead = (settings.selectedProjects || []).filter(p => !isDir(p));

  // --only narrows which projects travel. The data dir still goes whole: the
  // task files of a project left behind cost nothing and losing them would.
  const matches = (projectPath) => {
    if (!args.only) return true;
    const name = basename(projectPath).toLowerCase();
    return args.only.includes(name) || args.only.includes(slugify(name));
  };
  const live = present.filter(matches);
  const skipped = present.filter(p => !matches(p));

  if (!live.length) {
    console.error(args.only
      ? `--only matched nothing. available: ${present.map(p => basename(p)).join(', ')}`
      : 'no existing project paths in settings.json — nothing to export');
    process.exit(1);
  }

  const root = commonRoot(live);
  const finalOut = resolve(args.out || join(homedir(), 'Desktop', 'shipyard-workspace'));
  // OneDrive grabs each new file on the Desktop for upload, and Compress-Archive
  // then fails on a file "in use". So the bundle is built off to the side and
  // only the finished archive lands where the user asked.
  const outDir = args.zip ? join(tmpdir(), `shipyard-export-${Date.now()}`) : finalOut;
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const bundleDir = join(outDir, 'bundles');
  const secretsDir = join(outDir, 'secrets');

  const warnings = [];
  const projects = [];

  for (const projectPath of live) {
    const name = basename(projectPath);
    const known = (projectsFile.projects || []).find(p => p.path === projectPath);
    // The folder name is the project id, so it has to survive the trip intact.
    const id = known?.id || slugify(name);

    const entry = {
      id,
      name,
      rel: root && projectPath.startsWith(root) ? relative(root, projectPath) : null,
      abs: projectPath,
      repos: [],
    };

    const rootIsRepo = existsSync(join(projectPath, '.git'));
    if (rootIsRepo) {
      entry.repos.push(describeRepo(projectPath, { projectId: id, rel: '', bundleDir, collectSecrets: args.secrets }));
    }
    for (const sub of detectSubRepos(projectPath)) {
      entry.repos.push(describeRepo(join(projectPath, sub), { projectId: id, rel: sub, bundleDir, collectSecrets: args.secrets }));
    }

    if (!entry.repos.length) {
      warnings.push(`${name}: no git repo inside — the folder itself is not restored`);
    }

    for (const repo of entry.repos) {
      const label = repo.rel ? `${name}/${repo.rel}` : name;
      if (repo.dirty) warnings.push(`${label}: ${repo.dirty} uncommitted change(s) — commit before exporting or they stay behind`);
      if (repo.unpushed) warnings.push(`${label}: ${repo.unpushed} commit(s) not pushed — run git push`);
      if (!repo.remote && !repo.bundle) warnings.push(`${label}: no remote and the bundle failed — this history cannot travel`);

      for (const secret of repo.secrets) {
        const from = join(projectPath, ...(repo.rel ? repo.rel.split('/') : []), ...secret.split('/'));
        const to = join(secretsDir, id, ...(repo.rel ? repo.rel.split('/') : []), ...secret.split('/'));
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      }
    }

    projects.push(entry);
  }

  // Shipyard's own state. Absolute paths inside are rewritten on import.
  const skip = new Set(DATA_SKIP);
  if (!args.secrets) for (const f of DATA_SECRETS) skip.add(f);
  copyTree(DATA_DIR, join(outDir, 'data'), skip);

  // Carry a settings.json already free of the dead paths.
  writeFileSync(join(outDir, 'data', 'settings.json'), JSON.stringify({ ...settings, selectedProjects: live }, null, 2));

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourcePlatform: process.platform,
    sourceDataDir: DATA_DIR,
    root,
    hasSecrets: args.secrets,
    projects,
    warnings,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const repoCount = projects.reduce((n, p) => n + p.repos.length, 0);
  const bundleCount = projects.reduce((n, p) => n + p.repos.filter(r => r.bundle).length, 0);
  const secretCount = projects.reduce((n, p) => n + p.repos.reduce((m, r) => m + r.secrets.length, 0), 0);
  const taskCount = existsSync(join(outDir, 'data', 'tasks'))
    ? readdirSync(join(outDir, 'data', 'tasks')).filter(f => f.endsWith('.json')).length
    : 0;

  // The importer rides along: the other machine may clone a Shipyard older
  // than this script, and then the bundle would arrive with no way in.
  copyFileSync(resolve(import.meta.dirname, 'workspace-import.mjs'), join(outDir, 'workspace-import.mjs'));

  writePrompt(outDir, {
    manifest,
    shipyardRemote: git(resolve(import.meta.dirname, '..'), 'remote', 'get-url', 'origin'),
    dataDirEnvUsed: Boolean(process.env.SHIPYARD_DATA_DIR),
    repoCount,
    bundleCount,
    taskCount,
  });

  let archive = null;
  if (args.zip) {
    const built = makeArchive(outDir);
    if (built) {
      archive = finalOut + built.slice(built.lastIndexOf('.'));
      mkdirSync(dirname(archive), { recursive: true });
      rmSync(archive, { force: true });
      copyFileSync(built, archive);
      rmSync(built, { force: true });
      rmSync(outDir, { recursive: true, force: true });
    } else {
      warnings.push(`could not create the archive — the bundle folder is at ${outDir}`);
    }
  }

  console.log(`\nbundle: ${archive || outDir}`);
  console.log(`source data dir: ${DATA_DIR}`);
  console.log(`root: ${root || '(mixed — import falls back to folder names)'}`);
  console.log(`${projects.length} project(s) · ${repoCount} repo(s) · ${bundleCount} bundled · ${taskCount} task file(s) · ${secretCount} secret file(s)`);
  if (dead.length) console.log(`dropped ${dead.length} path(s) that no longer exist here`);
  if (skipped.length) console.log(`--only left out: ${skipped.map(p => basename(p)).join(', ')}`);
  if (args.secrets) console.log('\nholds .env files and the Shipyard encryption key — keep it off any public drive');
  if (warnings.length) {
    console.log('\nwarnings:');
    for (const w of warnings) console.log(`  - ${w}`);
  }
  console.log(`\non the other machine:\n  node scripts/workspace-import.mjs "${archive || outDir}" --root <code folder>\n`);
}

main();
