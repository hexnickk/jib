import { withBus } from '@jib/bus'
import { loadAppConfig } from '@jib/config'
import type { App } from '@jib/config'
import { ValidationError, isTextOutput } from '@jib/core'
import { type AddFlowResult, AddService, DefaultAddSupport } from '@jib/flows'
import { claimIngress, createBusIngressOperator } from '@jib/ingress'
import { spinner } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { applyCliArgs, withCliArgs } from './_cli.ts'
import { buildDraftApp, gatherAddInputs } from './add/inputs.ts'
import { createAddPlanner } from './add/planner.ts'
import { preflightSourceSelection } from './sources-flow.ts'

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
    branch: { type: 'string', description: 'Git branch to track (defaults to the repo default)' },
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
    const planner = createAddPlanner()
    const preflight = await preflightSourceSelection(
      args.app,
      cfg,
      paths,
      inputs.repo,
      args.source,
      args.branch,
    )
    const flowArgs: { source?: string; branch?: string } = {
      branch: preflight.branch,
      ...(preflight.source ? { source: preflight.source } : {}),
    }
    const addService = new AddService(
      new DefaultAddSupport({
        paths,
        claimIngress: (appName, finalApp) => claimIngressForAdd(appName, finalApp),
      }),
      planner,
      {
        warn: (message) => {
          if (isTextOutput()) consola.warn(message)
        },
      },
    )

    const result: AddFlowResult = await addService.run({
      appName: args.app,
      args: flowArgs,
      cfg: preflight.cfg,
      configFile: paths.configFile,
      inputs,
      draftApp: buildDraftApp(flowArgs, inputs),
    })
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
