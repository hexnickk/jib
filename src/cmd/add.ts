import { CliError, applyCliArgs, isTextOutput } from '@jib/cli'
import { loadAppConfig, loadConfig } from '@jib/config'
import type { App } from '@jib/config'
import { claimIngress, createIngressOperator } from '@jib/ingress'
import type { Paths } from '@jib/paths'
import { buildSourceChoices, preflightSourceSelection, runSourceSetup } from '@jib/sources'
import { isInteractive, promptConfirm, promptSelect, spinner } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { DEFAULT_TIMEOUT_MS, runDeploy } from '../deploy/run.ts'
import {
  AddService,
  DefaultAddSupport,
  RolledBackAddError,
  buildDraftApp,
  createAddPlanner,
  gatherAddInputs,
  resolveAddAppName,
  runAddSequence,
} from '../modules/add/index.ts'
import {
  normalizeAddDeployError,
  renderAddResult,
  rollbackAddedApp,
  trapInterrupt,
} from '../modules/add/runtime.ts'
import { addCommandArgs } from './add-args.ts'

export default defineCommand({
  meta: { name: 'add', description: 'Register and deploy a new app' },
  args: addCommandArgs,
  async run({ args }) {
    applyCliArgs(args)

    let { cfg, paths } = await loadAppConfig()
    const appName = await resolveAddAppName(args.app, cfg.apps)
    const source = await chooseInitialSource(cfg, paths, args.source)
    if (source.created) cfg = await loadConfig(paths.configFile)

    const inputs = await gatherAddInputs(args)
    const planner = createAddPlanner()
    const interrupt = trapInterrupt()
    const preflight = await preflightSourceSelection(
      appName,
      cfg,
      paths,
      inputs.repo,
      source.value,
      args.branch,
      { isInteractive, promptConfirm, promptSelect },
    )
    const flowArgs: { source?: string; branch?: string } = {
      branch: preflight.branch,
      ...(preflight.source ? { source: preflight.source } : {}),
    }
    const inspection = createInspectionObserver(interrupt)
    const addService = new AddService(
      new DefaultAddSupport({
        paths,
        claimIngress: (appName, finalApp) => claimIngressForAdd(paths, appName, finalApp),
      }),
      planner,
      inspection.observer,
    )

    try {
      const { addResult, deployResult } = await runAddSequence(
        () =>
          addService.run({
            appName,
            args: flowArgs,
            cfg: preflight.cfg,
            configFile: paths.configFile,
            inputs,
            paths,
            draftApp: buildDraftApp(flowArgs, inputs),
          }),
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
      if (error instanceof RolledBackAddError) {
        const original = interrupt.interrupted
          ? new CliError('cancelled', 'add cancelled')
          : error.original
        throw normalizeAddDeployError(original, appName, paths.configFile)
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

export interface ChooseInitialSourceDeps {
  buildSourceChoices?: typeof buildSourceChoices
  isInteractive?: typeof isInteractive
  promptSelect?: typeof promptSelect
  runSourceSetup?: typeof runSourceSetup
}

export async function chooseInitialSource(
  cfg: Awaited<ReturnType<typeof loadAppConfig>>['cfg'],
  paths: Paths,
  currentSource?: string,
  deps: ChooseInitialSourceDeps = {},
): Promise<{ value?: string; created: boolean }> {
  const interactive = deps.isInteractive ?? isInteractive
  const select = deps.promptSelect ?? promptSelect
  const sourceChoices = deps.buildSourceChoices ?? buildSourceChoices
  const setupSource = deps.runSourceSetup ?? runSourceSetup

  if (currentSource || !interactive()) {
    return currentSource ? { value: currentSource, created: false } : { created: false }
  }
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

function createInspectionObserver(interrupt: ReturnType<typeof trapInterrupt>) {
  const spin = isTextOutput() ? spinner() : null
  let active = false
  return {
    observer: {
      onStateChange: (state: string) => {
        if (interrupt.interrupted) throw new CliError('cancelled', 'add cancelled')
        if (!spin) return
        if (state === 'inputs_ready') {
          active = true
          spin.start('preparing repo')
        }
        if (state === 'repo_prepared') spin.message('inspecting docker-compose')
        if (state === 'compose_inspected' && active) {
          active = false
          spin.stop('compose inspected')
        }
      },
      warn: (message: string) => {
        if (isTextOutput()) consola.warn(message)
      },
    },
    stop: () => {
      if (!spin || !active) return
      active = false
      spin.stop('compose inspected')
    },
    fail: () => {
      if (!spin || !active) return
      active = false
      spin.stop('inspection failed')
    },
  }
}
