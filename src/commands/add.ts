import { type App, AppSchema, type Config, type Domain, writeConfig } from '@jib/config'
import { isInteractive, promptString } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { type ParsedDomain, assignPorts, parseDomain, parseHealth, toArray } from './_add_parse.ts'
import { resolveFromCompose } from './_compose_resolve.ts'
import { loadAppConfig } from './_ctx.ts'
import { claimNginxRoutes, prepareAppRepo, rollbackRepo } from './_provision.ts'

/**
 * `jib add <app>` — parse flags → allocate host ports → write config →
 * `cmd.repo.prepare` → infer container ports from compose → rewrite config
 * → `cmd.nginx.claim`. On any failure after writeConfig the app entry is
 * rolled back so the file never points at a half-baked app.
 *
 * Domain syntax: `host[:containerPort][@ingress][=service]`.
 *   - `containerPort` is the port *inside* the container. If omitted, jib
 *     infers it from the target service's `ports:`/`expose:` after the
 *     repo is cloned; ultimate fallback is 80 with a warning.
 *   - `=service` names the compose service this domain routes to. Only
 *     required for multi-service compose files; single-service apps have
 *     it auto-filled.
 * Jib always auto-allocates the *host* port from the managed range —
 * operators never think about host ports.
 */

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/
const DEFAULT_TIMEOUT_MS = 5 * 60_000

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
      description: 'host[:containerPort][@ingress][=service] (repeatable via comma)',
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

    let finalApp = newApp
    try {
      const { workdir } = await prepareAppRepo(args.app, DEFAULT_TIMEOUT_MS)
      finalApp = resolveFromCompose(newApp, workdir)
      const nextCfg2: Config = { ...cfg, apps: { ...cfg.apps, [args.app]: finalApp } }
      await writeConfig(paths.configFile, nextCfg2)
      await claimNginxRoutes(args.app, finalApp, DEFAULT_TIMEOUT_MS)
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

    const routes = finalApp.domains.map((d) => `${d.host} → 127.0.0.1:${d.port}`).join('\n    ')
    consola.box(
      `app "${args.app}" ready\n  routes:\n    ${routes}\n  next:   jib deploy ${args.app}`,
    )
  },
})
