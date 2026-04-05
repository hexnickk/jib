import { type Config, loadConfig } from '@jib/config'
import { type ModuleContext, createLogger, getPaths } from '@jib/core'
import { defineCommand } from 'citty'
import { consola } from 'consola'

/**
 * `jib service start <name>` / `jib service list` — drive long-running jib
 * services (deployer, gitsitter). Formerly `jib run <module>`; renamed so
 * `jib run <app> <service>` (compose run) gets the intuitive verb.
 *
 * The registry is a plain object (not `import()` on a computed name) so
 * `bun build --compile` can see every dependency at build time.
 */
const RUNNABLE = {
  deployer: () => import('@jib-module/deployer'),
  gitsitter: () => import('@jib-module/gitsitter'),
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
  meta: { name: 'start', description: 'Run a jib service in the foreground' },
  args: { name: { type: 'positional', required: true } },
  async run({ args }) {
    await startService(args.name)
  },
})

const list = defineCommand({
  meta: { name: 'list', description: 'List runnable jib services' },
  run() {
    for (const name of Object.keys(RUNNABLE)) consola.log(name)
  },
})

export default defineCommand({
  meta: { name: 'service', description: 'Manage long-running jib services' },
  subCommands: { start, list },
})
