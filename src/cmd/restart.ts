import { loadAppOrExit } from '@jib/config'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { applyCliArgs, withCliArgs } from '../modules/runtime/cli-runtime.ts'
import { createDeployEngine } from '../modules/runtime/deploy-engine.ts'

export default defineCommand({
  meta: { name: 'restart', description: 'Restart containers without redeploying' },
  args: withCliArgs({ app: { type: 'positional', required: true } }),
  async run({ args }) {
    try {
      applyCliArgs(args)
      const { cfg, paths } = await loadAppOrExit(args.app)
      await createDeployEngine(cfg, paths, 'restart').restart(args.app)
      consola.success(`restarted ${args.app}`)
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      consola.info('check running containers: docker ps --filter label=com.docker.compose.project')
      process.exit(1)
    }
  },
})
