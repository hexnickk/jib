import { type Config, ConfigError, configLoad, configWrite } from '@jib/config'
import { loggingCreateLogger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import {
  type InitModuleInstallError,
  type InitOptionalModuleError,
  OptionalModuleChoicePersistError,
  OptionalModuleSetupError,
  toInitModuleInstallError,
  toOptionalModuleChoicePersistError,
  toOptionalModuleSetupError,
} from './errors.ts'
import { initRunInstallsTx } from './install.ts'
import { initPromptOptionalModule } from './prompt.ts'
import type { ModLike } from './registry.ts'
import { initResolveModuleSetup } from './setup-registry.ts'
import type { InitContext } from './types.ts'

interface OptionalModuleDeps {
  loadConfig?: (configFile: string) => Promise<Config | ConfigError>
  promptOptionalModule?: typeof initPromptOptionalModule
  resolveModuleSetup?: typeof initResolveModuleSetup
  runInstallsTx?: typeof initRunInstallsTx
  writeConfig?: (configFile: string, config: Config) => Promise<undefined | Error>
}

function initCtx(config: Config, paths: Paths): InitContext {
  return { config, logger: loggingCreateLogger('init'), paths }
}

async function rollbackModuleInstall(mod: ModLike, ctx: InitContext): Promise<void> {
  if (!mod.uninstall) return
  try {
    const error = await mod.uninstall(ctx)
    if (error instanceof Error) {
      ctx.logger.warn(`${mod.manifest.name} uninstall failed after setup error: ${error.message}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.warn(`${mod.manifest.name} uninstall failed after setup error: ${message}`)
  }
}

export async function initPersistModuleChoice(
  configFile: string,
  name: string,
  enabled: boolean,
  deps: OptionalModuleDeps = {},
): Promise<Config | OptionalModuleChoicePersistError> {
  const read = deps.loadConfig ?? configLoad
  const write = deps.writeConfig ?? configWrite
  try {
    const next = await read(configFile)
    if (next instanceof ConfigError) {
      return toOptionalModuleChoicePersistError(name, next)
    }
    next.modules[name] = enabled
    const writeResult = await write(configFile, next)
    if (writeResult instanceof Error) {
      return toOptionalModuleChoicePersistError(name, writeResult)
    }
    return next
  } catch (error) {
    return toOptionalModuleChoicePersistError(name, error)
  }
}

export async function initConfigureOptionalModules(
  config: Config,
  paths: Paths,
  candidates: readonly ModLike[],
  deps: OptionalModuleDeps = {},
): Promise<InitOptionalModuleError | undefined> {
  const ask = deps.promptOptionalModule ?? initPromptOptionalModule
  const setupFor = deps.resolveModuleSetup ?? initResolveModuleSetup
  const installTx = deps.runInstallsTx ?? initRunInstallsTx

  let current = config
  for (const mod of candidates) {
    const enabled = await ask(mod)
    if (enabled instanceof Error) {
      return toOptionalModuleSetupError(mod.manifest.name, enabled)
    }
    if (!enabled) {
      const persisted = await initPersistModuleChoice(
        paths.configFile,
        mod.manifest.name,
        false,
        deps,
      )
      if (persisted instanceof OptionalModuleChoicePersistError) {
        return persisted
      }
      current = persisted
      continue
    }

    const ctx = initCtx(current, paths)
    const setup = setupFor(mod.manifest.name)

    if (mod.install) {
      let installError: InitModuleInstallError | undefined
      try {
        installError = await installTx([mod], ctx)
      } catch (error) {
        await rollbackModuleInstall(mod, ctx)
        return toInitModuleInstallError(mod.manifest.name, error)
      }

      if (installError) {
        await rollbackModuleInstall(mod, ctx)
        return installError
      }
    }

    if (setup) {
      try {
        const configured = await setup(ctx)
        if (!configured) {
          if (mod.install) await rollbackModuleInstall(mod, ctx)
          return new OptionalModuleSetupError(
            mod.manifest.name,
            `${mod.manifest.name} setup did not complete`,
          )
        }
      } catch (error) {
        if (mod.install) await rollbackModuleInstall(mod, ctx)
        return toOptionalModuleSetupError(mod.manifest.name, error)
      }
    }

    const persisted = await initPersistModuleChoice(paths.configFile, mod.manifest.name, true, deps)
    if (persisted instanceof OptionalModuleChoicePersistError) {
      if (mod.install) await rollbackModuleInstall(mod, ctx)
      return persisted
    }
    current = persisted
  }
}
