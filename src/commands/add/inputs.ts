import {
  type App,
  AppSchema,
  type Domain,
  type HealthCheck,
  type ParsedDomain,
  parseDomain,
  parseHealth,
  toArray,
  validateRepo,
} from '@jib/config'
import { ValidationError } from '@jib/core'
import type { AddInputs, EnvEntry } from '@jib/flows'
import { isInteractive, promptString } from '@jib/tui'
import { missingInput } from '../_cli.ts'
import { parseEnvEntry, splitCommaValues } from '../add-guided.ts'

export async function gatherAddInputs(args: {
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
  if (repoErr) throw new ValidationError(`--repo "${repo}" ${repoErr}`)
  const ingressDefault = args.ingress ?? 'direct'
  const composeRaw = args.compose ? splitCommaValues(args.compose) : undefined
  const parsedDomains = parseDomains(toArray(args.domain), ingressDefault)
  const healthChecks = parseChecks(toArray(args.health))
  return {
    repo,
    ingressDefault,
    ...(composeRaw ? { composeRaw } : {}),
    parsedDomains,
    envEntries: parseEnvEntries(toArray(args.env)),
    healthChecks,
  }
}

export function buildDraftApp(args: { source?: string; branch?: string }, inputs: AddInputs): App {
  return parseApp({
    repo: inputs.repo,
    branch: args.branch ?? 'main',
    domains: [],
    env_file: '.env',
    ...(args.source ? { source: args.source } : {}),
    ...(inputs.composeRaw ? { compose: inputs.composeRaw } : {}),
    ...(inputs.healthChecks.length > 0 ? { health: inputs.healthChecks } : {}),
  })
}

export function parseApp(appObj: Partial<App> & { repo: string; domains: Domain[] }): App {
  const parsed = AppSchema.safeParse(appObj)
  if (!parsed.success) {
    throw new ValidationError(`invalid app config: ${parsed.error.message}`)
  }
  return parsed.data
}

function parseDomains(rawDomains: string[], ingressDefault: string): ParsedDomain[] {
  try {
    return rawDomains.map((domain) => parseDomain(domain, ingressDefault))
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : String(error))
  }
}

function parseChecks(rawHealth: string[]): HealthCheck[] {
  try {
    return rawHealth.flatMap((h) => h.split(',')).map(parseHealth)
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : String(error))
  }
}

function parseEnvEntries(rawEntries: string[]): EnvEntry[] {
  return rawEntries.map((pair) => {
    try {
      return parseEnvEntry(pair)
    } catch {
      throw new ValidationError(`invalid --env "${pair}" - expected KEY=VALUE`)
    }
  })
}
