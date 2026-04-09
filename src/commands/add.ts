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
import { CliError, ValidationError, isDebugEnabled, isTextOutput } from '@jib/core'
import {
  type ComposeInspection,
  ComposeInspectionError,
  type ComposeService,
  inspectComposeApp,
  resolveFromCompose,
} from '@jib/docker'
import { claimNginxRoutes, prepareAppRepo, rollbackRepo } from '@jib/rpc'
import { SecretsManager } from '@jib/secrets'
import {
  isInteractive,
  promptConfirm,
  promptPassword,
  promptSelect,
  promptString,
  promptStringOptional,
} from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { applyCliArgs, missingInput, withCliArgs } from './_cli.ts'
import {
  assignCliDomainsToServices,
  mergeGuidedServiceAnswers,
  renderAddPlanSummary,
  shouldDefaultExposeService,
  splitCommaValues,
  summarizeComposeServices,
} from './add-guided.ts'

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/
const DEFAULT_TIMEOUT_MS = 5 * 60_000

interface EnvEntry {
  key: string
  value: string
}

interface AddInputs {
  repo: string
  ingressDefault: string
  composeRaw?: string[]
  parsedDomains: ParsedDomain[]
  envEntries: EnvEntry[]
  healthChecks: HealthCheck[]
}

/**
 * `jib add <app>` — gather repo / compose hints → prepare repo →
 * inspect compose → ask only missing questions → write config + secrets →
 * optionally claim nginx routes. Repo prep now accepts inline repo metadata,
 * so the config is only written once the app shape is fully resolved; any
 * later failure rolls back the checkout, secrets, and final config entry.
 */
export default defineCommand({
  meta: { name: 'add', description: 'Register a new app (config + repo + optional ingress)' },
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

    const inputs = await gatherAddInputs(args)
    let preparedRepo = false
    let configWritten = false
    let finalEnvFile = '.env'
    const writtenSecretKeys: string[] = []
    try {
      const { workdir } = await prepareAppRepo(args.app, DEFAULT_TIMEOUT_MS, {
        repo: inputs.repo,
        branch: 'main',
        ...(args['git-provider'] ? { provider: args['git-provider'] } : {}),
      })
      preparedRepo = true

      const inspection = await inspectComposeWithPrompts(buildDraftApp(args, inputs), workdir)
      const guided = await collectGuidedInputs(inputs, inspection.services)
      const finalApp = await buildResolvedApp(
        cfg,
        args.app,
        workdir,
        args,
        inputs,
        inspection,
        guided,
      )

      await confirmAddPlan(args.app, inspection, finalApp, guided.secretKeys)

      const finalCfg: Config = { ...cfg, apps: { ...cfg.apps, [args.app]: finalApp } }
      await writeConfig(paths.configFile, finalCfg)
      configWritten = true
      finalEnvFile = finalApp.env_file

      if (guided.envEntries.length > 0) {
        const mgr = new SecretsManager(paths.secretsDir)
        for (const entry of guided.envEntries) {
          await mgr.upsert(args.app, entry.key, entry.value, finalApp.env_file)
          writtenSecretKeys.push(entry.key)
        }
        if (isTextOutput()) {
          consola.success(`${guided.envEntries.length} secret(s) set for ${args.app}`)
        }
      }

      await claimNginxRoutes(args.app, finalApp, DEFAULT_TIMEOUT_MS)

      if (isTextOutput()) {
        const ingress =
          finalApp.domains.length > 0
            ? finalApp.domains.map((d) => `${d.host} -> 127.0.0.1:${d.port}`).join('\n    ')
            : 'none'
        consola.box(
          `app "${args.app}" ready\n  ingress:\n    ${ingress}\n  next:   jib deploy ${args.app}`,
        )
      }

      return {
        app: args.app,
        repo: inputs.repo,
        composeFiles: finalApp.compose ?? [],
        services: finalApp.services ?? [],
        routes: finalApp.domains.map((d) => ({
          host: d.host,
          port: d.port ?? null,
          containerPort: d.container_port ?? null,
          service: d.service ?? null,
          ingress: d.ingress ?? 'direct',
        })),
        secretsWritten: guided.envEntries.length,
      }
    } catch (err) {
      await cleanupFailedAdd(
        args.app,
        cfg,
        paths.configFile,
        preparedRepo,
        configWritten,
        paths.secretsDir,
        finalEnvFile,
        writtenSecretKeys,
        inputs.repo,
      )
      throw normalizeAddError(err, args.app, paths.configFile)
    }
  },
})

