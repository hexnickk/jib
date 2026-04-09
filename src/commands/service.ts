import { type Config, loadConfig } from '@jib/config'
import {
  type ModuleContext,
  ValidationError,
  createLogger,
  getPaths,
  isTextOutput,
} from '@jib/core'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { resolveRunnableModule, runnableModuleNames } from '../module-registry.ts'
import { applyCliArgs, withCliArgs } from './_cli.ts'

/**
 * `jib service` — inspect and (internally) launch the long-running jib
 * operators. `jib service list` is user-facing (shows what operators are
 * runnable on this host). `jib service start <name>` is **strictly for
 * systemd** — it's the ExecStart target of every `jib-<operator>.service`
 * unit. A human running it directly will bypass systemd supervision and
 * block the terminal.
 *
 * Runnable services are derived from the static first-party module registry so
 * `init`, module CLIs, and operator launching all stay in sync.
 */
async function startService(name: string): Promise<void> {
  const mod = resolveRunnableModule(name)
  if (!mod) {
    throw new ValidationError(
      `unknown service "${name}" (expected: ${runnableModuleNames().join(', ')})`,
    )
  }
  const paths = getPaths()
  const config = await loadConfig(paths.configFile)
  const ctx: ModuleContext<Config> = { config, logger: createLogger(name), paths }
  await mod.start(ctx)
}

const start = defineCommand({
  meta: {
    name: 'start',
    description:
      '[systemd only] Run a jib operator in the foreground. Invoked by jib-<name>.service units; not for direct use.',
  },
  args: withCliArgs({ name: { type: 'positional', required: true } }),
  async run({ args }) {
    applyCliArgs(args)
    await startService(args.name)
  },
})

const list = defineCommand({
  meta: { name: 'list', description: 'List runnable jib operators' },
  args: withCliArgs({}),
  run({ args }) {
    applyCliArgs(args)
    const services = runnableModuleNames()
    if (isTextOutput()) {
      for (const name of services) consola.log(name)
    }
    return { services }
  },
})

export default defineCommand({
  meta: { name: 'service', description: 'Inspect long-running jib operators' },
  subCommands: { start, list },
})
