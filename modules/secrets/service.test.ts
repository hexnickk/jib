import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretsReadError, SecretsStatError, SecretsWriteError } from './errors.ts'
import {
  checkSecretsApp,
  readMaskedSecrets,
  removeSecret,
  secretsEnvPath,
  upsertSecret,
} from './service.ts'

async function withSecretsDir<T>(fn: (ctx: { secretsDir: string }) => Promise<T>): Promise<T> {
  const secretsDir = await mkdtemp(join(tmpdir(), 'jib-secrets-service-'))
  try {
    return await fn({ secretsDir })
  } finally {
    await rm(secretsDir, { recursive: true, force: true })
  }
}

describe('secrets service', () => {
  test('upsertSecret returns a typed write error when secrets dir cannot host apps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-secrets-bad-root-'))
    const secretsDir = join(root, 'secrets-root')
    try {
      await writeFile(secretsDir, 'not a dir')
      const result = await upsertSecret({ secretsDir }, 'web', 'A', '1')
      expect(result).toBeInstanceOf(SecretsWriteError)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('checkSecretsApp returns a typed stat error for non-missing path failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-secrets-bad-stat-'))
    const secretsDir = join(root, 'secrets-root')
    try {
      await writeFile(secretsDir, 'not a dir')
      const result = await checkSecretsApp({ secretsDir }, 'web')
      expect(result).toBeInstanceOf(SecretsStatError)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('readMaskedSecrets returns a typed read error when the env file is missing', async () => {
    await withSecretsDir(async (ctx) => {
      const result = await readMaskedSecrets(ctx, 'web')
      expect(result).toBeInstanceOf(SecretsReadError)
    })
  })

  test('removeSecret returns false for a missing env file', async () => {
    await withSecretsDir(async (ctx) => {
      const result = await removeSecret(ctx, 'web', 'A')
      expect(result).toBe(false)
    })
  })

  test('returned function APIs still support the normal secrets flow', async () => {
    await withSecretsDir(async (ctx) => {
      const first = await upsertSecret(ctx, 'web', 'A', '1')
      expect(first).toBeUndefined()
      const second = await upsertSecret(ctx, 'web', 'B', '22')
      expect(second).toBeUndefined()
      const entries = await readMaskedSecrets(ctx, 'web')
      expect(entries).toEqual([
        { key: 'A', masked: '***' },
        { key: 'B', masked: '***' },
      ])
      expect(secretsEnvPath(ctx, 'web')).toBe(join(ctx.secretsDir, 'web', '.env'))
    })
  })
})
