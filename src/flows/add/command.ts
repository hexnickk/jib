import { CliError } from '@jib/cli'
import { type App, configLoad, configLoadContext } from '@jib/config'
import { CancelledError, type JibError, RollbackError, errorsToJibError } from '@jib/errors'
import { ingressClaim, ingressCreateOperator } from '@jib/ingress'
import type { Paths } from '@jib/paths'
import { sourcesPreflightSelection } from '@jib/sources'
import {
  tuiIsInteractive,
  tuiPromptConfirmResult,
  tuiPromptSelectResult,
  tuiSpinner,
} from '@jib/tui'
import { runDeploy } from '../deploy/run.ts'
import { addBuildDraftApp } from './app.ts'
import { addChooseInitialSource, addCreateInspectionObserver } from './command-support.ts'
import { addNormalizeError } from './errors.ts'
import { addGatherInputs, addResolveAppName } from './inputs.ts'
import { addRun } from './run.ts'
import {
  addNormalizeDeployError,
  addRenderResult,
  addRollbackApp,
  addTrapInterrupt,
} from './runtime.ts'
import { addRunSequence } from './sequence.ts'
import { addCreateDefaultSupport } from './support.ts'

export type AddCommandArgs = Parameters<typeof addGatherInputs>[0] & {
  app?: string
  source?: string
  branch?: string
}

/** Runs the add command flow and returns either a result payload or a typed error. */
export async function addRunCommand(args: AddCommandArgs) {
  const loaded = await prepareCommandInputs(args)
  if (loaded instanceof Error) {
    return loaded
  }
  const { cfg, paths, appName, source, inputs } = loaded
  const interrupt = addTrapInterrupt()
  const preflight = await sourcesPreflightSelection(
    { cfg, paths },
    {
      app: appName,
      repo: inputs.repo,
      source: source.value,
      branch: typeof args.branch === 'string' ? args.branch : undefined,
    },
    {
      isInteractive: tuiIsInteractive,
      promptConfirm: tuiPromptConfirmResult,
      promptSelect: tuiPromptSelectResult,
    },
  )
  if (preflight instanceof Error) {
    return preflight
  }

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
        if (draftApp instanceof Error) {
          return draftApp
        }
        const result = await addRun(
          { support: addSupport, observer: inspection.observer },
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
        if (result instanceof Error && !(result instanceof CancelledError)) {
          return addNormalizeError(result, appName, paths.configFile)
        }
        return result
      },
      (result) =>
        runDeploy(
          {
            cfg: { ...preflight.cfg, apps: { ...preflight.cfg.apps, [appName]: result.finalApp } },
            paths,
          },
          appName,
        ),
      (result) => addRollbackApp(paths, appName, preflight.cfg, result.finalApp),
      interrupt,
    )
    if (sequence instanceof CancelledError) {
      inspection.fail()
      return new CliError('cancelled', sequence.message)
    }
    if (sequence instanceof RollbackError) {
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
}

/** Resolves the app, source setup, and validated inputs before starting registration. */
async function prepareCommandInputs(args: AddCommandArgs) {
  const loaded = await configLoadContext()
  if (loaded instanceof Error) {
    return loaded
  }
  const { paths } = loaded
  let { cfg } = loaded
  const appName = await addResolveAppName(
    typeof args.app === 'string' ? args.app : undefined,
    cfg.apps,
  )
  if (appName instanceof Error) {
    return appName
  }
  const source = await addChooseInitialSource(
    cfg,
    paths,
    typeof args.source === 'string' ? args.source : undefined,
  )
  if (source instanceof Error) {
    return source
  }
  if (source.created) {
    const reloaded = await configLoad(paths.configFile)
    if (reloaded instanceof Error) {
      return reloaded
    }
    cfg = reloaded
  }
  const inputs = await addGatherInputs(args)
  if (inputs instanceof Error) {
    return inputs
  }
  return { cfg, paths, appName, source, inputs }
}

/** Claims ingress for a newly added app while keeping spinner updates local to the command. */
async function addClaimIngress(
  paths: Paths,
  app: string,
  appCfg: App,
): Promise<undefined | JibError> {
  const progress = tuiSpinner()
  progress.start(`claiming ingress for ${app}`)
  const error = await ingressClaim(ingressCreateOperator(paths), app, appCfg, (update) =>
    progress.message(update.message),
  )
  if (error instanceof Error) {
    progress.stop('ingress failed')
    return errorsToJibError(error)
  }
  progress.stop('ingress ready')
  return undefined
}
