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
export function createSecretsManager(dir: string): SecretsManagerClient {
  const ctx = { secretsDir: dir }
  return {
    envPath(app: string, envFile?: string): string {
      return secretsEnvPath(ctx, app, envFile)
    },

    async upsert(app: string, key: string, value: string, envFile?: string): Promise<void> {
      unwrapSecretsResult(await upsertSecret(ctx, app, key, value, envFile))
    },

    async remove(app: string, key: string, envFile?: string): Promise<boolean> {
      return unwrapSecretsResult(await removeSecret(ctx, app, key, envFile))
    },

    async removeApp(app: string): Promise<void> {
      unwrapSecretsResult(await removeAppSecrets(ctx, app))
    },

    async check(app: string, envFile?: string): Promise<AppSecretStatus> {
      return unwrapSecretsResult(await checkSecretsApp(ctx, app, envFile))
    },

    async readMasked(app: string, envFile?: string): Promise<MaskedSecretEntry[]> {
      return unwrapSecretsResult(await readMaskedSecrets(ctx, app, envFile))
    },
  }
}

/**
 * Compatibility wrapper for callers that still expect the legacy class API.
 * Prefer `createSecretsManager()` for new code.
 */
export class SecretsManager {
  private readonly manager: SecretsManagerClient

  constructor(dir: string) {
    this.manager = createSecretsManager(dir)
  }

  envPath(app: string, envFile?: string): string {
    return this.manager.envPath(app, envFile)
  }

  async upsert(app: string, key: string, value: string, envFile?: string): Promise<void> {
    await this.manager.upsert(app, key, value, envFile)
  }

  async remove(app: string, key: string, envFile?: string): Promise<boolean> {
    return this.manager.remove(app, key, envFile)
  }

  async removeApp(app: string): Promise<void> {
    await this.manager.removeApp(app)
  }

  async check(app: string, envFile?: string): Promise<AppSecretStatus> {
    return this.manager.check(app, envFile)
  }

  async readMasked(app: string, envFile?: string): Promise<MaskedSecretEntry[]> {
    return this.manager.readMasked(app, envFile)
  }
}
