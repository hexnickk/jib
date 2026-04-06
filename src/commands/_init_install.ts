import type { Config } from '@jib/config'
import type { ModuleContext } from '@jib/core'
import { consola } from 'consola'

export interface ModLike {
  manifest: { name: string }
  install?: (ctx: ModuleContext<Config>) => Promise<void>
  uninstall?: (ctx: ModuleContext<Config>) => Promise<void>
}

/**
 * Install every module in `mods` in order. On the first failure, walk the
 * already-installed set in reverse and call each module's `uninstall()` as
 * best-effort rollback, so the host is either fully initialized or fully
 * unchanged. Each rollback step is independently try/catch'd — a failing
 * uninstall doesn't abort the rest; we just log and continue. Re-throws
 * the original install error once rollback finishes so callers can surface
 * it and exit.
 */
export async function runInstallsTx(mods: ModLike[], ctx: ModuleContext<Config>): Promise<void> {
  const installed: ModLike[] = []
  try {
    for (const m of mods) {
      if (!m.install) {
        consola.warn(`${m.manifest.name}: no install() — skipping`)
        continue
      }
      await m.install(ctx)
      consola.success(`${m.manifest.name}`)
      installed.push(m)
    }
  } catch (err) {
    if (installed.length > 0) {
      consola.warn(`install failed; rolling back ${installed.length} module(s)…`)
      for (const m of [...installed].reverse()) {
        if (!m.uninstall) {
          consola.warn(`${m.manifest.name}: no uninstall() — leaving in place`)
          continue
        }
        try {
          await m.uninstall(ctx)
          consola.info(`rolled back ${m.manifest.name}`)
        } catch (e) {
          const em = e instanceof Error ? e.message : String(e)
          consola.warn(`${m.manifest.name} uninstall failed: ${em}`)
        }
      }
    }
    throw err
  }
}
