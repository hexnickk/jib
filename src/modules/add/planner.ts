import { CliError, cliIsDebugEnabled, cliIsTextOutput } from '@jib/cli'
import { type App, type Config, type Domain, configAssignPorts } from '@jib/config'
import {
  type ComposeInspection,
  ComposeInspectionError,
  discoverComposeFiles,
  findUnsafeBindMounts,
  inspectComposeApp,
  resolveFromCompose,
} from '@jib/docker'
import { dockerHubImage } from '@jib/paths'
import type { Paths } from '@jib/paths'
import { isInteractive, note, promptConfirm, promptString } from '@jib/tui'
import { consola } from 'consola'
import {
  GENERATED_COMPOSE_FILE,
  canScaffoldCompose,
  persistGeneratedCompose,
  scaffoldComposeFromDockerfile,
} from './compose-scaffold.ts'
import { configEntriesToBuildArgs } from './config-entries.ts'
import {
  mergeGuidedServiceAnswers,
  renderAddPlanSummary,
  summarizeComposeServices,
} from './guided.ts'
import { parseApp } from './inputs.ts'
import { collectDomains, promptForServices } from './prompting.ts'
import type { AddInputs, AddPlanner, ConfigEntry } from './types.ts'

interface PlannerDeps {
  canScaffoldCompose?: (workdir: string) => boolean
  isInteractive?: () => boolean
  note?: typeof note
  promptConfirm?: typeof promptConfirm
  promptString?: typeof promptString
  scaffoldComposeFromDockerfile?: (workdir: string) => string | null
}

export function createAddPlanner(deps: PlannerDeps = {}): AddPlanner {
  return {
    inspectCompose: (draftApp, workdir) => inspectComposeWithPrompts(draftApp, workdir, deps),
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
  deps: PlannerDeps,
): Promise<ComposeInspection> {
  let compose = draftApp.compose
  for (;;) {
    try {
      const inspection = inspectComposeApp({ compose }, workdir)
      const bindMounts = findUnsafeBindMounts(workdir, inspection.composeFiles)
      if (bindMounts.length > 0) {
        throw new CliError(
          'compose_inspection_failed',
          `host bind mounts are not supported by jib add: ${bindMounts
            .map((mount) => `${mount.service} -> ${mount.source}`)
            .join(', ')}`,
          {
            hint: 'replace bind mounts with named volumes so app storage stays isolated per jib app',
          },
        )
      }
      if (cliIsDebugEnabled()) {
        consola.info(`compose files: ${inspection.composeFiles.join(', ')}`)
        consola.info(`services: ${inspection.services.map((service) => service.name).join(', ')}`)
      }
      return inspection
    } catch (error) {
      if (
        error instanceof ComposeInspectionError &&
        error.code === 'compose_not_found' &&
        (deps.isInteractive ?? isInteractive)()
      ) {
        if (cliIsTextOutput())
          (deps.note ?? note)(composeNotFoundMessage(workdir, compose), 'Compose file')
        if (
          (!compose || compose.length === 0) &&
          (deps.canScaffoldCompose ?? canScaffoldCompose)(workdir) &&
          (await (deps.promptConfirm ?? promptConfirm)({
            message: 'Generate a minimal docker-compose.generated.yml from the repo Dockerfile?',
            initialValue: true,
          }))
        ) {
          const generated = (deps.scaffoldComposeFromDockerfile ?? scaffoldComposeFromDockerfile)(
            workdir,
          )
          if (generated) {
            compose = [generated]
            continue
          }
        }
        compose = (
          await (deps.promptString ?? promptString)({
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
            hint: 'add a compose file to the repo root, rerun with --compose <file>, or rerun interactively to generate one from Dockerfile',
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
  paths: Paths,
  appName: string,
  workdir: string,
  args: { source?: string; branch?: string },
  inputs: AddInputs,
  inspection: ComposeInspection,
  guided: { domains: Domain[]; configEntries: ConfigEntry[] },
): Promise<App> {
  const domains = await configAssignPorts(cfg, appName, guided.domains)
  if (domains instanceof Error) throw domains
  const buildArgs = configEntriesToBuildArgs(guided.configEntries)
  const composeFiles = await persistComposeFiles(paths, appName, workdir, inspection.composeFiles)
  const image = dockerHubImage(inputs.repo)
  return resolveFromCompose(
    parseApp({
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
    }),
    workdir,
    cliIsTextOutput() ? { warn: (message) => consola.warn(message) } : {},
  )
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
      file === GENERATED_COMPOSE_FILE ? persistGeneratedCompose(paths, appName, workdir) : file,
    ),
  )
}

async function confirmAddPlan(
  appName: string,
  inspection: ComposeInspection,
  finalApp: App,
  configEntries: ConfigEntry[],
): Promise<void> {
  if (!cliIsTextOutput()) return
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
