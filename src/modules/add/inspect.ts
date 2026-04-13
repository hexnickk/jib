import { CliError, cliIsDebugEnabled, cliIsTextOutput } from '@jib/cli'
import type { App } from '@jib/config'
import {
  type ComposeInspection,
  ComposeInspectionError,
  dockerDiscoverComposeFiles,
  dockerFindUnsafeBindMounts,
  dockerInspectComposeApp,
} from '@jib/docker'
import { isInteractive, note, promptConfirm, promptString } from '@jib/tui'
import { consola } from 'consola'
import { addCanScaffoldCompose, addScaffoldComposeFromDockerfile } from './compose-scaffold.ts'

export interface AddInspectComposeDeps {
  canScaffoldCompose?: (workdir: string) => boolean
  isInteractive?: () => boolean
  note?: typeof note
  promptConfirm?: typeof promptConfirm
  promptString?: typeof promptString
  scaffoldComposeFromDockerfile?: (workdir: string) => string | null
}

/** Inspects compose files, prompting for missing compose input when interactive. */
export async function addInspectCompose(
  draftApp: App,
  workdir: string,
  deps: AddInspectComposeDeps = {},
): Promise<ComposeInspection> {
  let compose = draftApp.compose
  for (;;) {
    try {
      const inspection = dockerInspectComposeApp({ compose }, workdir)
      if (inspection instanceof ComposeInspectionError) throw inspection
      const bindMounts = dockerFindUnsafeBindMounts(workdir, inspection.composeFiles)
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
      const nextCompose = await promptComposePaths(error, workdir, compose, deps)
      if (!nextCompose) throw error
      compose = nextCompose
    }
  }
}

async function promptComposePaths(
  error: unknown,
  workdir: string,
  compose: string[] | undefined,
  deps: AddInspectComposeDeps,
): Promise<string[] | undefined> {
  if (
    !(error instanceof ComposeInspectionError) ||
    error.code !== 'compose_not_found' ||
    !(deps.isInteractive ?? isInteractive)()
  ) {
    handleComposeError(error, workdir, compose)
    return undefined
  }

  if (cliIsTextOutput()) {
    ;(deps.note ?? note)(composeNotFoundMessage(workdir, compose), 'Compose file')
  }
  if (
    (!compose || compose.length === 0) &&
    (deps.canScaffoldCompose ?? addCanScaffoldCompose)(workdir) &&
    (await (deps.promptConfirm ?? promptConfirm)({
      message: 'Generate a minimal docker-compose.generated.yml from the repo Dockerfile?',
      initialValue: true,
    }))
  ) {
    const generated = (deps.scaffoldComposeFromDockerfile ?? addScaffoldComposeFromDockerfile)(
      workdir,
    )
    if (generated) return [generated]
  }
  return (
    await (deps.promptString ?? promptString)({
      message: 'Compose file(s) relative to the repo (comma-separated)',
      placeholder: 'docker-compose.yml',
      ...(compose ? { initialValue: compose.join(',') } : {}),
    })
  )
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function handleComposeError(error: unknown, workdir: string, compose: string[] | undefined): never {
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

function composeNotFoundMessage(workdir: string, compose?: string[]): string {
  const searched = compose?.length
    ? compose
    : ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
  const discovered = dockerDiscoverComposeFiles(workdir)
  const lines = [
    'Jib could not find a compose file in the repo.',
    `Looked for: ${searched.join(', ')}`,
  ]
  if (discovered.length > 0) lines.push(`Detected compose-like files: ${discovered.join(', ')}`)
  return lines.join('\n')
}
