import type {
  SecretsReadError,
  SecretsRemoveAppError,
  SecretsStatError,
  SecretsWriteError,
} from './errors.ts'
import {
  type AppSecretStatus,
  type MaskedSecretEntry,
  secretsCheckApp,
  secretsEnvPath,
  secretsReadMasked,
  secretsRemove,
  secretsRemoveApp,
  secretsUpsert,
} from './service.ts'

type SecretsResultError =
  | SecretsReadError
  | SecretsWriteError
  | SecretsStatError
  | SecretsRemoveAppError

function unwrapSecretsResult<T>(result: T | SecretsResultError): T {
  if (result instanceof Error) throw result
  return result
}

export interface SecretsManagerClient {
  envPath(app: string, envFile?: string): string
  upsert(app: string, key: string, value: string, envFile?: string): Promise<void>
  remove(app: string, key: string, envFile?: string): Promise<boolean>
  removeApp(app: string): Promise<void>
  check(app: string, envFile?: string): Promise<AppSecretStatus>
  readMasked(app: string, envFile?: string): Promise<MaskedSecretEntry[]>
}

/**
 * Create the object-style secrets API used by CLI and module callers.
 * Prefer the plain function exports from `service.ts` for direct access.
 */
export function secretsCreateManager(dir: string): SecretsManagerClient {
  const ctx = { secretsDir: dir }
  return {
    envPath(app: string, envFile?: string): string {
      return secretsEnvPath(ctx, app, envFile)
    },

    async upsert(app: string, key: string, value: string, envFile?: string): Promise<void> {
      unwrapSecretsResult(await secretsUpsert(ctx, app, key, value, envFile))
    },

    async remove(app: string, key: string, envFile?: string): Promise<boolean> {
      return unwrapSecretsResult(await secretsRemove(ctx, app, key, envFile))
    },

    async removeApp(app: string): Promise<void> {
      unwrapSecretsResult(await secretsRemoveApp(ctx, app))
    },

    async check(app: string, envFile?: string): Promise<AppSecretStatus> {
      return unwrapSecretsResult(await secretsCheckApp(ctx, app, envFile))
    },

    async readMasked(app: string, envFile?: string): Promise<MaskedSecretEntry[]> {
      return unwrapSecretsResult(await secretsReadMasked(ctx, app, envFile))
    },
  }
}
