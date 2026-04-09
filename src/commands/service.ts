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
import { applyCliArgs, withCliArgs } from './_cli.ts'

/**
 * `jib service` — inspect and (internally) launch the long-running jib
 * operators. `jib service list` is user-facing (shows what operators are
 * runnable on this host). `jib service start <name>` is **strictly for
 * systemd** — it's the ExecStart target of every `jib-<operator>.service`
 * unit. A human running it directly will bypass systemd supervision and
 * block the terminal.
 *
 * The registry is a plain object (not `import()` on a computed name) so
 * `bun build --compile` can see every dependency at build time.
 */
const RUNNABLE = {
  deployer: () => import('@jib-module/deployer'),
  gitsitter: () => import('@jib-module/gitsitter'),
  nginx: () => import('@jib-module/nginx'),
} as const

type RunnableName = keyof typeof RUNNABLE

function isRunnable(name: string): name is RunnableName {
  return Object.hasOwn(RUNNABLE, name)
}

async function startService(name: string): Promise<void> {
  if (!isRunnable(name)) {
    throw new ValidationError(
      `unknown service "${name}" (expected: ${Object.keys(RUNNABLE).join(', ')})`,
    )
  }
  const paths = getPaths()
  const config = await loadConfig(paths.configFile)
  const ctx: ModuleContext<Config> = { config, logger: createLogger(name), paths }
  const mod = await RUNNABLE[name]()
  if (typeof mod.start !== 'function') {
    throw new ValidationError(`service "${name}" has no start() export`)
  }
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
    const services = Object.keys(RUNNABLE)
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
