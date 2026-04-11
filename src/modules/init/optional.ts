import { type Config, loadConfig, writeConfig } from '@jib/config'
import { createLogger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { runInstallsTx } from './install.ts'
import { type ModLike, promptOptionalModule } from './registry.ts'
import { resolveModuleSetup } from './setup-registry.ts'
import type { InitContext } from './types.ts'

interface OptionalModuleDeps {
  loadConfig?: typeof loadConfig
  promptOptionalModule?: typeof promptOptionalModule
  resolveModuleSetup?: typeof resolveModuleSetup
  writeConfig?: typeof writeConfig
}

function initCtx(config: Config, paths: Paths): InitContext {
  return { config, logger: createLogger('init'), paths }
}

async function rollbackModuleInstall(mod: ModLike, ctx: InitContext): Promise<void> {
  if (!mod.uninstall) return
  try {
    await mod.uninstall(ctx)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.warn(`${mod.manifest.name} uninstall failed after setup error: ${message}`)
  }
}

export async function persistModuleChoice(
  configFile: string,
  name: string,
  enabled: boolean,
  deps: OptionalModuleDeps = {},
): Promise<Config> {
  const read = deps.loadConfig ?? loadConfig
  const write = deps.writeConfig ?? writeConfig
  const next = await read(configFile)
  next.modules[name] = enabled
  await write(configFile, next)
  return next
}

export async function configureOptionalModules(
  config: Config,
  paths: Paths,
  candidates: readonly ModLike[],
  deps: OptionalModuleDeps = {},
): Promise<void> {
  const ask = deps.promptOptionalModule ?? promptOptionalModule
  const setupFor = deps.resolveModuleSetup ?? resolveModuleSetup

  let current = config
  for (const mod of candidates) {
    const enabled = await ask(mod)
    if (!enabled) {
      current = await persistModuleChoice(paths.configFile, mod.manifest.name, false, deps)
      continue
    }

    const ctx = initCtx(current, paths)
    const setup = setupFor(mod.manifest.name)
    try {
      if (mod.install) await runInstallsTx([mod], ctx)
      if (setup) {
        const configured = await setup(ctx)
        if (!configured) throw new Error(`${mod.manifest.name} setup did not complete`)
      }
      current = await persistModuleChoice(paths.configFile, mod.manifest.name, true, deps)
    } catch (error) {
      if (mod.install) await rollbackModuleInstall(mod, ctx)
      throw error
    }
  }
}
