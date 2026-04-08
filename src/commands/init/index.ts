import { existsSync, readlinkSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { type Config, loadConfig, writeConfig } from '@jib/config'
import { type ModuleContext, createLogger, getPaths } from '@jib/core'
import { collectServices, openDb } from '@jib/state'
import { intro, log, outro } from '@jib/tui'
import { defineCommand } from 'citty'
import { parse } from 'yaml'
import { migrations, runJibMigrations } from '../../migrations/index.ts'
import type { MigrationContext } from '../../migrations/types.ts'
import { runInstallsTx } from './install.ts'
import {
  installedOptionalModules,
  promptOptionalModules,
  requiredModules,
  resolveModules,
  unseenOptionalModules,
} from './registry.ts'

function ensureRoot(): void {
  if (process.getuid?.() === 0) return
  // /proc/self/exe resolves to the real binary on disk (process.execPath
  // returns a virtual /$bunfs/ path in compiled binaries). argv.slice(2)
  // skips both the binary path and the Bun entry-point path.
  const bin = readlinkSync('/proc/self/exe')
  const result = Bun.spawnSync(['sudo', bin, ...process.argv.slice(2)], {
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  process.exit(result.exitCode)
}

async function loadRawConfig(configFile: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(configFile)) return null
  const raw = await readFile(configFile, 'utf8')
  return (parse(raw) as Record<string, unknown>) ?? {}
}

async function reinstallModules(names: string[], ctx: ModuleContext<Config>): Promise<void> {
  const mods = resolveModules(names)
  for (const m of mods) {
    if (!m.install) continue
    await m.install(ctx)
  }
}

async function restartServices(config: Config): Promise<number> {
  const hasTunnel = config.modules?.cloudflared === true
  const services = await collectServices(hasTunnel)
  let count = 0
  for (const s of services) {
    if (!s.active) continue
    await Bun.$`sudo systemctl restart ${s.name}`.quiet().nothrow()
    count++
  }
  return count
}

export default defineCommand({
  meta: { name: 'init', description: 'Bootstrap or update the server' },
  args: {},
  async run() {
    ensureRoot()
    const paths = getPaths()
    const configExisted = existsSync(paths.configFile)

    // Minimal bootstrap: stateDir must exist before we can open the DB
    await mkdir(paths.stateDir, { recursive: true, mode: 0o750 })
    // Also ensure root dir exists so DB perms work
    await mkdir(paths.root, { recursive: true, mode: 0o750 })

    const db = openDb(paths.stateDir)
    const rawConfig = await loadRawConfig(paths.configFile)
    const mctx: MigrationContext = { db, paths, rawConfig }

    intro('jib init')

    const applied = await runJibMigrations(mctx, migrations)

    // On update (config existed), re-template units + restart services
    if (applied.length > 0 && configExisted) {
      const config = await loadConfig(paths.configFile)
      const ctx: ModuleContext<Config> = { config, logger: createLogger('init'), paths }
      const installed = [
        ...requiredModules().map((m) => m.manifest.name),
        ...installedOptionalModules(config).map((m) => m.manifest.name),
      ]
      await reinstallModules(installed, ctx)
      const count = await restartServices(config)
      log.success(`${count} service(s) restarted`)
    }

    // Prompt for any optional modules the user hasn't been asked about
    const config = await loadConfig(paths.configFile)
    const unseen = unseenOptionalModules(config)
    if (unseen.length > 0) {
      const { selected, declined } = await promptOptionalModules(unseen)
      const ctx: ModuleContext<Config> = { config, logger: createLogger('init'), paths }

      if (selected.length > 0) {
        const toInstall = resolveModules(selected).filter((m) => m.install)
        if (toInstall.length > 0) await runInstallsTx(toInstall, ctx)
        for (const m of resolveModules(selected)) {
          if (m.setup) await m.setup(ctx)
        }
      }

      // Persist choices
      const updated = { ...config, modules: { ...config.modules } }
      for (const name of selected) updated.modules[name] = true
      for (const name of declined) updated.modules[name] = false
      await writeConfig(paths.configFile, updated)
    }

    if (applied.length > 0) {
      outro(configExisted ? 'jib updated' : 'jib initialized')
    } else if (unseen.length > 0) {
      outro('modules configured')
    } else {
      outro('nothing to do')
    }
  },
})
