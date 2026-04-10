import { withBus } from '@jib/bus'
import { loadAppConfig, loadConfig, writeConfig } from '@jib/config'
import type { App } from '@jib/config'
import { ValidationError, isTextOutput } from '@jib/core'
import { AddFlow, type AddFlowResult } from '@jib/flows'
import { claimIngress, createBusIngressOperator } from '@jib/ingress'
import { SecretsManager } from '@jib/secrets'
import { prepareSource, removeSource } from '@jib/sources'
import { spinner } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { applyCliArgs, withCliArgs } from './_cli.ts'
import { buildDraftApp, gatherAddInputs } from './add/inputs.ts'
import { createAddPlanner } from './add/planner.ts'
import { maybeRecoverSource } from './sources-flow.ts'

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/
const DEFAULT_TIMEOUT_MS = 5 * 60_000

export default defineCommand({
  meta: { name: 'add', description: 'Register a new app (config + repo + optional ingress)' },
  args: withCliArgs({
    app: { type: 'positional', required: true },
    repo: {
      type: 'string',
      description: 'Git repo: "owner/name", "local", file:// URL, http(s):// URL, or absolute path',
    },
    source: { type: 'string', description: 'Configured source ref name' },
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
    const mgr = new SecretsManager(paths.secretsDir)
    const planner = createAddPlanner()
    const flowArgs: { source?: string } = args.source ? { source: args.source } : {}
    let currentCfg = cfg
    let result: AddFlowResult | undefined
    const addFlow = new AddFlow({
      repo: {
        prepare: (appName, target) => prepareSource(currentCfg, paths, { app: appName, ...target }),
        rollback: (appName, repo) => removeSource(paths, appName, repo),
      },
      planner,
      config: { write: writeConfig, load: loadConfig },
      secrets: {
        upsert: (appName, entry, envFile) => mgr.upsert(appName, entry.key, entry.value, envFile),
        remove: async (appName, key, envFile) => {
          await mgr.remove(appName, key, envFile)
        },
      },
      ingress: {
        claim: (appName, finalApp) => claimIngressForAdd(appName, finalApp),
      },
      warn: (message) => {
        if (isTextOutput()) consola.warn(message)
      },
    })

    for (;;) {
      try {
        result = await addFlow.run({
          appName: args.app,
          args: flowArgs,
          cfg: currentCfg,
          configFile: paths.configFile,
          inputs,
          draftApp: buildDraftApp(flowArgs, inputs),
        })
        break
      } catch (error) {
        const nextSource = await maybeRecoverSource(
          currentCfg,
          paths,
          inputs.repo,
          error,
          flowArgs.source,
        )
        if (!nextSource) throw error
        flowArgs.source = nextSource
        currentCfg = await loadConfig(paths.configFile)
      }
    }

    if (!result) throw new Error('add flow did not complete')
    return renderResult(args.app, inputs.repo, result)
  },
})

function renderResult(app: string, repo: string, result: AddFlowResult) {
  const { finalApp, secretsWritten } = result
  if (secretsWritten > 0 && isTextOutput()) {
    consola.success(`${secretsWritten} secret(s) set for ${app}`)
  }
  if (isTextOutput()) {
    const ingress =
      finalApp.domains.length > 0
        ? finalApp.domains.map((d) => `${d.host} -> 127.0.0.1:${d.port}`).join('\n    ')
        : 'none'
    consola.box(`app "${app}" ready\n  ingress:\n    ${ingress}\n  next:   jib deploy ${app}`)
  }
  return {
    app,
    repo,
    composeFiles: finalApp.compose ?? [],
    services: finalApp.services ?? [],
    routes: finalApp.domains.map((d) => ({
      host: d.host,
      port: d.port ?? null,
      containerPort: d.container_port ?? null,
      service: d.service ?? null,
      ingress: d.ingress ?? 'direct',
    })),
    secretsWritten,
  }
}

async function claimIngressForAdd(app: string, appCfg: App): Promise<void> {
  await withBus(async (bus) => {
    const s = isTextOutput() ? spinner() : null
    s?.start(`claiming ingress for ${app}`)
    try {
      await claimIngress(
        createBusIngressOperator(bus, DEFAULT_TIMEOUT_MS),
        app,
        appCfg,
        (progress) => s?.message(progress.message),
      )
      s?.stop('ingress ready')
    } catch (error) {
      s?.stop('ingress failed')
      throw error
    }
  })
}
