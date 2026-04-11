import { readlinkSync } from 'node:fs'
import { CliError, canPrompt } from '@jib/core'

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

  // /proc/self/exe resolves to the real binary on disk (process.execPath
  // returns a virtual /$bunfs/ path in compiled binaries). argv.slice(2)
  // skips both the binary path and the Bun entry-point path.
  const bin = readlinkSync('/proc/self/exe')
  const result = Bun.spawnSync(['sudo', bin, ...process.argv.slice(2)], {
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  process.exit(result.exitCode)
}
