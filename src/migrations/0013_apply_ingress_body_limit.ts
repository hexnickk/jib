import type { JibMigration } from './types.ts'
import { initCtx } from './types.ts'

export const m0013_apply_ingress_body_limit: JibMigration = {
  id: '0013_apply_ingress_body_limit',
  description: 'Apply default ingress request body limit',
  up: async (ctx) => {
    const mctx = await initCtx(ctx)
    const { ingressApplyNginxConfig } = await import('../modules/ingress/backends/nginx/config.ts')
    const error = await ingressApplyNginxConfig(mctx.paths, mctx.config)
    // Migration hooks are framework-owned and report failures by throwing.
    if (error instanceof Error) throw error
  },
}
