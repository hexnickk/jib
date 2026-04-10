import { loadAppOrExit } from '@jib/config'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { applyCliArgs, withCliArgs } from '../../../src/cli-runtime.ts'
import { createDeployEngine } from '../../../src/deploy-engine.ts'

export default defineCommand({
  meta: { name: 'up', description: 'Start existing containers without rebuilding' },
  args: withCliArgs({ app: { type: 'positional', required: true } }),
  async run({ args }) {
    try {
      applyCliArgs(args)
      const { cfg, paths } = await loadAppOrExit(args.app)
      await createDeployEngine(cfg, paths, 'up').up(args.app)
      consola.success(`started ${args.app}`)
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      consola.info('check running containers: docker ps --filter label=com.docker.compose.project')
      process.exit(1)
    }
  },
})
