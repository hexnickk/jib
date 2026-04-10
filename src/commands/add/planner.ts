import { type App, type Config, type Domain, type ParsedDomain, assignPorts } from '@jib/config'
import { CliError, isDebugEnabled, isTextOutput } from '@jib/core'
import {
  type ComposeInspection,
  ComposeInspectionError,
  type ComposeService,
  inspectComposeApp,
  resolveFromCompose,
} from '@jib/docker'
import type { AddInputs, AddPlanner, EnvEntry } from '@jib/flows'
import { isInteractive, promptConfirm, promptPassword, promptString } from '@jib/tui'
import { consola } from 'consola'
import { missingInput } from '../_cli.ts'
import {
  mergeGuidedServiceAnswers,
  renderAddPlanSummary,
  splitCommaValues,
  summarizeComposeServices,
} from '../add-guided.ts'
import { collectDomains, promptForServices } from './guided.ts'
import { parseApp } from './inputs.ts'

export function createAddPlanner(): AddPlanner {
  return {
    inspectCompose: inspectComposeWithPrompts,
    collectGuidedInputs,
    buildResolvedApp,
    confirmPlan: confirmAddPlan,
  }
}

async function inspectComposeWithPrompts(
  draftApp: App,
  workdir: string,
): Promise<ComposeInspection> {
  let compose = draftApp.compose
  for (;;) {
    try {
      const inspection = inspectComposeApp({ compose }, workdir)
      if (isDebugEnabled()) {
        consola.info(`compose files: ${inspection.composeFiles.join(', ')}`)
        consola.info(`services: ${inspection.services.map((service) => service.name).join(', ')}`)
      }
      return inspection
    } catch (error) {
      if (
        error instanceof ComposeInspectionError &&
        error.code === 'compose_not_found' &&
        isInteractive()
      ) {
        const answer = await promptString({
          message: 'Compose file(s) relative to the repo (comma-separated)',
          placeholder: 'docker-compose.yml',
          ...(compose ? { initialValue: compose.join(',') } : {}),
        })
        compose = splitCommaValues(answer)
        continue
      }
      if (error instanceof ComposeInspectionError && error.code === 'compose_not_found') {
        if (!compose || compose.length === 0) {
          missingInput('missing required input for jib add', [
            {
              field: 'compose',
              message:
                'provide --compose <file> (or comma-separated files) so jib can inspect services',
            },
          ])
        }
        throw new CliError('compose_inspection_failed', error.message, {
          hint: 'fix --compose and retry, or rerun with interactive prompts enabled',
        })
      }
      throw error
    }
  }
}

async function collectGuidedInputs(
  inputs: AddInputs,
  composeServices: ComposeService[],
): Promise<{ domains: ParsedDomain[]; envEntries: EnvEntry[]; secretKeys: string[] }> {
  const serviceNames = composeServices.map((service) => service.name)
  const domains = await collectDomains(inputs.parsedDomains, serviceNames)
  const secretValues = new Map(inputs.envEntries.map((entry) => [entry.key, entry.value]))
  const answers = await promptForServices(domains, composeServices, secretValues)
  const merged = mergeGuidedServiceAnswers(domains, serviceNames, answers, inputs.ingressDefault)
  for (const key of merged.secretKeys) {
    if (secretValues.has(key)) continue
    secretValues.set(key, await promptPassword({ message: `Value for ${key}` }))
  }
  return {
    domains: merged.domains,
    envEntries: [...secretValues.entries()].map(([key, value]) => ({ key, value })),
    secretKeys: [...secretValues.keys()],
  }
}

async function buildResolvedApp(
  cfg: Config,
  appName: string,
  workdir: string,
  args: { source?: string; branch?: string },
  inputs: AddInputs,
  inspection: ComposeInspection,
  guided: { domains: ParsedDomain[] },
): Promise<App> {
  const domains = await assignPorts(cfg, appName, guided.domains as Domain[])
  return resolveFromCompose(
    parseApp({
      repo: inputs.repo,
      branch: args.branch ?? 'main',
      domains,
      env_file: '.env',
      services: inspection.services.map((service) => service.name),
      compose: inspection.composeFiles,
      ...(args.source ? { source: args.source } : {}),
      ...(inputs.healthChecks.length > 0 ? { health: inputs.healthChecks } : {}),
    }),
    workdir,
  )
}

async function confirmAddPlan(
  appName: string,
  inspection: ComposeInspection,
  finalApp: App,
  secretKeys: string[],
): Promise<void> {
  if (!isTextOutput()) return
  consola.box(
    renderAddPlanSummary({
      app: appName,
      composeFiles: inspection.composeFiles,
      services: summarizeComposeServices(inspection.services),
      domains: finalApp.domains,
      secretKeys,
      envFile: finalApp.env_file,
    }),
  )
  if (!isInteractive()) return
  if (!(await promptConfirm({ message: `Write config for "${appName}"?`, initialValue: true }))) {
    throw new CliError('cancelled', 'add cancelled')
  }
}
