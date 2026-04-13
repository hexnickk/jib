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
import { runInstallsTxResult } from './install.ts'
import { type ModLike, promptOptionalModule } from './registry.ts'
import { resolveModuleSetup } from './setup-registry.ts'
import type { InitContext } from './types.ts'

interface OptionalModuleDeps {
  loadConfig?: (configFile: string) => Promise<Config | ConfigError>
  promptOptionalModule?: typeof promptOptionalModule
  resolveModuleSetup?: typeof resolveModuleSetup
  runInstallsTxResult?: typeof runInstallsTxResult
  writeConfig?: (configFile: string, config: Config) => Promise<undefined | Error>
}

function initCtx(config: Config, paths: Paths): InitContext {
  return { config, logger: loggingCreateLogger('init'), paths }
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
  const result = await persistModuleChoiceResult(configFile, name, enabled, deps)
  if (result instanceof OptionalModuleChoicePersistError) {
    throw result
  }
  return result
}

export async function persistModuleChoiceResult(
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

export async function configureOptionalModules(
  config: Config,
  paths: Paths,
  candidates: readonly ModLike[],
  deps: OptionalModuleDeps = {},
): Promise<void> {
  const error = await configureOptionalModulesResult(config, paths, candidates, deps)
  if (error instanceof Error) {
    throw error
  }
}

export async function configureOptionalModulesResult(
  config: Config,
  paths: Paths,
  candidates: readonly ModLike[],
  deps: OptionalModuleDeps = {},
): Promise<InitOptionalModuleError | undefined> {
  const ask = deps.promptOptionalModule ?? promptOptionalModule
  const setupFor = deps.resolveModuleSetup ?? resolveModuleSetup
  const installTx = deps.runInstallsTxResult ?? runInstallsTxResult

  let current = config
  for (const mod of candidates) {
    const enabled = await ask(mod)
    if (!enabled) {
      const persisted = await persistModuleChoiceResult(
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

    const persisted = await persistModuleChoiceResult(
      paths.configFile,
      mod.manifest.name,
      true,
      deps,
    )
    if (persisted instanceof OptionalModuleChoicePersistError) {
      if (mod.install) await rollbackModuleInstall(mod, ctx)
      return persisted
    }
    current = persisted
  }
}
