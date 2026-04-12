import type { JibMigration } from './types.ts'
import { initCtx } from './types.ts'

export const m0008_install_nginx: JibMigration = {
  id: '0008_install_nginx',
  description: 'Install ingress reverse proxy',
  up: async (ctx) => {
    const mctx = await initCtx(ctx)
    const { install } = await import('@jib/ingress')
    await install(mctx)
  },
}
