import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { findInstallationForOrg, listInstallations } from './installation.ts'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
const originalFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = originalFetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('github installation lookup', () => {
  test('listInstallations uses the GitHub app endpoint and returns parsed installations', async () => {
    let seenAuth = ''
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seenAuth = String((init?.headers as Record<string, string>).Authorization)
      expect(String(url)).toBe('https://api.github.com/app/installations')
      return new Response(JSON.stringify([{ id: 7, account: { login: 'Acme' } }]), { status: 200 })
    }) as unknown as typeof fetch

    const items = await listInstallations(12345, privateKey)

    expect(seenAuth.startsWith('Bearer ')).toBe(true)
    expect(items).toEqual([{ id: 7, account: { login: 'Acme' } }])
  })

  test('findInstallationForOrg matches org names case-insensitively', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify([{ id: 42, account: { login: 'AcMe' } }]), {
        status: 200,
      })) as unknown as typeof fetch

    const installationId = await findInstallationForOrg(12345, privateKey, 'acme')

    expect(installationId).toBe(42)
  })
})
