import { cliIsTextOutput } from '@jib/cli'
import { type App, type Config, type Domain, configAssignPorts } from '@jib/config'
import { type ComposeInspection, dockerResolveFromCompose } from '@jib/docker'
import { pathsDockerHubImage } from '@jib/paths'
import type { Paths } from '@jib/paths'
import { consola } from 'consola'
import { addParseApp } from './app.ts'
import { GENERATED_COMPOSE_FILE, addPersistGeneratedCompose } from './compose-scaffold.ts'
import { addConfigEntriesToBuildArgs } from './config-entries.ts'
import { addCollectDomains } from './domains.ts'
import { addMergeGuidedServiceAnswers } from './guided.ts'
import { addPromptForServices } from './service-prompts.ts'
import type { AddInputs, ConfigEntry } from './types.ts'

/** Collects the guided domain and config answers that complete the add plan. */
export async function addCollectGuidedInputs(
  inputs: AddInputs,
  composeServices: ComposeInspection['services'],
): Promise<{ domains: Domain[]; configEntries: ConfigEntry[] } | Error> {
  const serviceNames = composeServices.map((service) => service.name)
  const domains = await addCollectDomains(inputs.parsedDomains, serviceNames)
  if (domains instanceof Error) return domains
  const answers = await addPromptForServices(domains, composeServices, inputs.configEntries)
  if (answers instanceof Error) return answers
  const guided = addMergeGuidedServiceAnswers(domains, serviceNames, answers, inputs.ingressDefault)
  if (guided instanceof Error) return guided
  return guided
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
): Promise<App | Error> {
  const domains = await configAssignPorts(cfg, appName, guided.domains)
  if (domains instanceof Error) return domains
  const buildArgs = addConfigEntriesToBuildArgs(guided.configEntries)
  const composeFiles = await persistComposeFiles(paths, appName, workdir, inspection.composeFiles)
  const image = pathsDockerHubImage(inputs.repo)
  const parsedApp = addParseApp({
    repo: image ? 'local' : inputs.repo,
    ...(image ? { image } : {}),
    branch: args.branch ?? 'main',
    domains,
    env_file: '.env',
    services: inspection.services.map((service) => service.name),
    compose: composeFiles,
    ...(args.source ? { source: args.source } : {}),
    ...(inputs.healthChecks.length > 0 ? { health: inputs.healthChecks } : {}),
    ...(buildArgs ? { build_args: buildArgs } : {}),
  })
  if (parsedApp instanceof Error) return parsedApp
  const resolved = dockerResolveFromCompose(
    parsedApp,
    workdir,
    cliIsTextOutput() ? { warn: (message) => consola.warn(message) } : {},
  )
  if (resolved instanceof Error) return resolved
  return resolved
}

async function persistComposeFiles(
  paths: Paths,
  appName: string,
  workdir: string,
  composeFiles: string[],
): Promise<string[]> {
  if (!composeFiles.includes(GENERATED_COMPOSE_FILE)) return composeFiles
  return await Promise.all(
    composeFiles.map((file) =>
      file === GENERATED_COMPOSE_FILE ? addPersistGeneratedCompose(paths, appName, workdir) : file,
    ),
  )
}
