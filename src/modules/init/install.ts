import { log } from '@jib/tui'
import type { ModLike } from './registry.ts'
import type { InitContext } from './types.ts'

/**
 * Install every module in `mods` in order. On the first failure, walk the
 * already-installed set in reverse and call each module's `uninstall()` as
 * best-effort rollback. Re-throws the original install error.
 */
export async function runInstallsTx(mods: ModLike[], ctx: InitContext): Promise<void> {
  const installed: ModLike[] = []
  try {
    for (const m of mods) {
      if (!m.install) {
        log.warning(`${m.manifest.name}: no install() — skipping`)
        continue
      }
      await m.install(ctx)
      log.success(m.manifest.name)
      installed.push(m)
    }
  } catch (err) {
    if (installed.length > 0) {
      log.warning(`install failed; rolling back ${installed.length} module(s)…`)
      for (const m of [...installed].reverse()) {
        if (!m.uninstall) {
          log.warning(`${m.manifest.name}: no uninstall() — leaving in place`)
          continue
        }
        try {
          await m.uninstall(ctx)
          log.info(`rolled back ${m.manifest.name}`)
        } catch (e) {
          const em = e instanceof Error ? e.message : String(e)
          log.warning(`${m.manifest.name} uninstall failed: ${em}`)
        }
      }
    }
    throw err
  }
}
