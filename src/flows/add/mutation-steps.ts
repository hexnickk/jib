import { InternalError, type JibError } from '@jib/errors'
import type { Step } from '@jib/tx'
import type { AddRunContext } from './steps.ts'

/** Writes the final app config and rolls it back if a later step fails. */
export const addWriteConfigStep: Step<AddRunContext, { configWritten: true }, JibError> = {
  name: 'config',
  async up(ctx) {
    const finalCfg = {
      ...ctx.params.cfg,
      apps: { ...ctx.params.cfg.apps, [ctx.params.appName]: ctx.finalApp },
    }
    const error = await ctx.support.writeConfig(ctx.params.configFile, finalCfg)
    if (error instanceof Error) {
      return error
    }
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
    return await ctx.support.writeConfig(ctx.params.configFile, {
      ...loaded,
      apps: rollbackApps,
    })
  },
}

/** Writes add-flow secrets and removes newly written keys when the flow rolls back. */
export const addWriteSecretsStep: Step<AddRunContext, { keys: string[] }, JibError> = {
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
        return error
      } catch (error) {
        await cleanupWrittenSecrets(ctx, keys)
        const message = error instanceof Error ? error.message : String(error)
        return new InternalError(message, { cause: error })
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

/** Claims ingress after config and secret writes have completed. */
export const addClaimIngressStep: Step<AddRunContext, undefined, JibError> = {
  name: 'ingress',
  async up(ctx) {
    const error = await ctx.support.claimIngress(ctx.params.appName, ctx.finalApp)
    if (error instanceof Error) {
      return error
    }
    ctx.observer.onStateChange?.('routes_claimed')
    return undefined
  },
}

/** Removes keys written by this add attempt and logs best-effort cleanup failures. */
async function cleanupWrittenSecrets(ctx: AddRunContext, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    try {
      const error = await ctx.support.removeSecret(ctx.params.appName, key)
      if (error instanceof Error) {
        ctx.observer.warn?.(`secret cleanup (${key}): ${error.message}`)
      }
    } catch (error) {
      ctx.observer.warn?.(
        `secret cleanup (${key}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
