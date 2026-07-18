import { type Config, configLoad, configWrite } from '@jib/config'
import { InternalError, type JibError } from '@jib/errors'
import { loggingCreateLogger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { initRunInstallsTx } from './install.ts'
import { initPromptOptionalModule } from './prompt.ts'
import type { ModLike } from './registry.ts'
import { initResolveModuleSetup } from './setup-registry.ts'
import type { InitContext } from './types.ts'

interface OptionalModuleDeps {
  loadConfig?: (configFile: string) => Promise<Config | JibError>
  promptOptionalModule?: typeof initPromptOptionalModule
  resolveModuleSetup?: typeof initResolveModuleSetup
  runInstallsTx?: typeof initRunInstallsTx
  writeConfig?: (configFile: string, config: Config) => Promise<undefined | JibError>
}

function initCtx(config: Config, paths: Paths): InitContext {
  return { config, logger: loggingCreateLogger('init'), paths }
}

/** Rolls back one module after setup failure and logs cleanup failures at the owning init boundary. */
async function rollbackModuleInstall(mod: ModLike, ctx: InitContext): Promise<void> {
  if (!mod.uninstall) {
    return
  }
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

/** Persists one optional-module choice and returns the updated config or an internal error. */
export async function initPersistModuleChoice(
  configFile: string,
  name: string,
  enabled: boolean,
  deps: OptionalModuleDeps = {},
): Promise<Config | JibError> {
  const read = deps.loadConfig ?? configLoad
  const write = deps.writeConfig ?? configWrite
  try {
    const next = await read(configFile)
    if (next instanceof Error) {
      return next
    }
    next.modules[name] = enabled
    const writeResult = await write(configFile, next)
    if (writeResult instanceof Error) {
      return writeResult
    }
    return next
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(message, { cause: error })
  }
}

/** Installs, configures, and persists optional modules one at a time. */
export async function initConfigureOptionalModules(
  config: Config,
  paths: Paths,
  candidates: readonly ModLike[],
  deps: OptionalModuleDeps = {},
): Promise<JibError | undefined> {
  const ask = deps.promptOptionalModule ?? initPromptOptionalModule
  const setupFor = deps.resolveModuleSetup ?? initResolveModuleSetup
  const installTx = deps.runInstallsTx ?? initRunInstallsTx

  let current = config
  for (const mod of candidates) {
    const enabled = await ask(mod)
    if (enabled instanceof Error) {
      return enabled
    }
    if (!enabled) {
      const persisted = await initPersistModuleChoice(
        paths.configFile,
        mod.manifest.name,
        false,
        deps,
      )
      if (persisted instanceof Error) {
        return persisted
      }
      current = persisted
      continue
    }

    const ctx = initCtx(current, paths)
    const setup = setupFor(mod.manifest.name)

    if (mod.install) {
      let installError: JibError | undefined
      try {
        installError = await installTx([mod], ctx)
      } catch (error) {
        await rollbackModuleInstall(mod, ctx)
        const message = error instanceof Error ? error.message : String(error)
        return new InternalError(message, { cause: error })
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
          if (mod.install) {
            await rollbackModuleInstall(mod, ctx)
          }
          return new InternalError(`${mod.manifest.name} setup did not complete`)
        }
      } catch (error) {
        if (mod.install) {
          await rollbackModuleInstall(mod, ctx)
        }
        const message = error instanceof Error ? error.message : String(error)
        return new InternalError(message, { cause: error })
      }
    }

    const persisted = await initPersistModuleChoice(paths.configFile, mod.manifest.name, true, deps)
    if (persisted instanceof Error) {
      if (mod.install) {
        await rollbackModuleInstall(mod, ctx)
      }
      return persisted
    }
    current = persisted
  }
}
