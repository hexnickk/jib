import { readFile, writeFile } from 'node:fs/promises'
import { $ } from '@/libs/shell'
import { InternalError, ValidationError } from '@jib/errors'
import {
  DOCKER_APT_SOURCE_PATH,
  DOCKER_SAFE_APT_VALUE,
  type DockerAptRepository,
  dockerAptPackageCommands,
  dockerAptPrepCommands,
  dockerAptSourceLine,
  dockerParseOsRelease,
  dockerSelectAptRepository,
} from './install-plan.ts'

const OS_RELEASE_PATH = '/etc/os-release'

export interface DockerInstallCommandResult {
  exitCode: number
  stdout: { toString(): string }
  stderr: { toString(): string }
}

interface DockerInstallDeps {
  readOsRelease?: () => Promise<string>
  run?: (
    args: readonly string[],
  ) => Promise<DockerInstallCommandResult> | DockerInstallCommandResult
  writeFile?: (path: string, data: string, opts: { mode: number }) => Promise<void>
}

/** Ensures Docker Engine, the Compose plugin, and docker.service are available. */
export async function dockerEnsureInstalledResult(
  deps: DockerInstallDeps = {},
): Promise<InternalError | ValidationError | undefined> {
  if (!(await dockerCommandSucceeds(deps, ['sh', '-c', 'command -v systemctl >/dev/null 2>&1']))) {
    return new ValidationError('systemd/systemctl is required')
  }

  if (!(await dockerRuntimeReady(deps))) {
    const installError = await dockerInstallFromApt(deps)
    if (installError) {
      return installError
    }
  }

  const startError = await dockerRunRequired(deps, 'start docker.service', [
    'systemctl',
    'enable',
    '--now',
    'docker.service',
  ])
  if (startError instanceof Error) {
    return startError
  }

  if (!(await dockerRuntimeReady(deps))) {
    return new InternalError(
      'verify Docker runtime: docker compose or docker.service is still unavailable after installation',
    )
  }
}

/** Reports whether the Docker CLI, Compose plugin, and systemd unit are all present. */
export async function dockerRuntimeReady(deps: DockerInstallDeps = {}): Promise<boolean> {
  return (
    (await dockerCommandSucceeds(deps, ['sh', '-c', 'command -v docker >/dev/null 2>&1'])) &&
    (await dockerCommandSucceeds(deps, ['docker', 'compose', 'version'])) &&
    (await dockerCommandSucceeds(deps, ['systemctl', 'cat', 'docker.service']))
  )
}

/** Installs Docker Engine from Docker's official apt repository on supported hosts. */
async function dockerInstallFromApt(
  deps: DockerInstallDeps,
): Promise<InternalError | ValidationError | undefined> {
  if (!(await dockerCommandSucceeds(deps, ['sh', '-c', 'command -v apt-get >/dev/null 2>&1']))) {
    return new ValidationError('apt-get is required for automatic install')
  }

  const repo = await dockerReadAptRepository(deps)
  if (repo instanceof Error) {
    return repo
  }
  const arch = await dockerReadArchitecture(deps)
  if (arch instanceof Error) {
    return arch
  }

  for (const [step, args] of dockerAptPrepCommands(repo)) {
    const error = await dockerRunRequired(deps, step, args)
    if (error instanceof Error) {
      return error
    }
  }

  const sourceError = await dockerWriteAptSource(deps, repo, arch)
  if (sourceError) {
    return sourceError
  }

  for (const [step, args] of dockerAptPackageCommands()) {
    const error = await dockerRunRequired(deps, step, args)
    if (error instanceof Error) {
      return error
    }
  }
}

/** Reads and resolves the host OS into Docker's apt repository coordinates. */
async function dockerReadAptRepository(
  deps: DockerInstallDeps,
): Promise<DockerAptRepository | InternalError | ValidationError> {
  try {
    const raw = await (deps.readOsRelease ?? (() => readFile(OS_RELEASE_PATH, 'utf8')))()
    return dockerSelectAptRepository(dockerParseOsRelease(raw))
  } catch (error) {
    return new InternalError(`read ${OS_RELEASE_PATH}: ${dockerErrorMessage(error)}`, {
      cause: error,
    })
  }
}

/** Reads `dpkg --print-architecture` and validates it for an apt source line. */
async function dockerReadArchitecture(
  deps: DockerInstallDeps,
): Promise<string | InternalError | ValidationError> {
  const archResult = await dockerRunRequired(deps, 'read dpkg architecture', [
    'dpkg',
    '--print-architecture',
  ])
  if (archResult instanceof Error) {
    return archResult
  }
  const arch = archResult.stdout.toString().trim()
  if (!DOCKER_SAFE_APT_VALUE.test(arch)) {
    return new ValidationError(`unsupported dpkg architecture "${arch}"`)
  }
  return arch
}

/** Writes Docker's apt source list after architecture/distro values have been validated. */
async function dockerWriteAptSource(
  deps: DockerInstallDeps,
  repo: DockerAptRepository,
  arch: string,
): Promise<InternalError | undefined> {
  try {
    await (deps.writeFile ?? writeFile)(DOCKER_APT_SOURCE_PATH, dockerAptSourceLine(repo, arch), {
      mode: 0o644,
    })
  } catch (error) {
    return new InternalError(`write ${DOCKER_APT_SOURCE_PATH}: ${dockerErrorMessage(error)}`, {
      cause: error,
    })
  }
}

/** Runs a command where non-zero exit becomes an internal install failure. */
async function dockerRunRequired(
  deps: DockerInstallDeps,
  step: string,
  args: readonly string[],
): Promise<DockerInstallCommandResult | InternalError> {
  try {
    const result = await dockerRun(deps, args)
    return result.exitCode === 0
      ? result
      : new InternalError(`${step}: ${dockerCommandDetail(result)}`)
  } catch (error) {
    return new InternalError(`${step}: ${dockerErrorMessage(error)}`, { cause: error })
  }
}

/** Runs a command as a boolean probe; failures mean "not available". */
async function dockerCommandSucceeds(
  deps: DockerInstallDeps,
  args: readonly string[],
): Promise<boolean> {
  try {
    return (await dockerRun(deps, args)).exitCode === 0
  } catch {
    return false
  }
}

/** Executes a command through the injected runner or zx sync. */
function dockerRun(
  deps: DockerInstallDeps,
  args: readonly string[],
): Promise<DockerInstallCommandResult> | DockerInstallCommandResult {
  if (deps.run) {
    return deps.run(args)
  }
  const result = $.sync`${args}`
  return { exitCode: result.exitCode ?? 0, stderr: result.stderr, stdout: result.stdout }
}

function dockerCommandDetail(result: DockerInstallCommandResult): string {
  return (
    result.stderr.toString().trim() ||
    result.stdout.toString().trim() ||
    `command exited with code ${result.exitCode}`
  )
}

function dockerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
