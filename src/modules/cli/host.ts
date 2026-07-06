import { $ } from '@/libs/shell'
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

  const entrypoint = process.argv[1]
  if (!entrypoint) {
    return new CliError('root_reexec_failed', 'failed to locate the current jib entrypoint')
  }

  const result = $.sync({ stdio: 'inherit', nothrow: true })`${[
    'sudo',
    process.execPath,
    ...process.execArgv,
    entrypoint,
    ...process.argv.slice(2),
  ]}`
  process.exit(result.exitCode ?? 0)
}
