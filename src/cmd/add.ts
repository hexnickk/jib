import {
  AddRolledBackError,
  CancelledAddError,
  addBuildDraftApp,
  addCreateDefaultSupport,
  addCreatePlanner,
  addGatherInputs,
  addNormalizeError,
  addResolveAppName,
  addRun,
  addRunSequence,
} from '@/flows/add/index.ts'
import {
  addNormalizeDeployError,
  addRenderResult,
  addRollbackApp,
  addTrapInterrupt,
} from '@/flows/add/runtime.ts'
import { DEFAULT_TIMEOUT_MS, runDeploy } from '@/flows/deploy/run.ts'
import { CliError, cliIsTextOutput } from '@jib/cli'
import { type App, ConfigError, configLoad, configLoadContext } from '@jib/config'
import { ingressClaim, ingressCreateOperator } from '@jib/ingress'
import type { Paths } from '@jib/paths'
import { sourcesPreflightSelection } from '@jib/sources'
import {
  tuiIsInteractive,
  tuiPromptConfirmResult,
  tuiPromptSelectResult,
  tuiSpinner,
} from '@jib/tui'
import type { AddCommandArgv } from './add-args.ts'
import { addCommandOptions } from './add-args.ts'
import { addChooseInitialSource, addCreateInspectionObserver } from './add-support.ts'
import type { CliCommand } from './command.ts'

const cliAddCommand = {
  command: 'add [app]',
  describe: 'Register and deploy a new app',
  builder: addCommandOptions,
  async run(args) {
    const loaded = await configLoadContext()
    if (loaded instanceof ConfigError) return loaded
    let { cfg, paths } = loaded
    const appName = await addResolveAppName(
      typeof args.app === 'string' ? args.app : undefined,
      cfg.apps,
    )
    if (appName instanceof Error) return appName
    const source = await addChooseInitialSource(
      cfg,
      paths,
      typeof args.source === 'string' ? args.source : undefined,
    )
    if (source instanceof Error) return source
    if (source.created) {
      const reloaded = await configLoad(paths.configFile)
      if (reloaded instanceof ConfigError) return reloaded
      cfg = reloaded
    }

    const inputs = await addGatherInputs(args)
    if (inputs instanceof Error) return inputs
    const planner = addCreatePlanner()
    const interrupt = addTrapInterrupt()
    const preflight = await sourcesPreflightSelection(
      appName,
      cfg,
      paths,
      inputs.repo,
      source.value,
      typeof args.branch === 'string' ? args.branch : undefined,
      {
        isInteractive: tuiIsInteractive,
        promptConfirm: tuiPromptConfirmResult,
        promptSelect: tuiPromptSelectResult,
      },
    )
    if (preflight instanceof Error) return preflight

    const flowArgs: { source?: string; branch?: string } = {
      branch: preflight.branch,
      ...(preflight.source ? { source: preflight.source } : {}),
    }
    const inspection = addCreateInspectionObserver()
    const addSupport = addCreateDefaultSupport({
      paths,
      claimIngress: (nextAppName, finalApp) => addClaimIngress(paths, nextAppName, finalApp),
    })

    try {
      const sequence = await addRunSequence(
        async () => {
          const draftApp = addBuildDraftApp(flowArgs, inputs)
          if (draftApp instanceof Error) return draftApp
          const result = await addRun(
            { support: addSupport, planner, observer: inspection.observer },
            {
              appName,
              args: flowArgs,
              cfg: preflight.cfg,
              configFile: paths.configFile,
              inputs,
              paths,
              draftApp,
              signal: {
                get cancelled() {
                  return interrupt.interrupted
                },
              },
            },
          )
          if (result instanceof CancelledAddError) return result
          if (result instanceof Error) return addNormalizeError(result, appName, paths.configFile)
          return result
        },
        (result) =>
          runDeploy(
            { ...preflight.cfg, apps: { ...preflight.cfg.apps, [appName]: result.finalApp } },
            paths,
            appName,
            undefined,
            DEFAULT_TIMEOUT_MS,
          ),
        (result) => addRollbackApp(paths, appName, preflight.cfg, result.finalApp),
        interrupt,
      )
      if (sequence instanceof CancelledAddError) {
        inspection.fail()
        return new CliError('cancelled', sequence.message)
      }
      if (sequence instanceof AddRolledBackError) {
        const original = interrupt.interrupted
          ? new CliError('cancelled', 'add cancelled')
          : sequence.original
        inspection.fail()
        return addNormalizeDeployError(original, appName, paths.configFile)
      }
      if (sequence instanceof Error) {
        inspection.fail()
        return sequence
      }
      const { addResult, deployResult } = sequence
      inspection.stop()
      return addRenderResult(appName, inputs.repo, addResult, deployResult)
    } finally {
      interrupt.dispose()
    }
  },
} satisfies CliCommand<AddCommandArgv>

/** Claims ingress for a newly added app while keeping spinner updates local to the command. */
async function addClaimIngress(paths: Paths, app: string, appCfg: App): Promise<undefined | Error> {
  const progress = cliIsTextOutput() ? tuiSpinner() : null
  progress?.start(`claiming ingress for ${app}`)
  const error = await ingressClaim(ingressCreateOperator(paths), app, appCfg, (update) =>
    progress?.message(update.message),
  )
  if (error instanceof Error) {
    progress?.stop('ingress failed')
    return error
  }
  progress?.stop('ingress ready')
  return undefined
}

export default cliAddCommand
