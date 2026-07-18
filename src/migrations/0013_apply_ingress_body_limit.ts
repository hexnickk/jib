import { InternalError } from '@jib/errors'
import type { JibMigration } from './types.ts'
import { initCtx } from './types.ts'

export const m0013_apply_ingress_body_limit: JibMigration = {
  id: '0013_apply_ingress_body_limit',
  description: 'Apply default ingress request body limit',
  async up(ctx) {
    const init = await initCtx(ctx)
    if (init instanceof Error) {
      return init
    }
    try {
      const { ingressApplyNginxConfig } = await import(
        '../modules/ingress/backends/nginx/config.ts'
      )
      return await ingressApplyNginxConfig(init.paths, init.config)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new InternalError(`apply ingress body limit: ${message}`, { cause: error })
    }
  },
}
