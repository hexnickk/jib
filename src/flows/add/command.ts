import { CliError } from '@jib/cli'
import { configLoad, configLoadContext } from '@jib/config'
import { CancelledError, RollbackError } from '@jib/errors'
import { sourcesPreflightSelection } from '@jib/sources'
import { tuiIsInteractive, tuiPromptConfirmResult, tuiPromptSelectResult } from '@jib/tui'
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

export type AddCommandArgs = Parameters<typeof addGatherInputs>[0] & {
  app?: string
  source?: string
  branch?: string
}

/** Runs app registration and deployment, returning a typed error on failure. */
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

  try {
    const sequence = await addRunSequence(
      async () => {
        const draftApp = addBuildDraftApp(flowArgs, inputs)
        if (draftApp instanceof Error) {
          return draftApp
        }
        const result = await addRun(
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
          inspection.observer,
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
    addRenderResult(appName, addResult, deployResult)
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
