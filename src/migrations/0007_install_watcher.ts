import type { JibMigration } from './types.ts'
import { initCtx } from './types.ts'

export const m0007_install_watcher: JibMigration = {
  id: '0007_install_watcher',
  description: 'Install watcher service',
  up: async (ctx) => {
    const mctx = await initCtx(ctx)
    const { watcherInstallResult } = await import('@jib-module/watcher')
    const error = await watcherInstallResult(mctx)
    if (error) throw error
  },
}
