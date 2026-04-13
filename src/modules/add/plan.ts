import { CliError } from '@jib/cli'
import { cliIsTextOutput } from '@jib/cli'
import type { App } from '@jib/config'
import type { ComposeInspection } from '@jib/docker'
import { tuiIsInteractive, tuiPromptConfirmResult } from '@jib/tui'
import { consola } from 'consola'
import { addRenderPlanSummary, addSummarizeComposeServices } from './guided.ts'
import type { ConfigEntry } from './types.ts'

/** Renders the add plan summary and confirms it in interactive text mode. */
export async function addConfirmPlan(
  appName: string,
  inspection: ComposeInspection,
  finalApp: App,
  configEntries: ConfigEntry[],
): Promise<undefined | CliError | Error> {
  if (!cliIsTextOutput()) return
  consola.box(
    addRenderPlanSummary({
      app: appName,
      composeFiles: inspection.composeFiles,
      services: addSummarizeComposeServices(inspection.services),
      domains: finalApp.domains,
      configEntries,
      envFile: finalApp.env_file,
    }),
  )
  if (!tuiIsInteractive()) return
  const confirmed = await tuiPromptConfirmResult({
    message: `Write config for "${appName}"?`,
    initialValue: true,
  })
  if (confirmed instanceof Error) return confirmed
  if (!confirmed) return new CliError('cancelled', 'add cancelled')
}
