import { type App, AppSchema, type Config, type Domain, writeConfig } from '@jib/config'
import { allocatePort } from '@jib/core'
import { isInteractive, promptString } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { loadAppConfig } from './_ctx.ts'
import { provisionApp, rollbackRepo } from './_provision.ts'

/**
 * `jib add <app>` — parse flags → allocate host ports → write config →
 * `cmd.repo.prepare` → `cmd.nginx.claim`. On any failure after writeConfig
 * the app entry is rolled back so the file never points at a half-baked app.
 *
 * Domain syntax: `host[:containerPort][@ingress]`. `containerPort` is the
 * port *inside* the container (default `80`). Jib always auto-allocates the
 * *host* port from the managed range — operators never think about host
 * ports. Compose-file inference for `containerPort` lands in Stage 5.
 */

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/
const DEFAULT_TIMEOUT_MS = 5 * 60_000
const DEFAULT_CONTAINER_PORT = 80

interface ParsedDomain {
  host: string
  container_port: number
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
  if (!host) throw new Error(`invalid --domain "${raw}" (expected host[:containerPort])`)
  let container_port = DEFAULT_CONTAINER_PORT
  if (portStr !== undefined && portStr !== '') {
    container_port = Number(portStr)
    if (!Number.isInteger(container_port) || container_port < 1 || container_port > 65535) {
      throw new Error(`invalid containerPort in --domain "${raw}"`)
    }
  }
  const out: ParsedDomain = { host, container_port }
  if (ingress && ingress !== 'direct') {
    out.ingress = ingress as Exclude<ParsedDomain['ingress'], undefined>
  }
  return out
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

/**
 * Assigns a host port to every domain that lacks one. Each allocation
 * re-reads the partially-filled config so two fresh domains in the same
 * `add` never collide.
 */
export async function assignPorts(cfg: Config, app: string, domains: Domain[]): Promise<Domain[]> {
  const out: Domain[] = []
  // Scratch config tracks ports already assigned in this call so the
  // allocator can see them.
  const base = (cfg.apps[app] ?? { domains: [] as Domain[] }) as App
  const scratch: Config = {
    ...cfg,
    apps: { ...cfg.apps, [app]: { ...base, domains: [] as Domain[] } },
  }
  for (const d of domains) {
    const assigned =
      d.port !== undefined
        ? d
        : { ...d, port: await allocatePort({ config: scratch, probeHost: true }) }
    out.push(assigned)
    const cur = scratch.apps[app] as App
    scratch.apps[app] = { ...cur, domains: [...out] }
  }
  return out
}

export default defineCommand({
  meta: { name: 'add', description: 'Register a new app (config + repo + nginx claim)' },
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
    domain: {
      type: 'string',
      description: 'host[:containerPort][@ingress] (repeatable via comma)',
    },
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
      consola.error('at least one --domain host is required')
      process.exit(1)
    }

    let parsedDomains: ParsedDomain[]
    let healthChecks: { path: string; port: number }[]
    try {
      parsedDomains = domainRaw.map((d) => parseDomain(d, ingressDefault))
      healthChecks = healthRaw.map(parseHealth)
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    const domainsWithPorts = await assignPorts(cfg, args.app, parsedDomains as Domain[])

    const appObj: Partial<App> & { repo: string; domains: Domain[] } = {
      repo,
      branch: 'main',
      domains: domainsWithPorts,
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
      await provisionApp(args.app, newApp, DEFAULT_TIMEOUT_MS)
    } catch (err) {
      // Order matters: `cmd.repo.remove` reads the config to find the
      // workdir, so it must fire *before* we drop the app entry.
      await rollbackRepo(args.app, DEFAULT_TIMEOUT_MS)
      const rollbackApps = { ...nextCfg.apps }
      delete rollbackApps[args.app]
      await writeConfig(paths.configFile, { ...nextCfg, apps: rollbackApps })
      consola.error(err instanceof Error ? err.message : String(err))
      consola.warn(`rolled back ${args.app} from ${paths.configFile}`)
      process.exit(1)
    }

    const routes = newApp.domains.map((d) => `${d.host} → 127.0.0.1:${d.port}`).join('\n    ')
    consola.box(
      `app "${args.app}" ready\n  routes:\n    ${routes}\n  next:   jib deploy ${args.app}`,
    )
  },
})
