import { SUBJECTS } from '@jib/rpc'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { emitLifecycle } from './lifecycle.ts'

export default defineCommand({
  meta: { name: 'restart', description: 'Restart containers without redeploying' },
  args: { app: { type: 'positional', required: true } },
  async run({ args }) {
    try {
      await emitLifecycle(
        args.app,
        SUBJECTS.cmd.appRestart,
        SUBJECTS.evt.appRestartSuccess,
        SUBJECTS.evt.appRestartFailure,
      )
      consola.success(`restarted ${args.app}`)
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      consola.info('check logs: journalctl -u jib-deployer --since "5m ago"')
      process.exit(1)
    }
  },
})
