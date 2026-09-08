import { InternalError } from '@jib/errors'
import type { JibMigration } from './types.ts'
import { initCtx } from './types.ts'

export const m0007_install_watcher: JibMigration = {
  id: '0007_install_watcher',
  description: 'Install watcher service',
  async up(ctx) {
    const init = await initCtx(ctx)
    if (init instanceof Error) {
      return init
    }
    try {
      const { watcherInstallResult } = await import('@jib-module/watcher')
      return await watcherInstallResult(init)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new InternalError(`install watcher migration: ${message}`, { cause: error })
    }
  },
}
