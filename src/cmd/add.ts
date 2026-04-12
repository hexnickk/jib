import { CliError, cliIsTextOutput } from '@jib/cli'
import { type App, type Config, ConfigError, configLoad, configLoadContext } from '@jib/config'
import { claimIngress, createIngressOperator } from '@jib/ingress'
import type { Paths } from '@jib/paths'
import { buildSourceChoices, preflightSourceSelection, runSourceSetup } from '@jib/sources'
import { isInteractive, promptConfirm, promptSelect, spinner } from '@jib/tui'
import { consola } from 'consola'
import { DEFAULT_TIMEOUT_MS, runDeploy } from '../deploy/run.ts'
import {
  AddService,
  CancelledAddError,
  DefaultAddSupport,
  RolledBackAddError,
  buildDraftApp,
  createAddPlanner,
  gatherAddInputs,
  normalizeAddError,
  resolveAddAppName,
  runAddSequence,
} from '../modules/add/index.ts'
import {
  normalizeAddDeployError,
  renderAddResult,
  rollbackAddedApp,
  trapInterrupt,
} from '../modules/add/runtime.ts'
import type { AddCommandArgv } from './add-args.ts'
import { addCommandOptions } from './add-args.ts'
import type { CliCommand } from './command.ts'
const cliAddCommand = {
  command: 'add [app]',
  describe: 'Register and deploy a new app',
  builder: addCommandOptions,
  async run(args) {
    const loaded = await configLoadContext()
    if (loaded instanceof ConfigError) return loaded
    let { cfg, paths } = loaded
    const appName = await resolveAddAppName(
      typeof args.app === 'string' ? args.app : undefined,
      cfg.apps,
    )
    const source = await addChooseInitialSource(
      cfg,
      paths,
      typeof args.source === 'string' ? args.source : undefined,
    )
    if (source.created) {
      const reloaded = await configLoad(paths.configFile)
      if (reloaded instanceof ConfigError) return reloaded
      cfg = reloaded
    }
    const inputs = await gatherAddInputs(args)
    const planner = createAddPlanner()
    const interrupt = trapInterrupt()
    const preflight = await preflightSourceSelection(
      appName,
      cfg,
      paths,
      inputs.repo,
      source.value,
      typeof args.branch === 'string' ? args.branch : undefined,
      { isInteractive, promptConfirm, promptSelect },
    )
    const flowArgs: { source?: string; branch?: string } = {
      branch: preflight.branch,
      ...(preflight.source ? { source: preflight.source } : {}),
    }
    const inspection = createInspectionObserver()
    const addService = new AddService(
      new DefaultAddSupport({
        paths,
        claimIngress: (nextAppName, finalApp) => addClaimIngress(paths, nextAppName, finalApp),
      }),
      planner,
      inspection.observer,
    )
    try {
      const { addResult, deployResult } = await runAddSequence(
        async () => {
          const result = await addService.run({
            appName,
            args: flowArgs,
            cfg: preflight.cfg,
            configFile: paths.configFile,
            inputs,
            paths,
            draftApp: buildDraftApp(flowArgs, inputs),
            signal: {
              get cancelled() {
                return interrupt.interrupted
              },
            },
          })
          if (result instanceof CancelledAddError) throw result
          if (result instanceof Error) throw normalizeAddError(result, appName, paths.configFile)
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
        (result) => rollbackAddedApp(paths, appName, preflight.cfg, result.finalApp),
        interrupt,
      )
      inspection.stop()
      return renderAddResult(appName, inputs.repo, addResult, deployResult)
    } catch (error) {
      inspection.fail()
      if (error instanceof CancelledAddError) return new CliError('cancelled', error.message)
      if (error instanceof RolledBackAddError) {
        const original = interrupt.interrupted
          ? new CliError('cancelled', 'add cancelled')
          : error.original
        return normalizeAddDeployError(original, appName, paths.configFile)
      }
      throw error
    } finally {
      interrupt.dispose()
    }
  },
} satisfies CliCommand<AddCommandArgv>

/** Claims ingress for a newly added app while keeping spinner updates local to the command. */
async function addClaimIngress(paths: Paths, app: string, appCfg: App): Promise<void> {
  const progress = cliIsTextOutput() ? spinner() : null
  progress?.start(`claiming ingress for ${app}`)
  try {
    await claimIngress(createIngressOperator(paths), app, appCfg, (update) =>
      progress?.message(update.message),
    )
    progress?.stop('ingress ready')
  } catch (error) {
    progress?.stop('ingress failed')
    throw error
  }
}

export interface AddChooseInitialSourceDeps {
  buildSourceChoices?: typeof buildSourceChoices
  isInteractive?: typeof isInteractive
  promptSelect?: typeof promptSelect
  runSourceSetup?: typeof runSourceSetup
}
/** Chooses the initial source, prompting only when the caller did not provide one. */
export async function addChooseInitialSource(
  cfg: Config,
  paths: Paths,
  currentSource?: string,
  deps: AddChooseInitialSourceDeps = {},
): Promise<{ value?: string; created: boolean }> {
  const interactive = deps.isInteractive ?? isInteractive
  const select = deps.promptSelect ?? promptSelect
  const sourceChoices = deps.buildSourceChoices ?? buildSourceChoices
  const setupSource = deps.runSourceSetup ?? runSourceSetup
  if (currentSource || !interactive())
    return currentSource ? { value: currentSource, created: false } : { created: false }
  const options = sourceChoices(cfg)
  if (options.length === 0) return { created: false }
  const choice = await select({
    message: 'Source for this app?',
    options: [{ value: 'none', label: 'None', hint: 'Public repo or local path' }, ...options],
  })
  if (choice === 'none') return { created: false }
  if (choice.startsWith('setup:')) {
    const created = await setupSource(cfg, paths, choice.slice('setup:'.length))
    if (!created) throw new CliError('cancelled', 'source setup did not complete; add cancelled')
    return { value: created, created: true }
  }
  return choice.startsWith('existing:')
    ? { value: choice.slice('existing:'.length), created: false }
    : { created: false }
}

/** Creates spinner-backed inspection callbacks for the add flow. */
function createInspectionObserver() {
  const progress = cliIsTextOutput() ? spinner() : null
  let active = false
  return {
    observer: {
      onStateChange: (state: string) => {
        if (!progress) return
        if (state === 'inputs_ready') {
          active = true
          progress.start('preparing repo')
        }
        if (state === 'repo_prepared') progress.message('inspecting docker-compose')
        if (state === 'compose_inspected' && active) {
          active = false
          progress.stop('compose inspected')
        }
      },
      warn: (message: string) => cliIsTextOutput() && consola.warn(message),
    },
    stop: () => {
      if (!progress || !active) return
      active = false
      progress.stop('compose inspected')
    },
    fail: () => {
      if (!progress || !active) return
      active = false
      progress.stop('inspection failed')
    },
  }
}
export default cliAddCommand
