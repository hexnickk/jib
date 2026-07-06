import { writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathsGetPaths } from '@jib/paths'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type ShellLike = Promise<{ exitCode: number; stdout: string; stderr: string }> & {
  nothrow(): ShellLike
  quiet(): ShellLike
}

type FakeDollar = (parts: TemplateStringsArray, ...values: unknown[]) => ShellLike

function fakeShell(result = { exitCode: 0, stdout: '', stderr: '' }) {
  const promise = Promise.resolve(result) as ShellLike
  promise.nothrow = () => promise
  promise.quiet = () => promise
  return promise
}

/** Installs a zx `$` mock before dynamically importing the module under test. */
function mockZxDollar(fakeDollar: FakeDollar): void {
  vi.doMock('zx', () => ({ $: fakeDollar }))
}

beforeEach(() => {
  vi.doUnmock('zx')
  vi.resetModules()
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.doUnmock('zx')
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('github keygen helpers', () => {
  test('generateDeployKey shells out and returns the public key text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-keygen-'))
    const paths = pathsGetPaths(root)
    mockZxDollar((parts, ...values) => {
      const command = parts.join(' ')
      if (!command.includes('ssh-keygen -t ed25519 -f')) return fakeShell()
      const privateKey = values[0]
      if (typeof privateKey !== 'string')
        throw new Error('private key path missing in test shell stub')
      const publicKey = `${privateKey}.pub`
      writeFileSync(privateKey, 'PRIVATE KEY\n')
      writeFileSync(publicKey, 'ssh-ed25519 AAAA test\n')
      return fakeShell()
    })

    const { githubGenerateDeployKey } = await import('./keygen.ts')
    const pubKey = await githubGenerateDeployKey('demo', paths)

    expect(pubKey).toBe('ssh-ed25519 AAAA test')
    await rm(root, { recursive: true, force: true })
  })

  test('keyFingerprint trims the ssh-keygen output', async () => {
    mockZxDollar(() =>
      fakeShell({ exitCode: 0, stdout: '256 SHA256:abc demo (ED25519)\n', stderr: '' }),
    )
    const { githubReadKeyFingerprint } = await import('./keygen.ts')

    expect(await githubReadKeyFingerprint('/tmp/demo.pub')).toBe('256 SHA256:abc demo (ED25519)')
  })
})
