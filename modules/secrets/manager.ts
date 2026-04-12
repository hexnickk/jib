import type {
  SecretsReadError,
  SecretsRemoveAppError,
  SecretsStatError,
  SecretsWriteError,
} from './errors.ts'
import {
  type AppSecretStatus,
  type MaskedSecretEntry,
  checkSecretsApp,
  readMaskedSecrets,
  removeAppSecrets,
  removeSecret,
  secretsEnvPath,
  upsertSecret,
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

/**
 * Compatibility wrapper for callers that still expect the legacy class API.
 * Prefer the plain function exports from `service.ts` for new code.
 */
export class SecretsManager {
  constructor(private readonly dir: string) {}

  envPath(app: string, envFile?: string): string {
    return secretsEnvPath({ secretsDir: this.dir }, app, envFile)
  }

  async upsert(app: string, key: string, value: string, envFile?: string): Promise<void> {
    unwrapSecretsResult(await upsertSecret({ secretsDir: this.dir }, app, key, value, envFile))
  }

  async remove(app: string, key: string, envFile?: string): Promise<boolean> {
    return unwrapSecretsResult(await removeSecret({ secretsDir: this.dir }, app, key, envFile))
  }

  async removeApp(app: string): Promise<void> {
    unwrapSecretsResult(await removeAppSecrets({ secretsDir: this.dir }, app))
  }

  async check(app: string, envFile?: string): Promise<AppSecretStatus> {
    return unwrapSecretsResult(await checkSecretsApp({ secretsDir: this.dir }, app, envFile))
  }

  async readMasked(app: string, envFile?: string): Promise<MaskedSecretEntry[]> {
    return unwrapSecretsResult(await readMaskedSecrets({ secretsDir: this.dir }, app, envFile))
  }
}
