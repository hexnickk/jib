import { $ } from '@/libs/shell'
import { UpdateError } from './errors.ts'

const PACKAGE_NAME = 'deployjib'
const CLI_BIN = 'jib'
const WATCHER_SERVICE = 'jib-watcher.service'

type UpdateCommandRunner = (command: string[], options?: { sudo?: boolean }) => Promise<number>

interface UpdateRunDeps {
  platform?: NodeJS.Platform
  packageSpec?: string
  runCommand?: UpdateCommandRunner
}

/** Runs a subprocess with inherited stdio, optionally through sudo, and returns its exit code. */
async function updateRunCommand(
  command: string[],
  options: { sudo?: boolean } = {},
): Promise<number> {
  const finalCommand = options.sudo && process.getuid?.() !== 0 ? ['sudo', ...command] : command
  const proc = await $({ stdio: 'inherit' })`${finalCommand}`
  return proc.exitCode ?? 0
}

/** Runs one command and converts a non-zero exit into an update error. */
async function updateRunChecked(
  run: UpdateCommandRunner,
  command: string[],
  label: string,
  options: { sudo?: boolean } = {},
): Promise<undefined | UpdateError> {
  const code = await run(command, options)
  return code === 0 ? undefined : new UpdateError(`${label} exited with status ${code}`)
}

/** Installs the npm package and performs Linux post-update maintenance. */
async function updateInstallPackage(
  packageSpec: string,
  platform: NodeJS.Platform,
  run: UpdateCommandRunner,
): Promise<undefined | UpdateError> {
  const installError = await updateRunChecked(
    run,
    ['npm', 'install', '-g', packageSpec],
    'npm install',
  )
  if (installError) return installError
  if (platform !== 'linux') return undefined

  const migrateError = await updateRunChecked(run, [CLI_BIN, 'migrate'], 'migrate', {
    sudo: true,
  })
  if (migrateError) return migrateError

  const watcherActive = await run([
    'sh',
    '-c',
    `command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet ${WATCHER_SERVICE}`,
  ])
  if (watcherActive === 0) {
    const restartError = await updateRunChecked(
      run,
      ['systemctl', 'restart', WATCHER_SERVICE],
      'watcher restart',
      { sudo: true },
    )
    if (restartError) return restartError
  }

  return await updateRunChecked(
    run,
    [CLI_BIN, 'init', '--check', '--interactive=never'],
    'optional module check',
    { sudo: true },
  )
}

/** Converts unexpected subprocess setup failures into update errors. */
function updateErrorFrom(error: unknown): UpdateError {
  if (error instanceof UpdateError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new UpdateError(message, error instanceof Error ? { cause: error } : undefined)
}

/**
 * Updates jib from npm. Inputs are injectable process dependencies for isolated tests.
 * Output is undefined on success or a typed update error; side effects replace the global npm package and run post-install checks.
 */
export async function updateRunResult(deps: UpdateRunDeps = {}): Promise<undefined | UpdateError> {
  try {
    return await updateInstallPackage(
      deps.packageSpec ?? PACKAGE_NAME,
      deps.platform ?? process.platform,
      deps.runCommand ?? updateRunCommand,
    )
  } catch (error) {
    return updateErrorFrom(error)
  }
}
