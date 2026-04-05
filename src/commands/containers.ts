import { defineCommand } from 'citty'
import { consola } from 'consola'
import { composeFor } from './_compose.ts'
import { loadAppOrExit } from './_ctx.ts'

/**
 * `jib up|down|restart` — per-app container lifecycle. No bus involved:
 * these are thin wrappers around `docker compose` using the same resolved
 * config the deployer uses. Mirrors Go's `registerContainerCommands`.
 */

async function load(app: string) {
  const { cfg, paths } = await loadAppOrExit(app)
  return composeFor(cfg, paths, app)
}

export const upCmd = defineCommand({
  meta: { name: 'up', description: 'Start existing containers without rebuilding' },
  args: { app: { type: 'positional', required: true } },
  async run({ args }) {
    const compose = await load(args.app)
    await compose.up({})
    consola.success(`Started ${args.app}.`)
  },
})

export const downCmd = defineCommand({
  meta: { name: 'down', description: 'Stop containers without removing app from config' },
  args: {
    app: { type: 'positional', required: true },
    volumes: { type: 'boolean', description: 'Also remove Docker volumes' },
  },
  async run({ args }) {
    const compose = await load(args.app)
    await compose.down(Boolean(args.volumes))
    consola.success(`Stopped ${args.app}.`)
  },
})

export const restartCmd = defineCommand({
  meta: { name: 'restart', description: 'Restart containers without redeploying' },
  args: { app: { type: 'positional', required: true } },
  async run({ args }) {
    const compose = await load(args.app)
    await compose.restart()
    consola.success(`Restarted ${args.app}.`)
  },
})
