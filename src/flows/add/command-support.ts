import { CliError } from '@jib/cli'
import type { Config } from '@jib/config'
import type { JibError } from '@jib/errors'
import type { Paths } from '@jib/paths'
import { sourcesBuildChoices, sourcesRunSetup } from '@jib/sources'
import { tuiIsInteractive, tuiPromptSelectResult, tuiSpinner } from '@jib/tui'

/** Chooses the initial source, prompting only when the caller did not provide one. */
export async function addChooseInitialSource(
  cfg: Config,
  paths: Paths,
  currentSource?: string,
): Promise<{ value?: string; created: boolean } | JibError> {
  if (currentSource || !tuiIsInteractive()) {
    return currentSource ? { value: currentSource, created: false } : { created: false }
  }

  const options = sourcesBuildChoices(cfg)
  if (options.length === 0) {
    return { created: false }
  }

  const choice = await tuiPromptSelectResult({
    message: 'Source for this app?',
    options: [{ value: 'none', label: 'None', hint: 'Public repo or local path' }, ...options],
  })
  if (choice instanceof Error) {
    return choice
  }
  if (choice === 'none') {
    return { created: false }
  }
  if (choice.startsWith('setup:')) {
    const created = await sourcesRunSetup(cfg, paths, choice.slice('setup:'.length))
    if (!created) {
      return new CliError('cancelled', 'source setup did not complete; add cancelled')
    }
    return { value: created, created: true }
  }
  return choice.startsWith('existing:')
    ? { value: choice.slice('existing:'.length), created: false }
    : { created: false }
}

/** Creates spinner-backed inspection callbacks for the add flow. */
export function addCreateInspectionObserver() {
  const progress = tuiSpinner()
  let active = false
  return {
    observer: {
      onStateChange: (state: string) => {
        if (state === 'inputs_ready') {
          active = true
          progress.start('preparing repo')
        }
        if (state === 'repo_prepared') {
          progress.message('inspecting docker-compose')
        }
        if (state === 'compose_inspected' && active) {
          active = false
          progress.stop('compose inspected')
        }
      },
    },
    stop: () => {
      if (!active) {
        return
      }
      active = false
      progress.stop('compose inspected')
    },
    fail: () => {
      if (!active) {
        return
      }
      active = false
      progress.stop('inspection failed')
    },
  }
}
