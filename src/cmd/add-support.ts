import { CliError, cliIsTextOutput } from '@jib/cli'
import type { Config } from '@jib/config'
import type { Paths } from '@jib/paths'
import { sourcesBuildChoices, sourcesRunSetup } from '@jib/sources'
import { isInteractive, promptSelect, spinner } from '@jib/tui'
import { consola } from 'consola'

export interface AddChooseInitialSourceDeps {
  buildSourceChoices?: typeof sourcesBuildChoices
  isInteractive?: typeof isInteractive
  promptSelect?: typeof promptSelect
  runSourceSetup?: typeof sourcesRunSetup
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
  const buildSourceChoices = deps.buildSourceChoices ?? sourcesBuildChoices
  const runSourceSetup = deps.runSourceSetup ?? sourcesRunSetup
  if (currentSource || !interactive()) {
    return currentSource ? { value: currentSource, created: false } : { created: false }
  }

  const options = buildSourceChoices(cfg)
  if (options.length === 0) return { created: false }

  const choice = await select({
    message: 'Source for this app?',
    options: [{ value: 'none', label: 'None', hint: 'Public repo or local path' }, ...options],
  })
  if (choice === 'none') return { created: false }
  if (choice.startsWith('setup:')) {
    const created = await runSourceSetup(cfg, paths, choice.slice('setup:'.length))
    if (!created) throw new CliError('cancelled', 'source setup did not complete; add cancelled')
    return { value: created, created: true }
  }
  return choice.startsWith('existing:')
    ? { value: choice.slice('existing:'.length), created: false }
    : { created: false }
}

/** Creates spinner-backed inspection callbacks for the add flow. */
export function addCreateInspectionObserver() {
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
