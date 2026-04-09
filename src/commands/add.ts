import {
  type App,
  AppSchema,
  type Config,
  type Domain,
  type HealthCheck,
  type ParsedDomain,
  assignPorts,
  loadAppConfig,
  parseDomain,
  parseHealth,
  toArray,
  validateRepo,
  writeConfig,
} from '@jib/config'
import { CliError, ValidationError, isTextOutput } from '@jib/core'
import { resolveFromCompose } from '@jib/docker'
import { claimNginxRoutes, prepareAppRepo, rollbackRepo } from '@jib/rpc'
import { SecretsManager } from '@jib/secrets'
import { isInteractive, promptString } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { applyCliArgs, missingInput, withCliArgs } from './_cli.ts'

/**
 * `jib add <app>` — parse flags → allocate host ports → write config →
 * `cmd.repo.prepare` → infer container ports from compose → rewrite config
 * → `cmd.nginx.claim`. On any failure after writeConfig the app entry is
 * rolled back so the file never points at a half-baked app.
 *
 * Domain syntax (key-value, repeatable):
 *   `--domain host=<domain>[,port=<n>][,service=<name>][,ingress=direct|cloudflare-tunnel]`
 * Only `host` is required. `port` is the container port (inferred from
 * compose if omitted). `service` is only needed for multi-service compose
 * files. Host ports are always auto-allocated from the managed range.
 */

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/
const DEFAULT_TIMEOUT_MS = 5 * 60_000

export default defineCommand({
  meta: { name: 'add', description: 'Register a new app (config + repo + nginx claim)' },
  args: withCliArgs({
    app: { type: 'positional', required: true },
    repo: {
      type: 'string',
      description: 'Git repo: "owner/name", "local", file:// URL, http(s):// URL, or absolute path',
    },
    'git-provider': { type: 'string', description: 'Git provider name' },
    ingress: {
      type: 'string',
      default: 'direct',
      description: 'Default ingress: direct|cloudflare-tunnel',
    },
    compose: { type: 'string', description: 'Compose file (comma-separated)' },
    domain: {
      type: 'string',
      description:
        'host=<domain>[,port=<port>][,service=<name>][,ingress=direct|cloudflare-tunnel] (repeatable)',
    },
    env: { type: 'string', description: 'KEY=VALUE secret (repeatable)' },
    health: { type: 'string', description: '/path:port (repeatable via comma)' },
  }),
  async run({ args }) {
    applyCliArgs(args)

    if (!APP_NAME_RE.test(args.app)) {
      throw new ValidationError(`app name "${args.app}" must match ${APP_NAME_RE}`)
    }

    const { cfg, paths } = await loadAppConfig()
    if (cfg.apps[args.app]) {
      throw new ValidationError(`app "${args.app}" already exists in config`)
    }

    let repo = args.repo
    if (!repo) {
      if (!isInteractive()) {
        missingInput('missing required input for jib add', [
          { field: 'repo', message: 'provide --repo or rerun with interactive prompts enabled' },
        ])
      }
      repo = await promptString({
        message: 'Git repo (owner/name, "local", URL, or absolute path)',
      })
    }

    const repoErr = validateRepo(repo)
    if (repoErr) {
      throw new ValidationError(`--repo "${repo}" ${repoErr}`)
    }

    const ingressDefault = args.ingress ?? 'direct'
    const domainRaw = toArray(args.domain)
    const envRaw = toArray(args.env)
    const healthRaw = toArray(args.health).flatMap((h) => h.split(','))
    const composeRaw = args.compose ? args.compose.split(',') : undefined

    if (domainRaw.length === 0)
      missingInput('missing required input for jib add', [
        { field: 'domain', message: 'provide at least one --domain host=...' },
      ])

    for (const pair of envRaw) {
      if (pair.indexOf('=') < 1) {
        throw new ValidationError(`invalid --env "${pair}" - expected KEY=VALUE`)
      }
    }

    const parsedDomains: ParsedDomain[] = domainRaw.map((d) => parseDomain(d, ingressDefault))
    const healthChecks: HealthCheck[] = healthRaw.map(parseHealth)

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
      throw new ValidationError(`invalid app config: ${parsed.error.message}`)
    }
    const newApp: App = parsed.data

    const nextCfg: Config = { ...cfg, apps: { ...cfg.apps, [args.app]: newApp } }
    await writeConfig(paths.configFile, nextCfg)
    if (isTextOutput()) {
      consola.success(`added ${args.app} to ${paths.configFile}`)
    }

    if (envRaw.length > 0) {
      const mgr = new SecretsManager(paths.secretsDir)
      for (const pair of envRaw) {
        const eq = pair.indexOf('=')
        await mgr.upsert(args.app, pair.slice(0, eq), pair.slice(eq + 1), newApp.env_file)
      }
      if (isTextOutput()) {
        consola.success(`${envRaw.length} secret(s) set for ${args.app}`)
      }
    }

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
      throw new CliError('add_failed', err instanceof Error ? err.message : String(err), {
        hint: `rolled back ${args.app} from ${paths.configFile}; safe to retry: jib add ...`,
      })
    }

    if (isTextOutput()) {
      const routes = finalApp.domains.map((d) => `${d.host} -> 127.0.0.1:${d.port}`).join('\n    ')
      consola.box(
        `app "${args.app}" ready\n  routes:\n    ${routes}\n  next:   jib deploy ${args.app}`,
      )
    }

    return {
      app: args.app,
      repo,
      routes: finalApp.domains.map((d) => ({
        host: d.host,
        port: d.port ?? null,
        containerPort: d.container_port ?? null,
        service: d.service ?? null,
        ingress: d.ingress ?? 'direct',
      })),
      secretsWritten: envRaw.length,
    }
  },
})
