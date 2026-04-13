import { readlinkSync } from 'node:fs'
import { CliError } from './errors.ts'
import { cliCanPrompt } from './runtime.ts'

/** Returns an error when a command must run on Linux. */
export function cliCheckLinuxHost(commandName: string): CliError | undefined {
  if (process.platform === 'linux') return undefined
  return new CliError(
    'unsupported_platform',
    `jib ${commandName} only runs on Linux target hosts`,
    {
      hint: 'install or run jib on the target Linux machine',
    },
  )
}

/** Re-execs under sudo when prompting is allowed, or returns an error when it is not. */
export function cliCheckRootHost(commandName: string): CliError | undefined {
  if (process.getuid?.() === 0) return undefined
  if (!cliCanPrompt()) {
    return new CliError(
      'root_required',
      `jib ${commandName} must run as root on the target machine`,
      {
        hint: 'rerun with sudo or from an interactive root shell',
      },
    )
  }

  let bin: string
  try {
    bin = readlinkSync('/proc/self/exe')
  } catch (error) {
    return new CliError('root_reexec_failed', 'failed to locate the current jib binary', {
      cause: error,
    })
  }

  try {
    const result = Bun.spawnSync(['sudo', bin, ...process.argv.slice(2)], {
      stdio: ['inherit', 'inherit', 'inherit'],
    })
    process.exit(result.exitCode)
  } catch (error) {
    return new CliError('root_reexec_failed', 'failed to re-run jib with sudo', {
      cause: error,
      hint: 'rerun with sudo manually and inspect the local sudo configuration',
    })
  }
}
