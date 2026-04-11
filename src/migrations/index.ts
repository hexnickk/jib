import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { jibMigrations } from '@jib/state'
import { repairManagedSecretsTree } from './secrets.ts'
import { type JibMigration, type MigrationContext, initCtx } from './types.ts'

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Run all pending migrations. Returns IDs of newly applied ones. */
export async function runJibMigrations(
  ctx: MigrationContext,
  list: JibMigration[],
): Promise<string[]> {
  const existing = new Set(
    ctx.db
      .select({ id: jibMigrations.id })
      .from(jibMigrations)
      .all()
      .map((r) => r.id),
  )

  const applied: string[] = []
  for (const m of list) {
    if (existing.has(m.id)) continue
    await m.up(ctx)
    ctx.db.insert(jibMigrations).values({ id: m.id }).run()
    applied.push(m.id)
  }
  return applied
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GROUP = 'jib'

const SUDOERS_PATH = '/etc/sudoers.d/jib'
export function buildSudoersContent(): string {
  return `# jib: allow jib group to manage jib-owned services without password
%jib ALL=(root) NOPASSWD: /usr/bin/systemctl start jib-*, \\
  /usr/bin/systemctl stop jib-*, \\
  /usr/bin/systemctl restart jib-*, \\
  /usr/bin/systemctl enable jib-*, \\
  /usr/bin/systemctl disable jib-*, \\
  /usr/bin/systemctl daemon-reload, \\
  /usr/bin/systemctl reload nginx, \\
  /usr/sbin/nginx -t
`
}

const MINIMAL_CONFIG = `config_version: 3
poll_interval: 5m
modules: {}
apps: {}
`

async function writeValidatedSudoers(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, content, { mode: 0o440 })
  const check = Bun.spawnSync(['visudo', '-cf', tmp])
  if (check.exitCode !== 0) {
    await Bun.$`rm -f ${tmp}`.quiet().nothrow()
    const stderr = check.stderr.toString().trim()
    throw new Error(stderr || `visudo rejected ${path}`)
  }
  await Bun.$`mv ${tmp} ${path}`.quiet()
  await Bun.$`chown root:root ${path}`.quiet()
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

const m0001_ensure_dirs: JibMigration = {
  id: '0001_ensure_dirs',
  description: 'Create $JIB_ROOT subdirectories',
  up: async (ctx) => {
    const p = ctx.paths
    const dirs = [
      p.root,
      p.stateDir,
      p.locksDir,
      p.secretsDir,
      p.overridesDir,
      p.reposDir,
      p.repoRoot,
      p.nginxDir,
      p.cloudflaredDir,
    ]
    for (const d of dirs) await mkdir(d, { recursive: true, mode: 0o750 })
  },
}

const m0002_ensure_config: JibMigration = {
  id: '0002_ensure_config',
  description: 'Write minimal config.yml if missing',
  up: async (ctx) => {
    if (!existsSync(ctx.paths.configFile)) {
      await writeFile(ctx.paths.configFile, MINIMAL_CONFIG, { mode: 0o640 })
    }
  },
}

const m0003_ensure_group: JibMigration = {
  id: '0003_ensure_group',
  description: 'Create jib group, set ownership, add invoking user',
  up: async (ctx) => {
    await Bun.$`groupadd --system ${GROUP} 2>/dev/null || true`.quiet()
    await Bun.$`chown -R root:${GROUP} ${ctx.paths.root}`.quiet().nothrow()
    // setgid (g+s) ensures new files inherit the jib group, including
    // temp files from atomic writes (writeConfig uses rename).
    await Bun.$`chmod -R g+rwXs ${ctx.paths.root}`.quiet().nothrow()
    await Bun.$`chmod 640 ${ctx.paths.configFile}`.quiet().nothrow()

    const sudoUser = process.env.SUDO_USER
    if (sudoUser) {
      await Bun.$`usermod -aG ${GROUP} ${sudoUser}`.quiet().nothrow()
    }
  },
}

const m0007_install_watcher: JibMigration = {
  id: '0007_install_watcher',
  description: 'Install watcher service',
  up: async (ctx) => {
    const mctx = await initCtx(ctx)
    const { install } = await import('@jib-module/watcher')
    await install(mctx)
  },
}

const m0008_install_nginx: JibMigration = {
  id: '0008_install_nginx',
  description: 'Install ingress reverse proxy',
  up: async (ctx) => {
    const mctx = await initCtx(ctx)
    const { install } = await import('@jib/ingress')
    await install(mctx)
  },
}

const m0009_install_sudoers: JibMigration = {
  id: '0009_install_sudoers',
  description: 'Write /etc/sudoers.d/jib drop-in',
  up: async () => {
    await writeValidatedSudoers(SUDOERS_PATH, buildSudoersContent())
  },
}

const m0010_expand_sudoers_for_nginx: JibMigration = {
  id: '0010_expand_sudoers_for_nginx',
  description: 'Allow jib group to validate and reload nginx without password',
  up: async () => {
    await writeValidatedSudoers(SUDOERS_PATH, buildSudoersContent())
  },
}

const m0011_repair_managed_secret_permissions: JibMigration = {
  id: '0011_repair_managed_secret_permissions',
  description: 'Repair jib-managed secret tree permissions',
  up: async (ctx) => {
    await repairManagedSecretsTree(ctx.paths)
  },
}

// ---------------------------------------------------------------------------
// Registry — ordered list of all migrations
// ---------------------------------------------------------------------------

export const migrations: JibMigration[] = [
  m0001_ensure_dirs,
  m0002_ensure_config,
  m0003_ensure_group,
  m0007_install_watcher,
  m0008_install_nginx,
  m0009_install_sudoers,
  m0010_expand_sudoers_for_nginx,
  m0011_repair_managed_secret_permissions,
]
