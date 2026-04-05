import { loadConfig } from '@jib/config'
import { getPaths } from '@jib/core'
import { isInteractive, promptConfirm } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { withBus } from '../bus-client.ts'

/**
 * `jib edit` — opens `$EDITOR` on `config.yml`, validates on save, offers to
 * retry on failure, then best-effort pokes running services via
 * `cmd.config.reload`. NATS unreachable is a warning, not a failure — editing
 * offline must keep working. Matches the Go `runEdit` behavior but adds the
 * reload signal so long-running services pick up changes without a restart.
 */

function resolveEditor(): string {
  return process.env.EDITOR ?? process.env.VISUAL ?? 'vi'
}

async function spawnEditor(cmd: string, file: string): Promise<number> {
  const proc = Bun.spawn({
    cmd: [cmd, file],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return proc.exited
}

async function editLoop(file: string): Promise<boolean> {
  const editor = resolveEditor()
  while (true) {
    const code = await spawnEditor(editor, file)
    if (code !== 0) {
      consola.error(`editor exited with code ${code}`)
      return false
    }
    try {
      await loadConfig(file)
      return true
    } catch (err) {
      consola.error(`config validation failed: ${(err as Error).message}`)
      if (!isInteractive()) return false
      const retry = await promptConfirm({ message: 'Edit again?', initialValue: true })
      if (!retry) return false
    }
  }
}

async function notifyReload(): Promise<void> {
  try {
    await withBus(async (bus) => {
      bus.publish('jib.cmd.config.reload', {
        corrId: crypto.randomUUID(),
        ts: new Date().toISOString(),
        source: 'jib-edit',
      })
    })
    consola.info('sent cmd.config.reload')
  } catch (err) {
    consola.warn(`could not notify services: ${(err as Error).message}`)
  }
}

export default defineCommand({
  meta: { name: 'edit', description: 'Edit config.yml in $EDITOR with validation' },
  async run() {
    const paths = getPaths()
    if (!(await Bun.file(paths.configFile).exists())) {
      consola.error(`config file not found at ${paths.configFile}`)
      process.exit(1)
    }
    const ok = await editLoop(paths.configFile)
    if (!ok) process.exit(1)
    consola.success('config saved — changes take effect on next deploy / config reload')
    await notifyReload()
  },
})
