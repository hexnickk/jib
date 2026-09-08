import { InternalError } from '@jib/errors'
import type { JibMigration } from './types.ts'
import { initCtx } from './types.ts'

export const m0008_install_nginx: JibMigration = {
  id: '0008_install_nginx',
  description: 'Install ingress reverse proxy',
  async up(ctx) {
    const init = await initCtx(ctx)
    if (init instanceof Error) {
      return init
    }
    try {
      const { ingressInstall } = await import('@jib/ingress')
      return await ingressInstall(init)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new InternalError(`install nginx migration: ${message}`, { cause: error })
    }
  },
}
