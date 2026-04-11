import { readlinkSync } from 'node:fs'
import { CliError } from './errors.ts'
import { canPrompt } from './runtime.ts'

export function ensureLinux(commandName: string): void {
  if (process.platform === 'linux') return
  throw new CliError('unsupported_platform', `jib ${commandName} only runs on Linux target hosts`, {
    hint: 'install or run jib on the target Linux machine',
  })
}

export function ensureRoot(commandName: string): void {
  if (process.getuid?.() === 0) return
  if (!canPrompt()) {
    throw new CliError(
      'root_required',
      `jib ${commandName} must run as root on the target machine`,
      { hint: 'rerun with sudo or from an interactive root shell' },
    )
  }

  const bin = readlinkSync('/proc/self/exe')
  const result = Bun.spawnSync(['sudo', bin, ...process.argv.slice(2)], {
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  process.exit(result.exitCode)
}
