import { InternalError } from '@jib/errors'
import { tuiLog } from '@jib/tui'
import type { ModLike } from './registry.ts'
import type { InitContext } from './types.ts'

/** Rolls back installed modules after a later install failure, logging cleanup failures once. */
async function rollbackInstalls(installed: ModLike[], ctx: InitContext): Promise<void> {
  if (installed.length === 0) {
    return
  }

  tuiLog.warning(`install failed; rolling back ${installed.length} module(s)…`)
  for (const mod of [...installed].reverse()) {
    if (!mod.uninstall) {
      tuiLog.warning(`${mod.manifest.name}: no uninstall() — leaving in place`)
      continue
    }
    try {
      const error = await mod.uninstall(ctx)
      if (error instanceof Error) {
        tuiLog.warning(`${mod.manifest.name} uninstall failed: ${error.message}`)
        continue
      }
      tuiLog.info(`rolled back ${mod.manifest.name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      tuiLog.warning(`${mod.manifest.name} uninstall failed: ${message}`)
    }
  }
}

/** Installs modules transactionally and returns an internal error after rollback on failure. */
export async function initRunInstallsTx(
  mods: ModLike[],
  ctx: InitContext,
): Promise<InternalError | undefined> {
  const installed: ModLike[] = []

  for (const mod of mods) {
    if (!mod.install) {
      tuiLog.warning(`${mod.manifest.name}: no install() — skipping`)
      continue
    }

    try {
      const error = await mod.install(ctx)
      if (error instanceof Error) {
        await rollbackInstalls(installed, ctx)
        return new InternalError(error.message, { cause: error })
      }
      tuiLog.success(mod.manifest.name)
      installed.push(mod)
    } catch (error) {
      await rollbackInstalls(installed, ctx)
      const message = error instanceof Error ? error.message : String(error)
      return new InternalError(message, { cause: error })
    }
  }
}
