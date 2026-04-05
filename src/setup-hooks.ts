import * as cloudflareMod from '@jib-module/cloudflare'
import * as nginxMod from '@jib-module/nginx'
import type { Config } from '@jib/config'
import type { ModuleContext, ModuleManifest, SetupHook } from '@jib/core'

/**
 * Statically-imported hook registry. The CLI's setup phase runs in-process
 * (unlike deploy, which goes via NATS) so hooks are direct imports. Listing
 * modules here — rather than discovering via the loader — keeps
 * `bun build --compile` happy and makes the dependency tree explicit.
 */
export interface HookEntry {
  manifest: ModuleManifest
  hooks: SetupHook<Config>
}

export const DEFAULT_REGISTRY: HookEntry[] = [
  { manifest: cloudflareMod.manifest, hooks: cloudflareMod.setupHooks },
  { manifest: nginxMod.manifest, hooks: nginxMod.setupHooks },
]

type Ctx = ModuleContext<Config>
type Phase = 'add' | 'remove'

function order(registry: HookEntry[], phase: Phase): HookEntry[] {
  const entries = [...registry].sort(
    (a, b) => (a.manifest.installOrder ?? 100) - (b.manifest.installOrder ?? 100),
  )
  return phase === 'add' ? entries : entries.reverse()
}

/**
 * Runs every module's setup hook for `phase`, in `installOrder`-ordered
 * sequence (ascending on add, descending on remove).
 *
 * On add: if any hook throws, previously-completed hooks are rolled back by
 * calling their `onAppRemove` in reverse. On remove: every hook is
 * best-effort; errors are logged and removal continues so operators can
 * finish teardown even when a single integration is broken.
 *
 * `registry` is injected (defaulting to {@link DEFAULT_REGISTRY}) so tests
 * can supply fake hooks without touching module mocks. Hooks look the app
 * up from `ctx.config.apps[app]`, so callers must pass a `ctx` whose config
 * already reflects the intended post-add/post-remove state.
 */
export async function runSetupHooks(
  ctx: Ctx,
  app: string,
  phase: Phase,
  registry: HookEntry[] = DEFAULT_REGISTRY,
): Promise<void> {
  const entries = order(registry, phase)
  const completed: HookEntry[] = []

  for (const entry of entries) {
    const fn = phase === 'add' ? entry.hooks.onAppAdd : entry.hooks.onAppRemove
    if (!fn) continue
    try {
      await fn(ctx, app)
      completed.push(entry)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (phase === 'remove') {
        ctx.logger.warn(`${entry.manifest.name} onAppRemove failed: ${msg}`)
        continue
      }
      ctx.logger.error(`${entry.manifest.name} onAppAdd failed: ${msg}`)
      for (const done of completed.reverse()) {
        try {
          await done.hooks.onAppRemove?.(ctx, app)
        } catch (rbErr) {
          const rbMsg = rbErr instanceof Error ? rbErr.message : String(rbErr)
          ctx.logger.warn(`${done.manifest.name} rollback failed: ${rbMsg}`)
        }
      }
      throw err
    }
  }
}
