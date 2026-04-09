import { withBus } from '@jib/bus'
import { loadAppOrExit } from '@jib/config'
import { CliError, isJsonOutput, isTextOutput } from '@jib/core'
import { type EvtDeployProgress, type EvtRepoProgress, SUBJECTS, emitAndWait } from '@jib/rpc'
import { spinner } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { applyCliArgs, withCliArgs } from './_cli.ts'

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
  args: withCliArgs({
    app: { type: 'positional', required: true },
    ref: { type: 'string', description: 'Git ref (SHA, branch, tag)' },
    timeout: {
      type: 'string',
      description: 'Timeout in milliseconds',
      default: String(DEFAULT_TIMEOUT_MS),
    },
  }),
  async run({ args }) {
    applyCliArgs(args)
    await loadAppOrExit(args.app)
    const timeoutMs = Number(args.timeout) || DEFAULT_TIMEOUT_MS

    try {
      const result = await withBus(async (bus) => {
        const showProgress = isTextOutput()
        const s = showProgress ? spinner() : null
        s?.start(`[1/2] preparing ${args.app}`)

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
            onProgress: (p: EvtRepoProgress) => s?.message(p.message),
          },
        )
        s?.stop(`[1/2] repo ready @ ${ready.sha.slice(0, 8)}`)

        const s2 = showProgress ? spinner() : null
        s2?.start(`[2/2] deploying ${args.app}`)
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
            onProgress: (p: EvtDeployProgress) => s2?.message(`${p.step}: ${p.message}`),
          },
        )
        s2?.stop(`[2/2] ${args.app} deployed @ ${result.sha.slice(0, 8)} (${result.durationMs}ms)`)
        return {
          app: args.app,
          workdir: ready.workdir,
          preparedSha: ready.sha,
          sha: result.sha,
          durationMs: result.durationMs,
        }
      })
      if (isTextOutput()) {
        consola.success(`${args.app} deployed @ ${result.sha.slice(0, 8)} (${result.durationMs}ms)`)
      }
      return result
    } catch (err) {
      throw new CliError('deploy_failed', err instanceof Error ? err.message : String(err), {
        hint: 'check logs: journalctl -u jib-deployer -u jib-gitsitter --since "5m ago"',
      })
    }
  },
})
