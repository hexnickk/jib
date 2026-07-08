import type { Step } from '@jib/tx'
import {
  type AddFlowError,
  ClaimIngressError,
  ConfigRollbackError,
  ConfigWriteError,
  SecretWriteError,
} from './flow-errors.ts'
import type { AddRunContext } from './steps.ts'

export const addWriteConfigStep: Step<AddRunContext, { configWritten: true }, AddFlowError> = {
  name: 'config',
  async up(ctx) {
    const finalCfg = {
      ...ctx.params.cfg,
      apps: { ...ctx.params.cfg.apps, [ctx.params.appName]: ctx.finalApp },
    }
    const error = await ctx.support.writeConfig(ctx.params.configFile, finalCfg)
    if (error instanceof Error) return new ConfigWriteError(error)
    ctx.observer.onStateChange?.('config_written')
    return { configWritten: true }
  },
  async down(ctx) {
    const current = await ctx.support.loadConfig(ctx.params.configFile)
    const loaded = current instanceof Error ? ctx.params.cfg : current
    if (current instanceof Error) {
      ctx.observer.warn?.(
        `config cleanup load: ${current.message}; falling back to original snapshot`,
      )
    }
    const rollbackApps = { ...loaded.apps }
    delete rollbackApps[ctx.params.appName]
    const error = await ctx.support.writeConfig(ctx.params.configFile, {
      ...loaded,
      apps: rollbackApps,
    })
    if (error instanceof Error) return new ConfigRollbackError(error)
  },
}

export const addWriteSecretsStep: Step<AddRunContext, { keys: string[] }, AddFlowError> = {
  name: 'secrets',
  async up(ctx) {
    const keys: string[] = []
    for (const { key, value } of ctx.guided.configEntries) {
      const entry = { key, value }
      try {
        const error = await ctx.support.upsertSecret(ctx.params.appName, entry)
        if (!(error instanceof Error)) {
          keys.push(entry.key)
          continue
        }
        await cleanupWrittenSecrets(ctx, keys)
        return new SecretWriteError(entry.key, error)
      } catch (cause) {
        await cleanupWrittenSecrets(ctx, keys)
        return new SecretWriteError(entry.key, cause)
      }
    }
    ctx.secretsWritten = ctx.guided.configEntries.length
    ctx.observer.onStateChange?.('secrets_written')
    return { keys }
  },
  async down(ctx, state) {
    await cleanupWrittenSecrets(ctx, state.keys)
    return undefined
  },
}

export const addClaimIngressStep: Step<AddRunContext, undefined, AddFlowError> = {
  name: 'ingress',
  async up(ctx) {
    const error = await ctx.support.claimIngress(ctx.params.appName, ctx.finalApp)
    if (error instanceof Error) return new ClaimIngressError(error)
    ctx.observer.onStateChange?.('routes_claimed')
    return undefined
  },
}

async function cleanupWrittenSecrets(
  ctx: AddRunContext,
  keys: readonly string[],
): Promise<undefined> {
  for (const key of keys) {
    try {
      const error = await ctx.support.removeSecret(ctx.params.appName, key)
      if (error instanceof Error) {
        ctx.observer.warn?.(`secret cleanup (${key}): ${error.message}`)
      }
    } catch (cause) {
      ctx.observer.warn?.(
        `secret cleanup (${key}): ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
  }
  return undefined
}
