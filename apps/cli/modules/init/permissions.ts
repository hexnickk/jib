import { existsSync } from 'node:fs'
import type { Paths } from '@jib/core'

const GROUP = 'jib'

export interface RepairManagedTreeDeps {
  runCommand?: (command: string[], okExitCodes?: number[]) => Promise<void>
  sudoUser?: string | undefined
}

async function runCommand(command: string[], okExitCodes = [0]): Promise<void> {
  const result = Bun.spawnSync(command, { stdout: 'ignore', stderr: 'pipe' })
  if (okExitCodes.includes(result.exitCode)) return
  const stderr = result.stderr.toString().trim()
  const program = command[0] ?? 'command'
  throw new Error(stderr || `${program} exited ${result.exitCode}`)
}

export async function repairManagedTreePermissions(
  paths: Paths,
  deps: RepairManagedTreeDeps = {},
): Promise<void> {
  const run = deps.runCommand ?? runCommand

  await run(['groupadd', '--system', GROUP], [0, 9])
  await run(['chown', '-R', `root:${GROUP}`, paths.root])
  await run(['chmod', '-R', 'g+rwXs', paths.root])
  if (existsSync(paths.configFile)) {
    await run(['chmod', '640', paths.configFile])
  }

  const sudoUser = deps.sudoUser ?? process.env.SUDO_USER
  if (sudoUser) {
    await run(['usermod', '-aG', GROUP, sudoUser])
  }
}
