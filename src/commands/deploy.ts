import { loadAppOrExit } from '@jib/config'
import { isTextOutput } from '@jib/core'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { applyCliArgs, withCliArgs } from './_cli.ts'
import { DEFAULT_TIMEOUT_MS, runDeploy } from './deploy-run.ts'

/**
 * `jib deploy <app>` — prepare the repo locally through the shared sources
 * package, then hand the resolved sha+path to the shared deploy engine.
 * A clack spinner renders progress for each stage.
 */

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
    const result = await runDeploy(cfg, paths, args.app, args.ref, timeoutMs)
    if (isTextOutput()) {
      consola.success(`${args.app} deployed @ ${result.sha.slice(0, 8)} (${result.durationMs}ms)`)
    }
    return result
  },
})
