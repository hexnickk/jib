import { stat, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { App, Config } from '@jib/config'
import {
  type CheckHealthOptions,
  Compose,
  type DockerExec,
  type OverrideService,
  allHealthy,
  checkHealth,
  hasBuildServices,
  overridePath,
  parseComposeServices,
  writeOverride,
} from '@jib/docker'
import { JibError } from '@jib/errors'
import type { Logger } from '@jib/logging'
import { type Paths, repoPath } from '@jib/paths'
import { type AppState, type Store, acquire } from '@jib/state'
import { $ } from 'bun'

// Approved exception: 231 LoC — deploy ceremony is cohesive, splitting fragments understanding

/** Minimum free bytes required before a deploy proceeds (2 GiB, matches Go). */
const MIN_DISK_BYTES = 2 * 1024 * 1024 * 1024

export interface EngineDeps {
  config: Config
  paths: Paths
  store: Store
  log: Logger
  /** Injected for tests — defaults to real `Bun.$ df`. */
  diskFree?: (path: string) => Promise<number>
  /** Injected for tests — passed to `@jib/docker` Compose. */
  dockerExec?: DockerExec
  /** Injected for tests — health probe override. */
  healthOpts?: CheckHealthOptions
}

export interface ProgressCtx {
  emit: (step: string, message: string) => void
}

export interface DeployCmd {
  app: string
  workdir: string
  sha: string
  trigger: 'manual' | 'auto'
  user?: string
}

/**
 * Minimal return shape for `Engine.deploy`.
 */
export interface DeployResult {
  deployedSHA: string
  durationMs: number
}

/**
 * Deploy engine. Owns the deploy flow: lock, disk check, build, pre-deploy
 * hooks, compose up, health, state update. jib has no rollback — operators
 * fix-forward because data-changing migrations aren't reversible.
 */
export class Engine {
  constructor(readonly deps: EngineDeps) {}

  private newCompose(app: string, appCfg: App, workdir: string): Compose {
    const files =
      appCfg.compose && appCfg.compose.length > 0 ? appCfg.compose : ['docker-compose.yml']
    const override = overridePath(this.deps.paths.overridesDir, app)
    const cfg = {
      app,
      dir: workdir,
      files: [...files],
      override,
      ...(this.deps.dockerExec ? { exec: this.deps.dockerExec } : {}),
    }
    return new Compose(cfg)
  }

  /**
   * Keep the generated override file aligned with the current config before
   * any compose invocation. This prevents stale port publications from
   * lingering when an app drops ingress and later runs `up`/`restart`
   * without a full deploy first.
   */
  private async syncOverride(app: string, appCfg: App, workdir: string): Promise<void> {
    const parsed = parseComposeServices(workdir, appCfg.compose ?? [])
    const services = buildOverrideServices(parsed, appCfg.domains)
    await writeOverride(this.deps.paths.overridesDir, app, services)
  }

  /**
   * Link `<secretsDir>/<app>/<env_file>` → `<workdir>/<env_file>` so the
   * user's compose `env_file:` directive (relative to the compose file)
   * resolves against jib's managed secrets. Silently skips if no secrets
   * file exists — apps without secrets just run without injected env.
   * Replaces any existing file/symlink at the target path.
   */
  private async linkSecrets(app: string, appCfg: App, workdir: string): Promise<void> {
    const envName = appCfg.env_file ?? '.env'
    const src = join(this.deps.paths.secretsDir, app, envName)
    try {
      await stat(src)
    } catch {
      return // no secrets file, nothing to link
    }
    const dest = join(workdir, envName)
    await unlink(dest).catch(() => undefined)
    await symlink(src, dest)
  }

  /** Free bytes on the filesystem containing `path`. Uses `df -B1 --output=avail`. */
  private async diskFree(path: string): Promise<number> {
    if (this.deps.diskFree) return this.deps.diskFree(path)
    const res = await $`df -B1 --output=avail ${path}`.quiet().nothrow()
    if (res.exitCode !== 0) return Number.POSITIVE_INFINITY
    const line = res.stdout.toString().trim().split('\n')[1] ?? '0'
    return Number(line.trim())
  }

  async deploy(cmd: DeployCmd, progress: ProgressCtx): Promise<DeployResult> {
    const start = Date.now()
    const appCfg = this.deps.config.apps[cmd.app]
    if (!appCfg) throw new JibError('deploy', `app "${cmd.app}" not found in config`)

    progress.emit('lock', `acquiring lock for ${cmd.app}`)
    const release = await acquire(this.deps.paths.locksDir, cmd.app, { blocking: false })
    try {
      progress.emit('disk', 'checking disk space')
      const free = await this.diskFree(cmd.workdir)
      if (free < MIN_DISK_BYTES) {
        throw new JibError('deploy', `insufficient disk space: ${free} bytes free`)
      }

      const prevState = await this.deps.store.load(cmd.app)

      await this.syncOverride(cmd.app, appCfg, cmd.workdir)

      // Link the jib-managed secrets file into the workdir so the user's
      // compose `env_file: .env` (service-level) resolves against it.
      await this.linkSecrets(cmd.app, appCfg, cmd.workdir)

      const compose = this.newCompose(cmd.app, appCfg, cmd.workdir)
      const buildArgs = appCfg.build_args ?? {}

      if (hasBuildServices(cmd.workdir, appCfg.compose ?? [])) {
        progress.emit('build', `building ${cmd.app}`)
        await compose.build(buildArgs)
      }

      for (const hook of appCfg.pre_deploy ?? []) {
        progress.emit('pre_deploy', `running ${hook.service}`)
        await compose.run(hook.service, [])
      }

      progress.emit('up', 'starting containers')
      await compose.up({ services: appCfg.services ?? [], buildArgs })

      if (appCfg.health && appCfg.health.length > 0) {
        progress.emit('health', 'running health checks')
        const results = await checkHealth(appCfg.health, this.deps.healthOpts ?? {})
        if (!allHealthy(results)) {
          throw new JibError('deploy', `health check failed: ${JSON.stringify(results)}`)
        }
      }

      const next: AppState = {
        ...prevState,
        app: cmd.app,
        deployed_sha: cmd.sha,
        deployed_workdir: cmd.workdir,
        last_deploy: new Date().toISOString(),
        last_deploy_status: 'success',
        last_deploy_error: '',
      }
      await this.deps.store.save(cmd.app, next)

      return { deployedSHA: cmd.sha, durationMs: Date.now() - start }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.deps.log.error(`deploy ${cmd.app} failed: ${message}`)
      await this.deps.store.recordFailure(cmd.app, message)
      throw err
    } finally {
      await release()
    }
  }

  /**
   * Resolve the app's Compose handle without running any side effects.
   * Used by the lightweight lifecycle commands (`up`/`down`/`restart`) that
   * reuse the override + secrets + workdir resolution the engine already
   * owns, but skip the full deploy ceremony.
   */
  private async composeFor(appName: string): Promise<{ compose: Compose; appCfg: App }> {
    const appCfg = this.deps.config.apps[appName]
    if (!appCfg) throw new JibError('deploy', `app "${appName}" not found in config`)
    const workdir = repoPath(this.deps.paths, appName, appCfg.repo)
    await this.syncOverride(appName, appCfg, workdir)
    await this.linkSecrets(appName, appCfg, workdir)
    return { compose: this.newCompose(appName, appCfg, workdir), appCfg }
  }

  /** `jib up` equivalent — start containers without rebuilding. */
  async up(appName: string): Promise<void> {
    const { compose, appCfg } = await this.composeFor(appName)
    await compose.up({ services: appCfg.services ?? [], buildArgs: appCfg.build_args ?? {} })
  }

  /** `jib down` equivalent — stop containers. Optionally removes volumes. */
  async down(appName: string, removeVolumes = false): Promise<void> {
    const { compose } = await this.composeFor(appName)
    await compose.down(removeVolumes)
  }

  /** `jib restart` equivalent — restart containers in place. */
  async restart(appName: string): Promise<void> {
    const { compose } = await this.composeFor(appName)
    await compose.restart()
  }
}

/**
 * Group ingress mappings by target compose service and build the
 * `OverrideService[]` list the deploy engine passes to `writeOverride`. Only
 * services targeted by ingress receive a jib-managed `ports:` replacement;
 * internal-only services keep the user's compose file untouched.
 */
export function buildOverrideServices(
  parsed: { name: string }[],
  domains: App['domains'],
): OverrideService[] {
  const byService = new Map<string, { host: number; container: number }[]>()
  const single = parsed.length === 1 ? parsed[0]?.name : undefined
  for (const d of domains) {
    const target = d.service ?? single
    if (!target || d.port === undefined || d.container_port === undefined) continue
    const list = byService.get(target) ?? []
    list.push({ host: d.port, container: d.container_port })
    byService.set(target, list)
  }
  // Only emit overrides for services that own a domain. Services without a
  // jib-allocated port (helpers, pre-deploy hooks, workers) inherit their
  // restart/logging from the user's compose file. Applying `restart:
  // unless-stopped` to a one-shot migration service would trap it in a
  // restart loop, so we leave it alone.
  return parsed
    .filter((s) => byService.has(s.name))
    .map((s) => ({ name: s.name, ports: byService.get(s.name) ?? [] }))
}
