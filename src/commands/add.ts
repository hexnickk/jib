import { loadAppConfig } from '@jib/config'
import type { App } from '@jib/config'
import { CliError, type Paths, ValidationError, isTextOutput } from '@jib/core'
import {
  AddService,
  DefaultAddSupport,
  RolledBackAddError,
  buildDraftApp,
  createAddPlanner,
  gatherAddInputs,
  runAddSequence,
} from '@jib/flows'
import { claimIngress } from '@jib/ingress'
import { preflightSourceSelection } from '@jib/sources'
import { spinner } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import {
  normalizeAddDeployError,
  renderAddResult,
  rollbackAddedApp,
  trapInterrupt,
} from '../add-runtime.ts'
import { applyCliArgs, withCliArgs } from '../cli-runtime.ts'
import { DEFAULT_TIMEOUT_MS, runDeploy } from '../deploy-run.ts'
import { createIngressOperator } from '../ingress-operator.ts'

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

export default defineCommand({
  meta: { name: 'add', description: 'Register and deploy a new app' },
  args: withCliArgs({
    app: { type: 'positional', required: true },
    repo: {
      type: 'string',
      description: 'Git repo: "owner/name", "local", file:// URL, http(s):// URL, or absolute path',
    },
    source: { type: 'string', description: 'Configured source ref name' },
    branch: { type: 'string', description: 'Git branch to track (defaults to the repo default)' },
    ingress: {
      type: 'string',
      default: 'direct',
      description: 'Default ingress: direct|cloudflare-tunnel',
    },
    compose: { type: 'string', description: 'Compose file (comma-separated)' },
    domain: {
      type: 'string',
      description:
        'host=<domain>[,port=<port>][,service=<name>][,ingress=direct|cloudflare-tunnel] (repeatable)',
    },
    env: { type: 'string', description: 'KEY=VALUE secret (repeatable)' },
    health: { type: 'string', description: '/path:port (repeatable via comma)' },
  }),
  async run({ args }) {
    applyCliArgs(args)
    if (!APP_NAME_RE.test(args.app)) {
      throw new ValidationError(`app name "${args.app}" must match ${APP_NAME_RE}`)
    }

    const { cfg, paths } = await loadAppConfig()
    if (cfg.apps[args.app]) {
      throw new ValidationError(`app "${args.app}" already exists in config`)
    }

    const inputs = await gatherAddInputs(args)
    const planner = createAddPlanner()
    const interrupt = trapInterrupt()
    const preflight = await preflightSourceSelection(
      args.app,
      cfg,
      paths,
      inputs.repo,
      args.source,
      args.branch,
    )
    const flowArgs: { source?: string; branch?: string } = {
      branch: preflight.branch,
      ...(preflight.source ? { source: preflight.source } : {}),
    }
    const addService = new AddService(
      new DefaultAddSupport({
        paths,
        claimIngress: (appName, finalApp) => claimIngressForAdd(paths, appName, finalApp),
      }),
      planner,
      {
        onStateChange: () => {
          if (interrupt.interrupted) throw new ValidationError('cancelled')
        },
        warn: (message) => {
          if (isTextOutput()) consola.warn(message)
        },
      },
    )

    try {
      const { addResult, deployResult } = await runAddSequence(
        () =>
          addService.run({
            appName: args.app,
            args: flowArgs,
            cfg: preflight.cfg,
            configFile: paths.configFile,
            inputs,
            draftApp: buildDraftApp(flowArgs, inputs),
          }),
        (result) =>
          runDeploy(
            { ...preflight.cfg, apps: { ...preflight.cfg.apps, [args.app]: result.finalApp } },
            paths,
            args.app,
            undefined,
            DEFAULT_TIMEOUT_MS,
          ),
        (result) => rollbackAddedApp(paths, args.app, preflight.cfg, result.finalApp),
        interrupt,
      )
      return renderAddResult(args.app, inputs.repo, addResult, deployResult)
    } catch (error) {
      if (error instanceof RolledBackAddError) {
        const original = interrupt.interrupted
          ? new CliError('cancelled', 'add cancelled')
          : error.original
        throw normalizeAddDeployError(original, args.app, paths.configFile)
      }
      throw error
    } finally {
      interrupt.dispose()
    }
  },
})

async function claimIngressForAdd(paths: Paths, app: string, appCfg: App): Promise<void> {
  const s = isTextOutput() ? spinner() : null
  s?.start(`claiming ingress for ${app}`)
  try {
    await claimIngress(createIngressOperator(paths), app, appCfg, (progress) =>
      s?.message(progress.message),
    )
    s?.stop('ingress ready')
  } catch (error) {
    s?.stop('ingress failed')
    throw error
  }
}
