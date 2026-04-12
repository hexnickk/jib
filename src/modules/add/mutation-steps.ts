import type { Step } from '../tx/run.ts'
import { configEntriesToRuntime } from './config-entries.ts'
import {
  type AddFlowError,
  ClaimIngressError,
  ConfigRollbackError,
  ConfigWriteError,
  SecretWriteError,
} from './flow-errors.ts'
import type { AddRunContext } from './steps.ts'

export const writeConfigStep: Step<AddRunContext, { configWritten: true }, AddFlowError> = {
  name: 'config',
  async up(ctx) {
    try {
      const finalCfg = {
        ...ctx.params.cfg,
        apps: { ...ctx.params.cfg.apps, [ctx.params.appName]: ctx.finalApp },
      }
      await ctx.support.writeConfig(ctx.params.configFile, finalCfg)
      ctx.observer.onStateChange?.('config_written')
      return { configWritten: true }
    } catch (cause) {
      return new ConfigWriteError(cause)
    }
  },
  async down(ctx) {
    try {
      const current = await ctx.support.loadConfig(ctx.params.configFile).catch((cause) => {
        ctx.observer.warn?.(
          `config cleanup load: ${cause instanceof Error ? cause.message : String(cause)}; falling back to original snapshot`,
        )
        return ctx.params.cfg
      })
      const rollbackApps = { ...current.apps }
      delete rollbackApps[ctx.params.appName]
      await ctx.support.writeConfig(ctx.params.configFile, { ...current, apps: rollbackApps })
    } catch (cause) {
      return new ConfigRollbackError(cause)
    }
  },
}

export const writeSecretsStep: Step<
  AddRunContext,
  { envFile: string; keys: string[] },
  AddFlowError
> = {
  name: 'secrets',
  async up(ctx) {
    const runtimeEntries = configEntriesToRuntime(ctx.guided.configEntries)
    const keys: string[] = []
    for (const entry of runtimeEntries) {
      try {
        await ctx.support.upsertSecret(ctx.params.appName, entry, ctx.finalApp.env_file)
        keys.push(entry.key)
      } catch (cause) {
        await cleanupWrittenSecrets(ctx, keys, ctx.finalApp.env_file)
        return new SecretWriteError(entry.key, cause)
      }
    }
    ctx.secretsWritten = runtimeEntries.length
    ctx.observer.onStateChange?.('secrets_written')
    return { envFile: ctx.finalApp.env_file, keys }
  },
  async down(ctx, state) {
    await cleanupWrittenSecrets(ctx, state.keys, state.envFile)
    return undefined
  },
}

export const claimIngressStep: Step<AddRunContext, undefined, AddFlowError> = {
  name: 'ingress',
  async up(ctx) {
    try {
      await ctx.support.claimIngress(ctx.params.appName, ctx.finalApp)
      ctx.observer.onStateChange?.('routes_claimed')
      return undefined
    } catch (cause) {
      return new ClaimIngressError(cause)
    }
  },
}

async function cleanupWrittenSecrets(
  ctx: AddRunContext,
  keys: readonly string[],
  envFile: string,
): Promise<undefined> {
  for (const key of keys) {
    try {
      await ctx.support.removeSecret(ctx.params.appName, key, envFile)
    } catch (cause) {
      ctx.observer.warn?.(
        `secret cleanup (${key}): ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
  }
  return undefined
}
