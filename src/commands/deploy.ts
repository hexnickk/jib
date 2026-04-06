import { withBus } from '@jib/bus'
import { type EvtDeployProgress, type EvtRepoProgress, SUBJECTS, emitAndWait } from '@jib/rpc'
import { spinner } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { loadAppOrExit } from './_ctx.ts'

/**
 * `jib deploy <app>` — the canonical two-step deploy flow. The CLI is the
 * orchestrator: first asks gitsitter to prepare the workdir, then hands the
 * resolved sha+path to the deployer. A clack spinner renders progress
 * events for the operator while each stage runs.
 */

const DEFAULT_TIMEOUT_MS = 5 * 60_000

function currentUser(): string {
  return process.env.USER ?? process.env.LOGNAME ?? 'jib'
}

export default defineCommand({
  meta: { name: 'deploy', description: 'Build and deploy an app' },
  args: {
    app: { type: 'positional', required: true },
    ref: { type: 'string', description: 'Git ref (SHA, branch, tag)' },
    'dry-run': { type: 'boolean', description: 'Prepare repo but skip actual deploy' },
    timeout: {
      type: 'string',
      description: 'Timeout in milliseconds',
      default: String(DEFAULT_TIMEOUT_MS),
    },
  },
  async run({ args }) {
    await loadAppOrExit(args.app)
    const timeoutMs = Number(args.timeout) || DEFAULT_TIMEOUT_MS

    try {
      await withBus(async (bus) => {
        const s = spinner()
        s.start(`[1/2] preparing ${args.app}`)

        const prepBody: { app: string; ref?: string } = { app: args.app }
        if (args.ref) prepBody.ref = args.ref

        const ready = await emitAndWait(
          bus,
          SUBJECTS.cmd.repoPrepare,
          prepBody,
          { success: SUBJECTS.evt.repoReady, failure: SUBJECTS.evt.repoFailed },
          SUBJECTS.evt.repoProgress,
          {
            source: 'cli',
            timeoutMs,
            onProgress: (p: EvtRepoProgress) => s.message(p.message),
          },
        )
        s.stop(`[1/2] repo ready @ ${ready.sha.slice(0, 8)}`)

        if (args['dry-run']) {
          consola.info(`[dry-run] prepared ${ready.workdir} @ ${ready.sha}`)
          return
        }

        const s2 = spinner()
        s2.start(`[2/2] deploying ${args.app}`)
        const result = await emitAndWait(
          bus,
          SUBJECTS.cmd.deploy,
          {
            app: args.app,
            workdir: ready.workdir,
            sha: ready.sha,
            trigger: 'manual',
            user: currentUser(),
          },
          { success: SUBJECTS.evt.deploySuccess, failure: SUBJECTS.evt.deployFailure },
          SUBJECTS.evt.deployProgress,
          {
            source: 'cli',
            timeoutMs,
            onProgress: (p: EvtDeployProgress) => s2.message(`${p.step}: ${p.message}`),
          },
        )
        s2.stop(`[2/2] ${args.app} deployed @ ${result.sha.slice(0, 8)} (${result.durationMs}ms)`)
      })
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      consola.info('check logs: journalctl -u jib-deployer -u jib-gitsitter --since "5m ago"')
      process.exit(1)
    }
  },
})