async function gatherAddInputs(args: {
  repo?: string
  ingress?: string
  compose?: string
  domain?: string | string[]
  env?: string | string[]
  health?: string | string[]
}): Promise<AddInputs> {
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
  const composeRaw = args.compose ? splitCommaValues(args.compose) : undefined
  let parsedDomains: ParsedDomain[]
  try {
    parsedDomains = toArray(args.domain).map((domain) => parseDomain(domain, ingressDefault))
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : String(error))
  }
  let healthChecks: HealthCheck[]
  try {
    healthChecks = toArray(args.health)
      .flatMap((h) => h.split(','))
      .map(parseHealth)
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : String(error))
  }
  const envEntries = parseEnvEntries(toArray(args.env))

  return {
    repo,
    ingressDefault,
    ...(composeRaw ? { composeRaw } : {}),
    parsedDomains,
    envEntries,
    healthChecks,
  }
}

function buildDraftApp(args: { 'git-provider'?: string }, inputs: AddInputs): App {
  const draft = {
    repo: inputs.repo,
    branch: 'main',
    domains: [] as Domain[],
    env_file: '.env',
    ...(args['git-provider'] ? { provider: args['git-provider'] } : {}),
    ...(inputs.composeRaw ? { compose: inputs.composeRaw } : {}),
    ...(inputs.healthChecks.length > 0 ? { health: inputs.healthChecks } : {}),
  }
  return parseApp(draft)
}

async function inspectComposeWithPrompts(
  draftApp: App,
  workdir: string,
): Promise<ComposeInspection> {
  let compose = draftApp.compose

  for (;;) {
    try {
      const inspection = inspectComposeApp({ compose }, workdir)
      if (isDebugEnabled()) {
        consola.info(`compose files: ${inspection.composeFiles.join(', ')}`)
        consola.info(`services: ${inspection.services.map((service) => service.name).join(', ')}`)
      }
      return inspection
    } catch (error) {
      if (
        error instanceof ComposeInspectionError &&
        error.code === 'compose_not_found' &&
        isInteractive()
      ) {
        const answer = await promptString({
          message: 'Compose file(s) relative to the repo (comma-separated)',
          placeholder: 'docker-compose.yml',
          ...(compose ? { initialValue: compose.join(',') } : {}),
        })
        compose = splitCommaValues(answer)
        continue
      }

      if (error instanceof ComposeInspectionError && error.code === 'compose_not_found') {
        if (!compose || compose.length === 0) {
          missingInput('missing required input for jib add', [
            {
              field: 'compose',
              message:
                'provide --compose <file> (or comma-separated files) so jib can inspect services',
            },
          ])
        }
        throw new CliError('compose_inspection_failed', error.message, {
          hint: 'fix --compose and retry, or rerun with interactive prompts enabled',
        })
      }

      throw error
    }
  }
}

async function collectGuidedInputs(
  inputs: AddInputs,
  composeServices: ComposeService[],
): Promise<{ domains: ParsedDomain[]; envEntries: EnvEntry[]; secretKeys: string[] }> {
  const serviceNames = composeServices.map((service) => service.name)
  let domains = inputs.parsedDomains
  if (composeServices.length > 0) {
    if (isInteractive() && serviceNames.length > 1) {
      domains = await promptForUnassignedDomains(domains, serviceNames)
    } else {
      const assigned = assignCliDomainsToServices(domains, serviceNames)
      if (assigned.issues.length > 0) {
        missingInput('missing required input for jib add', assigned.issues)
      }
      domains = assigned.domains
    }
  }

  const secretValues = new Map(inputs.envEntries.map((entry) => [entry.key, entry.value]))
  const serviceSummaries = summarizeComposeServices(composeServices)
  const answers = []

  for (const service of serviceSummaries) {
    const existingDomains = domains.filter((domain) => domain.service === service.name)
    let expose = existingDomains.length > 0
    let domainHosts: string[] = []

    if (isInteractive() && existingDomains.length === 0) {
      expose = await promptConfirm({
        message: `Expose service "${service.name}" with a domain?`,
        initialValue: shouldDefaultExposeService(service, serviceSummaries.length),
      })
      if (expose) {
        domainHosts = await promptDomainHosts(service.name)
      }
    }

    let secretKeys: string[] = []
    if (isInteractive()) {
      const rawSecrets = await promptStringOptional({
        message: `Secrets to collect now for "${service.name}" (comma-separated keys, blank to skip)`,
      })
      secretKeys = splitCommaValues(rawSecrets).filter((key) => !secretValues.has(key))
    }

    answers.push({
      service: service.name,
      expose,
      domainHosts,
      secretKeys,
    })
  }

  const merged = mergeGuidedServiceAnswers(domains, serviceNames, answers, inputs.ingressDefault)

  for (const key of merged.secretKeys) {
    if (secretValues.has(key)) continue
    const value = await promptPassword({ message: `Value for ${key}` })
    secretValues.set(key, value)
  }

  return {
    domains: merged.domains,
    envEntries: [...secretValues.entries()].map(([key, value]) => ({ key, value })),
    secretKeys: [...secretValues.keys()],
  }
}

