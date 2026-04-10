import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { jibMigrations } from '@jib/state'
import { type JibMigration, type MigrationContext, moduleCtx } from './types.ts'

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
const SUDOERS_CONTENT = `# jib: allow jib group to manage jib-* systemd services without password
%jib ALL=(root) NOPASSWD: /usr/bin/systemctl start jib-*, \\
  /usr/bin/systemctl stop jib-*, \\
  /usr/bin/systemctl restart jib-*, \\
  /usr/bin/systemctl enable jib-*, \\
  /usr/bin/systemctl disable jib-*, \\
  /usr/bin/systemctl daemon-reload
`

const MINIMAL_CONFIG = `config_version: 3
poll_interval: 5m
modules: {}
apps: {}
`

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
      p.busDir,
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

const m0005_install_nats: JibMigration = {
  id: '0005_install_nats',
  description: 'Install NATS message bus',
  up: async (ctx) => {
    const mctx = await moduleCtx(ctx)
    const { install } = await import('@jib-module/nats')
    await install(mctx)
  },
}

const m0006_install_deployer: JibMigration = {
  id: '0006_install_deployer',
  description: 'Install deployer service',
  up: async (ctx) => {
    const mctx = await moduleCtx(ctx)
    const { install } = await import('@jib-module/deployer')
    await install(mctx)
  },
}

const m0007_install_gitsitter: JibMigration = {
  id: '0007_install_gitsitter',
  description: 'Install gitsitter service',
  up: async (ctx) => {
    const mctx = await moduleCtx(ctx)
    const { install } = await import('@jib-module/gitsitter')
    await install(mctx)
  },
}

const m0008_install_nginx: JibMigration = {
  id: '0008_install_nginx',
  description: 'Install nginx reverse proxy',
  up: async (ctx) => {
    const mctx = await moduleCtx(ctx)
    const { install } = await import('@jib-module/nginx')
    await install(mctx)
  },
}

const m0009_install_sudoers: JibMigration = {
  id: '0009_install_sudoers',
  description: 'Write /etc/sudoers.d/jib drop-in',
  up: async () => {
    const tmp = `${SUDOERS_PATH}.tmp-${process.pid}`
    await writeFile(tmp, SUDOERS_CONTENT, { mode: 0o440 })
    const check = Bun.spawnSync(['visudo', '-cf', tmp])
    if (check.exitCode !== 0) {
      await Bun.$`rm -f ${tmp}`.quiet().nothrow()
      return
    }
    await Bun.$`mv ${tmp} ${SUDOERS_PATH}`.quiet()
    await Bun.$`chown root:root ${SUDOERS_PATH}`.quiet()
  },
}

// ---------------------------------------------------------------------------
// Registry — ordered list of all migrations
// ---------------------------------------------------------------------------

export const migrations: JibMigration[] = [
  m0001_ensure_dirs,
  m0002_ensure_config,
  m0003_ensure_group,
  m0005_install_nats,
  m0006_install_deployer,
  m0007_install_gitsitter,
  m0008_install_nginx,
  m0009_install_sudoers,
]
