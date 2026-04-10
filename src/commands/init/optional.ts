import { type Config, loadConfig, writeConfig } from '@jib/config'
import { type ModuleContext, type Paths, createLogger } from '@jib/core'
import { runInstallsTx } from './install.ts'
import { type ModLike, promptOptionalModule } from './registry.ts'

interface OptionalModuleDeps {
  loadConfig?: typeof loadConfig
  promptOptionalModule?: typeof promptOptionalModule
  writeConfig?: typeof writeConfig
}

function moduleCtx(config: Config, paths: Paths): ModuleContext<Config> {
  return { config, logger: createLogger('init'), paths }
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

  let current = config
  for (const mod of candidates) {
    const enabled = await ask(mod)
    if (!enabled) {
      current = await persistModuleChoice(paths.configFile, mod.manifest.name, false, deps)
      continue
    }

    if (mod.install) await runInstallsTx([mod], moduleCtx(current, paths))
    if (mod.setup) await mod.setup(moduleCtx(current, paths))
    current = await persistModuleChoice(paths.configFile, mod.manifest.name, true, deps)
  }
}
