#!/usr/bin/env bun
import { type Config, loadConfig } from '@jib/config'
import { type ModuleContext, createLogger, getPaths } from '@jib/core'
import { defineCommand, runMain } from 'citty'
import { consola } from 'consola'

/**
 * Static registry of runnable modules. A plain object (not dynamic import
 * on a computed name) so `bun build --compile` sees every dependency at
 * build time and bundles it into the single binary. Adding a new long-lived
 * service means registering it here.
 */
const RUNNABLE = {
  deployer: () => import('@jib-module/deployer'),
  gitsitter: () => import('@jib-module/gitsitter'),
} as const

/** Modules that exist but can't be `jib run`'d (install-only). */
const INSTALL_ONLY = new Set(['nats', 'cloudflared', 'nginx', 'cloudflare', 'github'])

type RunnableName = keyof typeof RUNNABLE

function isRunnable(name: string): name is RunnableName {
  return Object.hasOwn(RUNNABLE, name)
}

async function runModule(name: string): Promise<never> {
  if (INSTALL_ONLY.has(name)) {
    consola.error(`module "${name}" is install-only — it has no long-running service`)
    process.exit(1)
  }
  if (!isRunnable(name)) {
    consola.error(`unknown module "${name}" (expected: ${Object.keys(RUNNABLE).join(', ')})`)
    process.exit(1)
  }

  const paths = getPaths()
  const config = await loadConfig(paths.configFile)
  const logger = createLogger(name)
  const ctx: ModuleContext<Config> = { config, logger, paths }

  const mod = await RUNNABLE[name]()
  if (typeof mod.start !== 'function') {
    consola.error(`module "${name}" has no start() export`)
    process.exit(1)
  }
  await mod.start(ctx)
  process.exit(0)
}

const run = defineCommand({
  meta: { name: 'run', description: 'Run a jib module as a long-running service' },
  args: {
    module: {
      type: 'positional',
      description: `Module name (${Object.keys(RUNNABLE).join(' | ')})`,
      required: true,
    },
  },
  async run({ args }) {
    await runModule(args.module)
  },
})

const main = defineCommand({
  meta: {
    name: 'jib',
    version: '0.0.0',
    description: 'Lightweight deploy tool for docker-compose apps over SSH',
  },
  subCommands: { run },
})

await runMain(main)
