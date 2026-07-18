import { CliError, cliIsDebugEnabled, cliIsTextOutput } from '@jib/cli'
import type { App } from '@jib/config'
import {
  type ComposeInspection,
  dockerDiscoverComposeFiles,
  dockerFindUnsafeBindMounts,
  dockerInspectComposeApp,
} from '@jib/docker'
import { type JibError, ValidationError, errorsToJibError } from '@jib/errors'
import { tuiIsInteractive, tuiNote, tuiPromptConfirmResult, tuiPromptStringResult } from '@jib/tui'
import { consola } from 'consola'
import { addCanScaffoldCompose, addScaffoldComposeFromDockerfile } from './compose-scaffold.ts'

export interface AddInspectComposeDeps {
  canScaffoldCompose?: (workdir: string) => boolean
  isInteractive?: () => boolean
  note?: typeof tuiNote
  promptConfirm?: typeof tuiPromptConfirmResult
  promptString?: typeof tuiPromptStringResult
  scaffoldComposeFromDockerfile?: (workdir: string) => string | JibError | undefined
}

/** Inspects compose files, prompting for missing compose input when interactive. */
export async function addInspectCompose(
  draftApp: App,
  workdir: string,
  deps: AddInspectComposeDeps = {},
): Promise<ComposeInspection | JibError> {
  let compose = draftApp.compose
  for (;;) {
    const inspection = inspectComposeOnce(workdir, compose)
    if (!(inspection instanceof Error)) {
      if (cliIsDebugEnabled()) {
        consola.info(`compose files: ${inspection.composeFiles.join(', ')}`)
        consola.info(`services: ${inspection.services.map((service) => service.name).join(', ')}`)
      }
      return inspection
    }
    const nextCompose = await promptComposePaths(inspection, workdir, compose, deps)
    if (nextCompose instanceof Error) {
      return nextCompose
    }
    if (!nextCompose) {
      return inspection
    }
    compose = nextCompose
  }
}

/** Resolves a failed inspection through the interactive compose-file recovery flow. */
async function promptComposePaths(
  error: JibError,
  workdir: string,
  compose: string[] | undefined,
  deps: AddInspectComposeDeps,
): Promise<string[] | JibError | undefined> {
  if (!(error instanceof ValidationError) || !(deps.isInteractive ?? tuiIsInteractive)()) {
    return handleComposeError(error, workdir, compose)
  }

  if (cliIsTextOutput()) {
    ;(deps.note ?? tuiNote)(composeNotFoundMessage(workdir, compose), 'Compose file')
  }
  if (
    (!compose || compose.length === 0) &&
    (deps.canScaffoldCompose ?? addCanScaffoldCompose)(workdir)
  ) {
    const confirm = await (deps.promptConfirm ?? tuiPromptConfirmResult)({
      message: 'Generate a minimal docker-compose.generated.yml from the repo Dockerfile?',
      initialValue: true,
    })
    if (confirm instanceof Error) {
      return confirm
    }
    if (!confirm) {
      return await promptComposeInput(compose, deps)
    }
    const generated = (deps.scaffoldComposeFromDockerfile ?? addScaffoldComposeFromDockerfile)(
      workdir,
    )
    if (generated instanceof Error) {
      return generated
    }
    if (generated) {
      return [generated]
    }
  }
  return await promptComposeInput(compose, deps)
}

/** Converts a compose inspection failure to the command-facing error shape. */
function handleComposeError(
  error: unknown,
  workdir: string,
  compose: string[] | undefined,
): JibError {
  if (error instanceof ValidationError) {
    if (!compose || compose.length === 0) {
      return new CliError('compose_inspection_failed', composeNotFoundMessage(workdir), {
        hint: 'add a compose file to the repo root, rerun with --compose <file>, or rerun interactively to generate one from Dockerfile',
      })
    }
    return new CliError('compose_inspection_failed', error.message, {
      hint: 'fix --compose and retry, or rerun with interactive prompts enabled',
    })
  }
  return errorsToJibError(error)
}

/** Describes the compose files searched and any likely alternatives found. */
function composeNotFoundMessage(workdir: string, compose?: string[]): string {
  const searched = compose?.length
    ? compose
    : ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
  const discovered = dockerDiscoverComposeFiles(workdir)
  const lines = [
    'Jib could not find a compose file in the repo.',
    `Looked for: ${searched.join(', ')}`,
  ]
  if (discovered.length > 0) {
    lines.push(`Detected compose-like files: ${discovered.join(', ')}`)
  }
  return lines.join('\n')
}

/** Runs the non-interactive compose parse and bind-mount validation checks. */
function inspectComposeOnce(
  workdir: string,
  compose: string[] | undefined,
): ComposeInspection | CliError | ValidationError {
  const inspection = dockerInspectComposeApp({ compose }, workdir)
  if (inspection instanceof Error) {
    return inspection
  }
  const bindMounts = dockerFindUnsafeBindMounts(workdir, inspection.composeFiles)
  if (bindMounts.length > 0) {
    return new CliError(
      'compose_inspection_failed',
      `host bind mounts are not supported by jib add: ${bindMounts
        .map((mount) => `${mount.service} -> ${mount.source}`)
        .join(', ')}`,
      {
        hint: 'replace bind mounts with named volumes so app storage stays isolated per jib app',
      },
    )
  }
  return inspection
}

/** Prompts for comma-separated compose paths and removes empty entries. */
async function promptComposeInput(
  compose: string[] | undefined,
  deps: AddInspectComposeDeps,
): Promise<string[] | JibError> {
  const input = await (deps.promptString ?? tuiPromptStringResult)({
    message: 'Compose file(s) relative to the repo (comma-separated)',
    placeholder: 'docker-compose.yml',
    ...(compose ? { initialValue: compose.join(',') } : {}),
  })
  if (input instanceof Error) {
    return input
  }
  return input
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}
