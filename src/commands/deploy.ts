import { withBus } from '@jib/bus'
import { loadAppOrExit } from '@jib/config'
import { CliError, isTextOutput } from '@jib/core'
import { type EvtDeployProgress, SUBJECTS, emitAndWait } from '@jib/rpc'
import { syncApp } from '@jib/sources'
import { spinner } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { applyCliArgs, withCliArgs } from './_cli.ts'

/**
 * `jib deploy <app>` — prepare the repo locally through the shared sources
 * package, then hand the resolved sha+path to the deployer over the bus.
 * A clack spinner renders progress for each stage.
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
    const { cfg, paths } = await loadAppOrExit(args.app)
    const timeoutMs = Number(args.timeout) || DEFAULT_TIMEOUT_MS
    const showProgress = isTextOutput()
    const s = showProgress ? spinner() : null

    try {
      s?.start(`[1/2] preparing ${args.app}`)
      const ready = await syncApp(cfg, paths, { app: args.app }, args.ref).catch((err) => {
        throw new CliError('deploy_failed', err instanceof Error ? err.message : String(err), {
          hint: 'fix repo access or ref selection, then retry `jib deploy ...`',
        })
      })
      s?.stop(`[1/2] repo ready @ ${ready.sha.slice(0, 8)}`)

      const result = await withBus(async (bus) => {
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
      if (err instanceof CliError) throw err
      throw new CliError('deploy_failed', err instanceof Error ? err.message : String(err), {
        hint: 'check logs: journalctl -u jib-deployer --since "5m ago"',
      })
    }
  },
})
