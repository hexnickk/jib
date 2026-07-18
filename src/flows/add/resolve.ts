import { cloudflaredReadStatus } from '@jib-module/cloudflared'
import { cliIsTextOutput } from '@jib/cli'
import { type App, type Config, type Domain, configAssignPorts } from '@jib/config'
import { type ComposeInspection, dockerResolveFromCompose } from '@jib/docker'
import { type JibError, ValidationError } from '@jib/errors'
import { pathsDockerHubImage } from '@jib/paths'
import type { Paths } from '@jib/paths'
import { consola } from 'consola'
import { addParseApp } from './app.ts'
import { GENERATED_COMPOSE_FILE, addPersistGeneratedCompose } from './compose-scaffold.ts'
import { addMergeConfigEntries } from './config-entries.ts'
import { addCollectDomains } from './domains.ts'
import { addMergeGuidedServiceAnswers } from './guided.ts'
import { addPromptForServices } from './service-prompts.ts'
import type { AddInputs, ConfigEntry } from './types.ts'

/** Collects the guided domain and config answers that complete the add plan. */
export async function addCollectGuidedInputs(
  inputs: AddInputs,
  composeServices: ComposeInspection['services'],
): Promise<{ domains: Domain[]; configEntries: ConfigEntry[] } | JibError> {
  const serviceNames = composeServices.map((service) => service.name)
  const domains = await addCollectDomains(inputs.parsedDomains, serviceNames)
  if (domains instanceof Error) {
    return domains
  }
  const answers = await addPromptForServices(domains, composeServices, inputs.configEntries)
  if (answers instanceof Error) {
    return answers
  }
  const guided = addMergeGuidedServiceAnswers(domains, serviceNames, answers, inputs.ingressDefault)
  if (guided instanceof Error) {
    return guided
  }
  const configEntries = addMergeConfigEntries([...inputs.configEntries, ...guided.configEntries])
  if (configEntries instanceof Error) {
    return configEntries
  }
  return { domains: guided.domains, configEntries }
}

/** Builds the fully resolved app config once compose inspection and prompts are done. */
export async function addBuildResolvedApp(
  cfg: Config,
  paths: Paths,
  appName: string,
  workdir: string,
  args: { source?: string; branch?: string },
  inputs: AddInputs,
  inspection: ComposeInspection,
  guided: { domains: Domain[]; configEntries: ConfigEntry[] },
): Promise<App | JibError> {
  const capabilityError = validateTunnelReadiness(cfg, paths, guided.domains)
  if (capabilityError) {
    return capabilityError
  }
  const domains = await configAssignPorts(cfg, appName, guided.domains)
  if (domains instanceof Error) {
    return domains
  }
  const composeFiles = await persistComposeFiles(paths, appName, workdir, inspection.composeFiles)
  if (composeFiles instanceof Error) {
    return composeFiles
  }
  const image = pathsDockerHubImage(inputs.repo)
  const parsedApp = addParseApp({
    repo: image ? 'local' : inputs.repo,
    ...(image ? { image } : {}),
    branch: args.branch ?? 'main',
    domains,
    services: inspection.services.map((service) => service.name),
    compose: composeFiles,
    ...(args.source ? { source: args.source } : {}),
    ...(inputs.healthChecks.length > 0 ? { health: inputs.healthChecks } : {}),
  })
  if (parsedApp instanceof Error) {
    return parsedApp
  }
  const resolved = dockerResolveFromCompose(
    parsedApp,
    workdir,
    cliIsTextOutput() ? { warn: (message) => consola.warn(message) } : {},
  )
  if (resolved instanceof Error) {
    return resolved
  }
  return resolved
}

/** Ensures tunnel routes have both desired module enablement and a managed token. */
function validateTunnelReadiness(
  cfg: Config,
  paths: Paths,
  domains: Domain[],
): ValidationError | undefined {
  if (!domains.some((domain) => domain.ingress === 'cloudflare-tunnel')) {
    return undefined
  }
  const status = cloudflaredReadStatus(cfg, paths)
  if (!status.enabled) {
    return new ValidationError(
      'cloudflare tunnel ingress requires cloudflared to be enabled; run `sudo jib init`',
    )
  }
  if (!status.hasToken) {
    return new ValidationError(
      'cloudflare tunnel ingress requires a tunnel token; run `jib cloudflared setup`',
    )
  }
  return undefined
}

/** Persists any generated compose reference and preserves ordinary compose filenames. */
async function persistComposeFiles(
  paths: Paths,
  appName: string,
  workdir: string,
  composeFiles: string[],
): Promise<string[] | JibError> {
  if (!composeFiles.includes(GENERATED_COMPOSE_FILE)) {
    return composeFiles
  }
  const files: string[] = []
  for (const file of composeFiles) {
    if (file !== GENERATED_COMPOSE_FILE) {
      files.push(file)
      continue
    }
    const persisted = await addPersistGeneratedCompose(paths, appName, workdir)
    if (persisted instanceof Error) {
      return persisted
    }
    files.push(persisted)
  }
  return files
}
