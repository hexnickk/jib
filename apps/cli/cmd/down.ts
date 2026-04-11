import { loadAppOrExit } from '@jib/config'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { applyCliArgs, withCliArgs } from '../modules/runtime/cli-runtime.ts'
import { createDeployEngine } from '../modules/runtime/deploy-engine.ts'

export default defineCommand({
  meta: { name: 'down', description: 'Stop containers without removing app from config' },
  args: withCliArgs({ app: { type: 'positional', required: true } }),
  async run({ args }) {
    try {
      applyCliArgs(args)
      const { cfg, paths } = await loadAppOrExit(args.app)
      await createDeployEngine(cfg, paths, 'down').down(args.app)
      consola.success(`stopped ${args.app}`)
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      consola.info('check running containers: docker ps --filter label=com.docker.compose.project')
      process.exit(1)
    }
  },
})
