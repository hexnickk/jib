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
import { applyCliArgs, withCliArgs } from './commands/_cli.ts'
import { resolveRunnableModule, runnableModuleNames } from './module-registry.ts'

export async function startService(name: string): Promise<void> {
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

export function listServices(): string[] {
  return runnableModuleNames()
}

export const startServiceCmd = defineCommand({
  meta: {
    name: 'start',
    description:
      '[systemd only] Run a jib operator in the foreground. Canonical ExecStart target for jib-daemon.',
  },
  args: withCliArgs({ name: { type: 'positional', required: true } }),
  async run({ args }) {
    applyCliArgs(args)
    await startService(args.name)
  },
})

export const listServicesCmd = defineCommand({
  meta: { name: 'list', description: 'List runnable jib operators' },
  args: withCliArgs({}),
  run({ args }) {
    applyCliArgs(args)
    const services = listServices()
    if (isTextOutput()) {
      for (const name of services) consola.log(name)
    }
    return { services }
  },
})
