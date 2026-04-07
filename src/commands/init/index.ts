import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { type Config, loadConfig } from '@jib/config'
import { type Paths, getPaths } from '@jib/core'
import { intro, log, outro, promptConfirm } from '@jib/tui'
import { defineCommand } from 'citty'
import { runHealthChecks } from './check.ts'
import { addUserToGroup, ensureGroup, needsRoot } from './group.ts'
import { runWizard } from './wizard.ts'

/**
 * `jib init` — bootstrap or health-check a server.
 *
 * First run (no config / group missing): creates dirs, config, group,
 * sudoers drop-in, then runs the interactive wizard.
 *
 * Re-run: automated health checks. Only prompts if something is broken.
 */

const MINIMAL_CONFIG = `config_version: 3
poll_interval: 5m
apps: {}
`

async function ensureDirs(p: Paths): Promise<void> {
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
  for (const d of dirs) {
    await mkdir(d, { recursive: true, mode: 0o750 })
  }
}

async function ensureConfig(p: Paths): Promise<Config> {
  if (!existsSync(p.configFile)) {
    await writeFile(p.configFile, MINIMAL_CONFIG, { mode: 0o640 })
  }
  return loadConfig(p.configFile)
}

async function runRecheck(paths: Paths, config: Config): Promise<void> {
  const results = await runHealthChecks(paths, config)
  const broken = results.filter((r) => !r.ok)
  let fixed = 0

  for (const r of results) {
    if (r.ok) {
      log.success(r.label)
    } else {
      log.warning(`${r.label}: ${r.detail ?? 'unhealthy'}`)
    }
  }

  for (const r of broken) {
    if (r.fixable && r.fix) {
      const shouldFix = await promptConfirm({
        message: `${r.label} is not running. Restart it?`,
        initialValue: true,
      })
      if (shouldFix) {
        await r.fix()
        log.success(`${r.label} restarted`)
        fixed++
      }
    }
  }

  if (broken.length === 0) {
    outro('all checks passed')
  } else if (fixed > 0) {
    outro(`all checks passed (${fixed} fixed)`)
  }
}

export default defineCommand({
  meta: { name: 'init', description: 'Bootstrap or health-check the server' },
  args: {},
  async run() {
    const paths = getPaths()
    const firstRun = !existsSync(paths.configFile) || needsRoot(paths)

    if (firstRun) {
      if (process.getuid?.() !== 0) {
        log.error('first run: jib init must run as root (try: sudo jib init)')
        process.exit(1)
      }
      intro('jib init')
      await ensureDirs(paths)
      const config = await ensureConfig(paths)
      await ensureGroup(paths)
      const sudoUser = process.env.SUDO_USER
      if (sudoUser) await addUserToGroup(sudoUser)
      await runWizard(paths, config)
    } else {
      intro('jib init — health check')
      const config = await loadConfig(paths.configFile)
      await runRecheck(paths, config)
    }
  },
})
