import { SUBJECTS } from '@jib/rpc'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { emitLifecycle } from './lifecycle.ts'

export default defineCommand({
  meta: { name: 'down', description: 'Stop containers without removing app from config' },
  args: { app: { type: 'positional', required: true } },
  async run({ args }) {
    try {
      await emitLifecycle(
        args.app,
        SUBJECTS.cmd.appDown,
        SUBJECTS.evt.appDownSuccess,
        SUBJECTS.evt.appDownFailure,
      )
      consola.success(`stopped ${args.app}`)
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      consola.info('check running containers: docker ps --filter label=com.docker.compose.project')
      process.exit(1)
    }
  },
})
