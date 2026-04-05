import { type App, AppSchema, type Config, writeConfig } from '@jib/config'
import { type ModuleContext, createLogger } from '@jib/core'
import { SUBJECTS, emitAndWait } from '@jib/rpc'
import { isInteractive, promptString, spinner } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { withBus } from '../bus-client.ts'
import { runSetupHooks } from '../setup-hooks.ts'
import { loadAppConfig } from './_ctx.ts'

/**
 * `jib add <app>` — register and (unless `--config-only`) provision an app.
 *
 * Flow: validate → write config → gitsitter prepares repo → run setup hooks
 * (nginx, cloudflare, ...). The heavy port/domain inference that lived in
 * Go's 931-line setup.go is deliberately trimmed: users pass `--domain
 * host:port` directly. Automatic compose-label discovery can land later as
 * a separate helper without bloating this file.
 */

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/
const DEFAULT_TIMEOUT_MS = 5 * 60_000

interface ParsedDomain {
  host: string
  port: number
  ingress?: '' | 'direct' | 'cloudflare-tunnel'
}

function parseDomain(raw: string, fallback: string): ParsedDomain {
  let ingress = fallback
  const at = raw.lastIndexOf('@')
  let rest = raw
  if (at > 0) {
    ingress = raw.slice(at + 1)
    rest = raw.slice(0, at)
  }
  const [host, portStr] = rest.split(':')
  if (!host || !portStr) throw new Error(`invalid --domain "${raw}" (expected host:port)`)
  const port = Number(portStr)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`invalid port in --domain "${raw}"`)
  const normalized: ParsedDomain = { host, port }
  if (ingress && ingress !== 'direct') {
    normalized.ingress = ingress as Exclude<ParsedDomain['ingress'], undefined>
  }
  return normalized
}

function parseHealth(raw: string): { path: string; port: number } {
  const idx = raw.lastIndexOf(':')
  if (idx < 1) throw new Error(`invalid --health "${raw}" (expected /path:port)`)
  const path = raw.slice(0, idx)
  const port = Number(raw.slice(idx + 1))
  if (!path.startsWith('/')) throw new Error(`--health path must start with '/'`)
  if (!Number.isInteger(port)) throw new Error(`invalid port in --health "${raw}"`)
  return { path, port }
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

export default defineCommand({
  meta: { name: 'add', description: 'Register a new app (config + repo + setup hooks)' },
  args: {
    app: { type: 'positional', required: true },
    repo: { type: 'string', description: 'Git repo (org/name) or "local"' },
    'git-provider': { type: 'string', description: 'Git provider name' },
    ingress: {
      type: 'string',
      default: 'direct',
      description: 'Default ingress: direct|cloudflare-tunnel',
    },
    compose: { type: 'string', description: 'Compose file (comma-separated)' },
    domain: { type: 'string', description: 'host:port[@ingress] (repeatable via comma)' },
    health: { type: 'string', description: '/path:port (repeatable via comma)' },
    'config-only': { type: 'boolean', description: 'Write config without provisioning' },
  },
  async run({ args }) {
    if (!APP_NAME_RE.test(args.app)) {
      consola.error(`app name "${args.app}" must match ${APP_NAME_RE}`)
      process.exit(1)
    }

    const { cfg, paths } = await loadAppConfig()
    if (cfg.apps[args.app]) {
      consola.error(`app "${args.app}" already exists in config`)
      process.exit(1)
    }

    let repo = args.repo
    if (!repo) {
      if (!isInteractive()) {
        consola.error('--repo required in non-interactive mode')
        process.exit(1)
      }
      repo = await promptString({ message: 'GitHub repo (org/name, or "local")' })
    }

    const ingressDefault = args.ingress ?? 'direct'
    const domainRaw = toArray(args.domain).flatMap((d) => d.split(','))
    const healthRaw = toArray(args.health).flatMap((h) => h.split(','))
    const composeRaw = args.compose ? args.compose.split(',') : undefined

    if (domainRaw.length === 0) {
      consola.error('at least one --domain host:port is required')
      process.exit(1)
    }

    let domains: ParsedDomain[]
    let healthChecks: { path: string; port: number }[]
    try {
      domains = domainRaw.map((d) => parseDomain(d, ingressDefault))
      healthChecks = healthRaw.map(parseHealth)
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    const appObj: Partial<App> & { repo: string; domains: ParsedDomain[] } = {
      repo,
      branch: 'main',
      domains,
      env_file: '.env',
    }
    if (args['git-provider']) appObj.provider = args['git-provider']
    if (composeRaw) appObj.compose = composeRaw
    if (healthChecks.length > 0) appObj.health = healthChecks

    const parsed = AppSchema.safeParse(appObj)
    if (!parsed.success) {
      consola.error(`invalid app config: ${parsed.error.message}`)
      process.exit(1)
    }
    const newApp: App = parsed.data

    const nextCfg: Config = { ...cfg, apps: { ...cfg.apps, [args.app]: newApp } }
    await writeConfig(paths.configFile, nextCfg)
    consola.success(`added ${args.app} to ${paths.configFile}`)

    if (args['config-only']) return

    try {
      await withBus(async (bus) => {
        const s = spinner()
        s.start(`preparing ${args.app}`)
        await emitAndWait(
          bus,
          SUBJECTS.cmd.repoPrepare,
          { app: args.app },
          { success: SUBJECTS.evt.repoReady, failure: SUBJECTS.evt.repoFailed },
          SUBJECTS.evt.repoProgress,
          {
            source: 'cli',
            timeoutMs: DEFAULT_TIMEOUT_MS,
            onProgress: (p) => s.message(p.message),
          },
        )
        s.stop('repo ready')
      })

      const ctx: ModuleContext<Config> = {
        config: nextCfg,
        logger: createLogger('add'),
        paths,
      }
      await runSetupHooks(ctx, args.app, 'add')
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    consola.box(
      `app "${args.app}" ready\n  domains: ${newApp.domains.map((d) => d.host).join(', ')}\n  next:   jib deploy ${args.app}`,
    )
  },
})
