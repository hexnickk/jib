import { $ } from '@/libs/shell'
import { type Config, configLoad } from '@jib/config'
import { InternalError, type JibError, errorsToJibError } from '@jib/errors'

const WATCHER_SERVICE = 'jib-watcher.service'
const CLOUDFLARED_SERVICE = 'jib-cloudflared.service'

interface CommandResultLike {
  exitCode: number
  stderr: { toString(): string }
  stdout: { toString(): string }
}

interface SystemdManagedServicesDeps {
  loadConfig?: (configFile: string) => Promise<Config | JibError>
  run?: (args: readonly string[]) => Promise<CommandResultLike> | CommandResultLike
}

/** Starts all configured Jib-managed systemd units after dependencies are installed. */
export async function systemdStartConfiguredManagedServicesResult(
  configFile: string,
  deps: SystemdManagedServicesDeps = {},
): Promise<JibError | undefined> {
  const config = await (deps.loadConfig ?? configLoad)(configFile)
  if (config instanceof Error) {
    return config
  }

  const watcherError = await systemdStartManagedUnitResult(WATCHER_SERVICE, deps)
  if (watcherError) {
    return watcherError
  }

  if (config.modules.cloudflared === true) {
    return await systemdStartManagedUnitResult(CLOUDFLARED_SERVICE, deps)
  }
  return undefined
}

/** Starts one expected systemd unit, returning a typed error if systemd cannot start it. */
export async function systemdStartManagedUnitResult(
  service: string,
  deps: SystemdManagedServicesDeps = {},
): Promise<InternalError | undefined> {
  const exists = await systemdRun(deps, ['systemctl', 'cat', service])
  if (exists instanceof Error) {
    return exists instanceof InternalError
      ? exists
      : new InternalError(exists.message, { cause: exists })
  }
  if (exists.exitCode !== 0) {
    return new InternalError(
      `start ${service}: ${systemdCommandDetail(exists) || 'unit not found'}`,
    )
  }

  const started = await systemdRun(deps, ['systemctl', 'enable', '--now', service])
  if (started instanceof Error) {
    return started instanceof InternalError
      ? started
      : new InternalError(started.message, { cause: started })
  }
  if (started.exitCode !== 0) {
    return new InternalError(`start ${service}: ${systemdCommandDetail(started)}`)
  }
  return undefined
}

/** Executes systemctl through the injected runner or zx sync and converts unexpected throws. */
async function systemdRun(
  deps: SystemdManagedServicesDeps,
  args: readonly string[],
): Promise<CommandResultLike | JibError> {
  try {
    if (deps.run) {
      return await deps.run(args)
    }
    const result = $.sync`${args}`
    return { exitCode: result.exitCode ?? 0, stderr: result.stderr, stdout: result.stdout }
  } catch (error) {
    return errorsToJibError(error)
  }
}

/** Extracts the useful stderr/stdout detail from a failed systemctl result. */
function systemdCommandDetail(result: CommandResultLike): string {
  return result.stderr.toString().trim() || result.stdout.toString().trim()
}
