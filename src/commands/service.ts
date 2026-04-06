import { type Config, loadConfig } from '@jib/config'
import { type ModuleContext, createLogger, getPaths } from '@jib/core'
import { defineCommand } from 'citty'
import { consola } from 'consola'

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

async function startService(name: string): Promise<never> {
  if (!isRunnable(name)) {
    consola.error(`unknown service "${name}" (expected: ${Object.keys(RUNNABLE).join(', ')})`)
    process.exit(1)
  }
  const paths = getPaths()
  const config = await loadConfig(paths.configFile)
  const ctx: ModuleContext<Config> = { config, logger: createLogger(name), paths }
  const mod = await RUNNABLE[name]()
  if (typeof mod.start !== 'function') {
    consola.error(`service "${name}" has no start() export`)
    process.exit(1)
  }
  await mod.start(ctx)
  process.exit(0)
}

const start = defineCommand({
  meta: {
    name: 'start',
    description:
      '[systemd only] Run a jib operator in the foreground. Invoked by jib-<name>.service units; not for direct use.',
  },
  args: { name: { type: 'positional', required: true } },
  async run({ args }) {
    await startService(args.name)
  },
})

const list = defineCommand({
  meta: { name: 'list', description: 'List runnable jib operators' },
  run() {
    for (const name of Object.keys(RUNNABLE)) consola.log(name)
  },
})

export default defineCommand({
  meta: { name: 'service', description: 'Inspect long-running jib operators' },
  subCommands: { start, list },
})
