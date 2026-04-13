import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPaths } from '@jib/paths'

const originalDollar = Bun.$

type ShellLike = Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }> & {
  quiet(): ShellLike
  nothrow(): ShellLike
}

function fakeShell(result = { exitCode: 0, stdout: Buffer.from(''), stderr: Buffer.from('') }) {
  const promise = Promise.resolve(result) as ShellLike
  promise.quiet = () => promise
  promise.nothrow = () => promise
  return promise
}

beforeEach(() => {
  mock.restore()
})

afterEach(() => {
  mock.restore()
  ;(Bun as typeof Bun & { $: typeof Bun.$ }).$ = originalDollar
})

describe('github keygen helpers', () => {
  test('generateDeployKey shells out and returns the public key text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-keygen-'))
    const paths = getPaths(root)
    ;(Bun as typeof Bun & { $: typeof Bun.$ }).$ = ((
      parts: TemplateStringsArray,
      ...values: string[]
    ) => {
      const command = parts.join(' ')
      if (!command.includes('ssh-keygen -t ed25519 -f')) return fakeShell()
      const privateKey = values[0]
      if (!privateKey) throw new Error('private key path missing in test shell stub')
      const publicKey = `${privateKey}.pub`
      writeFileSync(privateKey, 'PRIVATE KEY\n')
      writeFileSync(publicKey, 'ssh-ed25519 AAAA test\n')
      return fakeShell()
    }) as unknown as typeof Bun.$

    const { githubGenerateDeployKey } = await import('./keygen.ts')
    const pubKey = await githubGenerateDeployKey('demo', paths)

    expect(pubKey).toBe('ssh-ed25519 AAAA test')
    await rm(root, { recursive: true, force: true })
  })

  test('keyFingerprint trims the ssh-keygen output', async () => {
    ;(Bun as typeof Bun & { $: typeof Bun.$ }).$ = (() =>
      fakeShell({
        exitCode: 0,
        stdout: Buffer.from('256 SHA256:abc demo (ED25519)\n'),
        stderr: Buffer.from(''),
      })) as unknown as typeof Bun.$
    const { githubReadKeyFingerprint } = await import('./keygen.ts')

    expect(await githubReadKeyFingerprint('/tmp/demo.pub')).toBe('256 SHA256:abc demo (ED25519)')
  })
})