async function promptForUnassignedDomains(
  domains: ParsedDomain[],
  serviceNames: string[],
): Promise<ParsedDomain[]> {
  const nextDomains: ParsedDomain[] = []
  for (const domain of domains) {
    if (domain.service) {
      nextDomains.push(domain)
      continue
    }
    const service = await promptSelect({
      message: `Which service should handle ${domain.host}?`,
      options: serviceNames.map((name) => ({ value: name, label: name })),
    })
    nextDomains.push({ ...domain, service })
  }
  return nextDomains
}

async function promptDomainHosts(serviceName: string): Promise<string[]> {
  for (;;) {
    const rawHosts = await promptString({
      message: `Domain(s) for service "${serviceName}" (comma-separated)`,
      placeholder: 'app.example.com',
    })
    const hosts = splitCommaValues(rawHosts)
    if (hosts.length > 0) return hosts
  }
}

async function buildResolvedApp(
  cfg: Config,
  appName: string,
  workdir: string,
  args: { 'git-provider'?: string },
  inputs: AddInputs,
  inspection: ComposeInspection,
  guided: { domains: ParsedDomain[] },
): Promise<App> {
  const domainsWithPorts = await assignPorts(cfg, appName, guided.domains as Domain[])
  const app = parseApp({
    repo: inputs.repo,
    branch: 'main',
    domains: domainsWithPorts,
    env_file: '.env',
    services: inspection.services.map((service) => service.name),
    compose: inspection.composeFiles,
    ...(args['git-provider'] ? { provider: args['git-provider'] } : {}),
    ...(inputs.healthChecks.length > 0 ? { health: inputs.healthChecks } : {}),
  })

  return resolveFromCompose(app, workdir)
}

function parseApp(appObj: Partial<App> & { repo: string; domains: Domain[] }): App {
  const parsed = AppSchema.safeParse(appObj)
  if (!parsed.success) {
    throw new ValidationError(`invalid app config: ${parsed.error.message}`)
  }
  return parsed.data
}

async function confirmAddPlan(
  appName: string,
  inspection: ComposeInspection,
  finalApp: App,
  secretKeys: string[],
): Promise<void> {
  if (!isTextOutput()) return

  const summary = renderAddPlanSummary({
    app: appName,
    composeFiles: inspection.composeFiles,
    services: summarizeComposeServices(inspection.services),
    domains: finalApp.domains,
    secretKeys,
    envFile: finalApp.env_file,
  })
  consola.box(summary)

  if (!isInteractive()) return
  const confirmed = await promptConfirm({
    message: `Write config for "${appName}"?`,
    initialValue: true,
  })
  if (!confirmed) {
    throw new CliError('cancelled', 'add cancelled')
  }
}

function parseEnvEntries(rawEntries: string[]): EnvEntry[] {
  const entries: EnvEntry[] = []
  for (const pair of rawEntries) {
    const eq = pair.indexOf('=')
    if (eq < 1) {
      throw new ValidationError(`invalid --env "${pair}" - expected KEY=VALUE`)
    }
    entries.push({ key: pair.slice(0, eq), value: pair.slice(eq + 1) })
  }
  return entries
}

async function cleanupFailedAdd(
  appName: string,
  cfg: Config,
  configFile: string,
  preparedRepo: boolean,
  configWritten: boolean,
  secretsDir?: string,
  envFile = '.env',
  writtenSecrets: string[] = [],
  repo?: string,
): Promise<void> {
  if (preparedRepo) {
    await rollbackRepo(appName, DEFAULT_TIMEOUT_MS, repo)
  }
  for (const key of writtenSecrets) {
    try {
      if (!secretsDir) break
      const mgr = new SecretsManager(secretsDir)
      await mgr.remove(appName, key, envFile)
    } catch (error) {
      if (isTextOutput()) {
        consola.warn(
          `secret cleanup (${key}): ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
  if (!configWritten) return
  try {
    const rollbackApps = { ...cfg.apps }
    delete rollbackApps[appName]
    await writeConfig(configFile, { ...cfg, apps: rollbackApps })
  } catch (error) {
    if (isTextOutput()) {
      consola.warn(`config cleanup: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function normalizeAddError(error: unknown, appName: string, configFile: string): Error {
  if (error instanceof CliError || error instanceof ValidationError) {
    return error
  }
  if (error instanceof ComposeInspectionError) {
    return new CliError('compose_inspection_failed', error.message)
  }
  return new CliError('add_failed', error instanceof Error ? error.message : String(error), {
    hint: `rolled back ${appName} from ${configFile}; safe to retry: jib add ...`,
  })
}
