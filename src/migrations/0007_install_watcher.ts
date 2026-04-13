import type { JibMigration } from './types.ts'
import { initCtx } from './types.ts'

export const m0007_install_watcher: JibMigration = {
  id: '0007_install_watcher',
  description: 'Install watcher service',
  up: async (ctx) => {
    const mctx = await initCtx(ctx)
    const { watcherInstall } = await import('@jib-module/watcher')
    await watcherInstall(mctx)
  },
}
