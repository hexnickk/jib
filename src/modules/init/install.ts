import { log } from '@jib/tui'
import { toInitModuleInstallError } from './errors.ts'
import type { InitModuleInstallError } from './errors.ts'
import type { ModLike } from './registry.ts'
import type { InitContext } from './types.ts'

async function rollbackInstalls(installed: ModLike[], ctx: InitContext): Promise<void> {
  if (installed.length === 0) return

  log.warning(`install failed; rolling back ${installed.length} module(s)…`)
  for (const mod of [...installed].reverse()) {
    if (!mod.uninstall) {
      log.warning(`${mod.manifest.name}: no uninstall() — leaving in place`)
      continue
    }
    try {
      await mod.uninstall(ctx)
      log.info(`rolled back ${mod.manifest.name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warning(`${mod.manifest.name} uninstall failed: ${message}`)
    }
  }
}

export async function initRunInstallsTx(
  mods: ModLike[],
  ctx: InitContext,
): Promise<InitModuleInstallError | undefined> {
  const installed: ModLike[] = []

  for (const mod of mods) {
    if (!mod.install) {
      log.warning(`${mod.manifest.name}: no install() — skipping`)
      continue
    }

    try {
      await mod.install(ctx)
      log.success(mod.manifest.name)
      installed.push(mod)
    } catch (error) {
      await rollbackInstalls(installed, ctx)
      return toInitModuleInstallError(mod.manifest.name, error)
    }
  }
}
