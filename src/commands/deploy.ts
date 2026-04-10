import { loadAppOrExit } from '@jib/config'
import { CliError, isTextOutput } from '@jib/core'
import { syncApp } from '@jib/sources'
import { spinner } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { createDeployEngine } from '../deploy-engine.ts'
import { applyCliArgs, withCliArgs } from './_cli.ts'

/**
 * `jib deploy <app>` — prepare the repo locally through the shared sources
 * package, then hand the resolved sha+path to the shared deploy engine.
 * A clack spinner renders progress for each stage.
 */

const DEFAULT_TIMEOUT_MS = 5 * 60_000

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

      const engine = createDeployEngine(cfg, paths)
      const s2 = showProgress ? spinner() : null
      s2?.start(`[2/2] deploying ${args.app}`)
      const deployed = await withTimeout(
        engine.deploy(
          { app: args.app, workdir: ready.workdir, sha: ready.sha, trigger: 'manual' },
          { emit: (step, message) => s2?.message(`${step}: ${message}`) },
        ),
        timeoutMs,
      )
      s2?.stop(
        `[2/2] ${args.app} deployed @ ${deployed.deployedSHA.slice(0, 8)} (${deployed.durationMs}ms)`,
      )
      const result = {
        app: args.app,
        workdir: ready.workdir,
        preparedSha: ready.sha,
        sha: deployed.deployedSHA,
        durationMs: deployed.durationMs,
      }
      if (isTextOutput()) {
        consola.success(`${args.app} deployed @ ${result.sha.slice(0, 8)} (${result.durationMs}ms)`)
      }
      return result
    } catch (err) {
      if (err instanceof CliError) throw err
      throw new CliError('deploy_failed', err instanceof Error ? err.message : String(err), {
        hint: 'check docker compose output, then retry `jib deploy ...`',
      })
    }
  },
})

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`deploy timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
