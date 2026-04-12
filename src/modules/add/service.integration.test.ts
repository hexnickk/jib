import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import type { ComposeInspection } from '@jib/docker'
import { getPaths, managedComposePath, repoPath } from '@jib/paths'
import { $ } from 'bun'
import { AddService } from './service.ts'
import { DefaultAddSupport } from './support.ts'
import type { AddPlanner, GuidedInputs } from './types.ts'

async function makeUpstream(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-add-upstream-'))
  await $`git init -b main ${dir}`.quiet()
  await $`git -C ${dir} config user.email test@jib.local`.quiet()
  await $`git -C ${dir} config user.name test`.quiet()
  await writeFile(join(dir, 'docker-compose.yml'), 'services:\n  web:\n    image: nginx:alpine\n')
  await $`git -C ${dir} add docker-compose.yml`.quiet()
  await $`git -C ${dir} commit -m initial`.quiet()
  return dir
}

function configYaml(): string {
  return [
    'config_version: 3',
    'poll_interval: 5m',
    'modules: {}',
    'sources: {}',
    'apps:',
    '  existing:',
    '    repo: owner/existing',
    '    branch: main',
    '    domains: []',
    '    env_file: .env',
    '',
  ].join('\n')
}

describe('AddService with DefaultAddSupport', () => {
  test('real support rolls back checkout, secrets, config, and managed compose after late failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-add-root-'))
    const upstream = await makeUpstream()

    try {
      const paths = getPaths(root)
      await mkdir(paths.secretsDir, { recursive: true })
      const cfg: Config = {
        config_version: 3,
        poll_interval: '5m',
        modules: {},
        sources: {},
        apps: {
          existing: { repo: 'owner/existing', branch: 'main', domains: [], env_file: '.env' },
        },
      }
      await mkdir(paths.root, { recursive: true })
      await writeFile(paths.configFile, configYaml())

      const managedCompose = managedComposePath(paths, 'blog')
      const inspection: ComposeInspection = {
        composeFiles: [managedCompose],
        services: [{ name: 'web', ports: ['8080:80'], expose: [], envRefs: [], buildArgRefs: [] }],
      }
      const guided: GuidedInputs = {
        domains: [{ host: 'blog.example.com', service: 'web' }],
        configEntries: [
          { key: 'APP_KEY', value: 'secret', scope: 'runtime' },
          { key: 'PUBLIC_URL', value: 'https://blog.example.com', scope: 'both' },
        ],
      }
      const finalApp = {
        repo: upstream,
        branch: 'main',
        compose: [managedCompose],
        services: ['web'],
        domains: [{ host: 'blog.example.com', service: 'web', port: 20000, container_port: 80 }],
        env_file: '.env',
        build_args: { PUBLIC_URL: 'https://blog.example.com' },
      }
      await mkdir(paths.composeDir, { recursive: true })
      await writeFile(managedCompose, 'services:\n  web:\n    image: nginx\n')

      const support = new DefaultAddSupport({
        paths,
        claimIngress: async () => {
          throw new Error('claim ingress failed')
        },
      })
      const planner: AddPlanner = {
        inspectCompose: async () => inspection,
        collectGuidedInputs: async () => guided,
        buildResolvedApp: async () => finalApp,
        confirmPlan: async () => undefined,
      }
      const service = new AddService(support, planner)

      const result = await service.run({
        appName: 'blog',
        args: {},
        cfg,
        configFile: paths.configFile,
        inputs: {
          repo: upstream,
          persistPaths: [],
          ingressDefault: 'direct',
          parsedDomains: [],
          configEntries: [],
          healthChecks: [],
        },
        paths,
        draftApp: { repo: upstream, branch: 'main', domains: [], env_file: '.env' },
      })

      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toBe('claim ingress failed')

      expect(await stat(managedCompose).catch(() => null)).toBeNull()
      expect(await stat(repoPath(paths, 'blog', upstream)).catch(() => null)).toBeNull()
      expect(await readFile(join(paths.secretsDir, 'blog', '.env'), 'utf8')).toBe('')
      expect(await readFile(paths.configFile, 'utf8')).not.toContain('blog:')
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(upstream, { recursive: true, force: true })
    }
  })
})
