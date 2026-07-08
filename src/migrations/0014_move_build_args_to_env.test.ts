import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathsGetPaths } from '@jib/paths'
import { stateOpenDb } from '@jib/state'
import { describe, expect, test } from 'vitest'
import { moveBuildArgsToEnv } from './0014_move_build_args_to_env.ts'

/** Creates an isolated migration context root and cleans it after the callback. */
async function withRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'jib-m0014-'))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('moveBuildArgsToEnv', () => {
  test('moves missing build args into env files and preserves existing env values', async () => {
    await withRoot(async (root) => {
      const paths = pathsGetPaths(root)
      await mkdir(paths.stateDir, { recursive: true })
      await mkdir(join(paths.secretsDir, 'demo'), { recursive: true })
      await writeFile(join(paths.secretsDir, 'demo', '.env'), 'EXTENSION_ID=new\n')
      await writeFile(
        paths.configFile,
        [
          'config_version: 3',
          'poll_interval: 5m',
          'modules: {}',
          'sources: {}',
          'apps:',
          '  demo:',
          '    repo: owner/demo',
          '    branch: main',
          '    domains: []',
          '    env_file: .env',
          '    build_args:',
          '      EXTENSION_ID: old',
          '      PUBLIC_URL: https://example.com',
          '  noargs:',
          '    repo: owner/noargs',
          '    branch: main',
          '    domains: []',
          '    env_file: .env',
          '',
        ].join('\n'),
      )

      await moveBuildArgsToEnv({ db: stateOpenDb(paths.stateDir), paths })

      const env = await readFile(join(paths.secretsDir, 'demo', '.env'), 'utf8')
      expect(env).toContain('EXTENSION_ID=new\n')
      expect(env).toContain('PUBLIC_URL=https://example.com\n')
      expect(env).not.toContain('EXTENSION_ID=old')
      const config = await readFile(paths.configFile, 'utf8')
      expect(config).not.toContain('build_args')
      expect(config).not.toContain('env_file')
    })
  })
})
