import { SUBJECTS } from '@jib/rpc'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { emitLifecycle } from './lifecycle.ts'

export default defineCommand({
  meta: { name: 'up', description: 'Start existing containers without rebuilding' },
  args: { app: { type: 'positional', required: true } },
  async run({ args }) {
    try {
      await emitLifecycle(
        args.app,
        SUBJECTS.cmd.appUp,
        SUBJECTS.evt.appUpSuccess,
        SUBJECTS.evt.appUpFailure,
      )
      consola.success(`started ${args.app}`)
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      consola.info('check logs: journalctl -u jib-deployer --since "5m ago"')
      process.exit(1)
    }
  },
})
