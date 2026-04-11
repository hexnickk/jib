import { CliError, isDebugEnabled, isTextOutput } from '@jib/cli'
import { type App, type Config, type Domain, assignPorts } from '@jib/config'
import {
  type ComposeInspection,
  ComposeInspectionError,
  discoverComposeFiles,
  inspectComposeApp,
  resolveFromCompose,
} from '@jib/docker'
import { isInteractive, note, promptConfirm, promptString } from '@jib/tui'
import { consola } from 'consola'
import { configEntriesToBuildArgs } from './config-entries.ts'
import {
  mergeGuidedServiceAnswers,
  renderAddPlanSummary,
  summarizeComposeServices,
} from './guided.ts'
import { parseApp } from './inputs.ts'
import { collectDomains, promptForServices } from './prompting.ts'
import type { AddInputs, AddPlanner, ConfigEntry } from './types.ts'

export function createAddPlanner(): AddPlanner {
  return {
    inspectCompose: inspectComposeWithPrompts,
    collectGuidedInputs,
    buildResolvedApp,
    confirmPlan: confirmAddPlan,
  }
}

function composeNotFoundMessage(workdir: string, compose?: string[]): string {
  const searched = compose?.length
    ? compose
    : ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
  const discovered = discoverComposeFiles(workdir)
  const lines = [
    'Jib could not find a compose file in the repo.',
    `Looked for: ${searched.join(', ')}`,
  ]
  if (discovered.length > 0) lines.push(`Detected compose-like files: ${discovered.join(', ')}`)
  return lines.join('\n')
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
        if (isTextOutput()) note(composeNotFoundMessage(workdir, compose), 'Compose file')
        compose = (
          await promptString({
            message: 'Compose file(s) relative to the repo (comma-separated)',
            placeholder: 'docker-compose.yml',
            ...(compose ? { initialValue: compose.join(',') } : {}),
          })
        )
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
        continue
      }
      if (error instanceof ComposeInspectionError && error.code === 'compose_not_found') {
        if (!compose || compose.length === 0) {
          throw new CliError('compose_inspection_failed', composeNotFoundMessage(workdir), {
            hint: 'add a compose file to the repo root, or rerun with --compose <file>',
          })
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
  composeServices: ComposeInspection['services'],
): Promise<{ domains: Domain[]; configEntries: ConfigEntry[] }> {
  const serviceNames = composeServices.map((service) => service.name)
  const domains = await collectDomains(inputs.parsedDomains, serviceNames)
  const answers = await promptForServices(domains, composeServices, inputs.configEntries)
  return mergeGuidedServiceAnswers(domains, serviceNames, answers, inputs.ingressDefault)
}

async function buildResolvedApp(
  cfg: Config,
  appName: string,
  workdir: string,
  args: { source?: string; branch?: string },
  inputs: AddInputs,
  inspection: ComposeInspection,
  guided: { domains: Domain[]; configEntries: ConfigEntry[] },
): Promise<App> {
  const domains = await assignPorts(cfg, appName, guided.domains)
  const buildArgs = configEntriesToBuildArgs(guided.configEntries)
  return resolveFromCompose(
    parseApp({
      repo: inputs.repo,
      branch: args.branch ?? 'main',
      domains,
      env_file: '.env',
      services: inspection.services.map((service) => service.name),
      compose: inspection.composeFiles,
      ...(args.source ? { source: args.source } : {}),
      ...(inputs.healthChecks.length > 0 ? { health: inputs.healthChecks } : {}),
      ...(buildArgs ? { build_args: buildArgs } : {}),
    }),
    workdir,
    isTextOutput() ? { warn: (message) => consola.warn(message) } : {},
  )
}

async function confirmAddPlan(
  appName: string,
  inspection: ComposeInspection,
  finalApp: App,
  configEntries: ConfigEntry[],
): Promise<void> {
  if (!isTextOutput()) return
  consola.box(
    renderAddPlanSummary({
      app: appName,
      composeFiles: inspection.composeFiles,
      services: summarizeComposeServices(inspection.services),
      domains: finalApp.domains,
      configEntries,
      envFile: finalApp.env_file,
    }),
  )
  if (!isInteractive()) return
  if (!(await promptConfirm({ message: `Write config for "${appName}"?`, initialValue: true }))) {
    throw new CliError('cancelled', 'add cancelled')
  }
}
