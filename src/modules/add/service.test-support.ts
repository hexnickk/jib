import type { App, Config } from '@jib/config'
import type { ComposeInspection } from '@jib/docker'
import {
  type AddFlowObserver,
  type AddFlowParams,
  type AddFlowState,
  type AddPlanner,
  AddService,
  type AddSupport,
} from './index.ts'

const baseCfg: Config = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  sources: {},
  apps: {
    existing: { repo: 'owner/existing', branch: 'main', domains: [], env_file: '.env' },
  },
}

const draftApp: App = {
  repo: 'owner/blog',
  branch: 'main',
  domains: [],
  env_file: '.env',
}

const inspection: ComposeInspection = {
  composeFiles: ['compose.yml'],
  services: [{ name: 'web', ports: ['8080:80'], expose: [], envRefs: [] }],
}

const guided = {
  domains: [{ host: 'blog.example.com', service: 'web' }],
  envEntries: [
    { key: 'APP_KEY', value: 'secret' },
    { key: 'TOKEN', value: 'token' },
  ],
  secretKeys: ['APP_KEY', 'TOKEN'],
}

export const finalApp: App = {
  repo: 'owner/blog',
  branch: 'main',
  compose: ['compose.yml'],
  services: ['web'],
  domains: [{ host: 'blog.example.com', service: 'web', port: 20000, container_port: 80 }],
  env_file: '.env',
}

export function makeParams(): AddFlowParams {
  return {
    appName: 'blog',
    args: {},
    cfg: structuredClone(baseCfg),
    configFile: '/tmp/config.yml',
    inputs: {
      repo: 'owner/blog',
      ingressDefault: 'direct',
      parsedDomains: [],
      envEntries: [],
      healthChecks: [],
    },
    draftApp,
  }
}

export function makeDeps(
  failAt?:
    | 'prepareRepo'
    | 'inspectCompose'
    | 'collectGuidedInputs'
    | 'buildResolvedApp'
    | 'confirmPlan'
    | 'writeConfig'
    | 'writeSecondSecret'
    | 'claimRoutes',
  injectConcurrentConfigChange = false,
  failLoadConfig = false,
  failRollbackRepo = false,
) {
  const calls: string[] = []
  const states: AddFlowState[] = []
  const warnings: string[] = []
  const writtenConfigs: Config[] = []
  let currentConfig = structuredClone(baseCfg)
  let secretWrites = 0

  const support: AddSupport = {
    cloneForInspection: async () => {
      calls.push('prepareRepo')
      if (failAt === 'prepareRepo') throw new Error('prepareRepo failed')
      return { workdir: '/tmp/blog' }
    },
    removeCheckout: async () => {
      calls.push('rollbackRepo')
      if (failRollbackRepo) throw new Error('rollbackRepo failed')
    },
    writeConfig: async (_configFile, cfg) => {
      calls.push('writeConfig')
      if (failAt === 'writeConfig') throw new Error('writeConfig failed')
      currentConfig = structuredClone(cfg)
      if (injectConcurrentConfigChange && currentConfig.apps.blog) {
        currentConfig.apps.worker = {
          repo: 'owner/worker',
          branch: 'main',
          domains: [],
          env_file: '.env',
        }
      }
      writtenConfigs.push(structuredClone(cfg))
    },
    loadConfig: async () => {
      calls.push('loadConfig')
      if (failLoadConfig) throw new Error('loadConfig failed')
      return structuredClone(currentConfig)
    },
    upsertSecret: async (_appName, entry) => {
      calls.push(`upsertSecret:${entry.key}`)
      secretWrites++
      if (failAt === 'writeSecondSecret' && secretWrites === 2) {
        throw new Error('writeSecondSecret failed')
      }
    },
    removeSecret: async (_appName, key) => {
      calls.push(`removeSecret:${key}`)
    },
    claimIngress: async () => {
      calls.push('claimRoutes')
      if (failAt === 'claimRoutes') throw new Error('claimRoutes failed')
    },
  }
  const planner: AddPlanner = {
    inspectCompose: async () => {
      calls.push('inspectCompose')
      if (failAt === 'inspectCompose') throw new Error('inspectCompose failed')
      return inspection
    },
    collectGuidedInputs: async () => {
      calls.push('collectGuidedInputs')
      if (failAt === 'collectGuidedInputs') throw new Error('collectGuidedInputs failed')
      return guided
    },
    buildResolvedApp: async () => {
      calls.push('buildResolvedApp')
      if (failAt === 'buildResolvedApp') throw new Error('buildResolvedApp failed')
      return finalApp
    },
    confirmPlan: async () => {
      calls.push('confirmPlan')
      if (failAt === 'confirmPlan') throw new Error('confirmPlan failed')
    },
  }
  const observer: AddFlowObserver = {
    onStateChange: (state) => {
      states.push(state)
    },
    warn: (message) => {
      warnings.push(message)
    },
  }

  const flow = new AddService(support, planner, observer)

  return { flow, calls, states, warnings, writtenConfigs }
}
