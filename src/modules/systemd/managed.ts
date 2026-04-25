import { type Config, configLoad } from '@jib/config'
import { SystemdServiceStartError } from './errors.ts'

const WATCHER_SERVICE = 'jib-watcher.service'
const CLOUDFLARED_SERVICE = 'jib-cloudflared.service'

interface CommandResultLike {
  exitCode: number
  stderr: { toString(): string }
  stdout: { toString(): string }
}

interface SystemdManagedServicesDeps {
  loadConfig?: (configFile: string) => Promise<Config | Error>
  run?: (args: readonly string[]) => Promise<CommandResultLike> | CommandResultLike
}

/** Starts all configured Jib-managed systemd units after dependencies are installed. */
export async function systemdStartConfiguredManagedServicesResult(
  configFile: string,
  deps: SystemdManagedServicesDeps = {},
): Promise<Error | undefined> {
  const config = await (deps.loadConfig ?? configLoad)(configFile)
  if (config instanceof Error) return config

  const watcherError = await systemdStartManagedUnitResult(WATCHER_SERVICE, deps)
  if (watcherError) return watcherError

  if (config.modules.cloudflared === true) {
    return systemdStartManagedUnitResult(CLOUDFLARED_SERVICE, deps)
  }
}

/** Starts one expected systemd unit, returning a typed error if systemd cannot start it. */
export async function systemdStartManagedUnitResult(
  service: string,
  deps: SystemdManagedServicesDeps = {},
): Promise<SystemdServiceStartError | undefined> {
  const exists = await systemdRun(deps, ['systemctl', 'cat', service])
  if (exists.exitCode !== 0) {
    return new SystemdServiceStartError(service, systemdCommandDetail(exists) || 'unit not found')
  }

  const started = await systemdRun(deps, ['systemctl', 'enable', '--now', service])
  if (started.exitCode !== 0) {
    return new SystemdServiceStartError(service, systemdCommandDetail(started))
  }
}

/** Executes systemctl through the injected runner or Bun.spawnSync for migration/repair use. */
function systemdRun(
  deps: SystemdManagedServicesDeps,
  args: readonly string[],
): Promise<CommandResultLike> | CommandResultLike {
  try {
    if (deps.run) return deps.run(args)
    const result = Bun.spawnSync([...args], { stderr: 'pipe', stdout: 'pipe' })
    return { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { exitCode: 1, stderr: Buffer.from(detail), stdout: Buffer.from('') }
  }
}

function systemdCommandDetail(result: CommandResultLike): string {
  return result.stderr.toString().trim() || result.stdout.toString().trim()
}
