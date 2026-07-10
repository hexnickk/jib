import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloudflaredSaveTunnelToken } from '@jib-module/cloudflared'
import { cliSetRuntime } from '@jib/cli'
import type { Config } from '@jib/config'
import type { ComposeService } from '@jib/docker'
import { ValidationError } from '@jib/errors'
import { pathsGetPaths } from '@jib/paths'
import { afterEach, describe, expect, test } from 'vitest'
import { addBuildResolvedApp, addCollectGuidedInputs } from './resolve.ts'
import type { AddInputs, ConfigEntry } from './types.ts'

const debugEnv = process.env.JIB_DEBUG

/** Restores CLI runtime state changed by non-interactive guided-input tests. */
function restoreRuntime(): void {
  cliSetRuntime({ interactive: 'auto', debug: false, stdinTty: true, stdoutTty: true })
  if (debugEnv === undefined) Reflect.deleteProperty(process.env, 'JIB_DEBUG')
  else process.env.JIB_DEBUG = debugEnv
}

afterEach(restoreRuntime)

function inputs(configEntries: ConfigEntry[] = []): AddInputs {
  return {
    repo: 'owner/demo',
    persistPaths: [],
    ingressDefault: 'direct',
    parsedDomains: [],
    configEntries,
    healthChecks: [],
  }
}

function service(partial: Partial<ComposeService> = {}): ComposeService {
  return {
    name: 'web',
    ports: [],
    expose: [],
    envRefs: [],
    buildArgRefs: [],
    ...partial,
  }
}

describe('addCollectGuidedInputs', () => {
  test('treats detected compose env refs as optional without prompts', async () => {
    cliSetRuntime({ interactive: 'never', debug: false, stdinTty: true, stdoutTty: true })

    const result = await addCollectGuidedInputs(inputs(), [
      service({ envRefs: ['TELEGRAM_BOT_TOKEN'] }),
    ])

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result.configEntries).toEqual([])
  })

  test('requires a managed token before resolving tunnel ingress', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-add-tunnel-'))
    const workdir = await mkdtemp(join(tmpdir(), 'jib-add-workdir-'))
    try {
      const paths = pathsGetPaths(root)
      const config: Config = {
        config_version: 3,
        poll_interval: '5m',
        modules: { cloudflared: true },
        sources: {},
        apps: {},
      }
      await writeFile(join(workdir, 'compose.yml'), 'services:\n  web:\n    image: nginx\n')
      const build = () =>
        addBuildResolvedApp(
          config,
          paths,
          'demo',
          workdir,
          {},
          { ...inputs(), composeRaw: ['compose.yml'] },
          {
            composeFiles: ['compose.yml'],
            services: [service()],
          },
          {
            domains: [{ host: 'demo.example.com', service: 'web', ingress: 'cloudflare-tunnel' }],
            configEntries: [],
          },
        )

      const missingToken = await build()
      expect(missingToken).toBeInstanceOf(ValidationError)
      expect((missingToken as Error).message).toContain('tunnel token')

      expect(await cloudflaredSaveTunnelToken(paths, 'eyJhIjoiNzQ')).toBe(true)
      const app = await build()
      if (app instanceof Error) throw app
      expect(app.domains[0]?.ingress).toBe('cloudflare-tunnel')
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(workdir, { recursive: true, force: true })
    }
  })

  test('keeps env entries supplied by CLI args', async () => {
    cliSetRuntime({ interactive: 'never', debug: false, stdinTty: true, stdoutTty: true })
    const envEntry = {
      key: 'TELEGRAM_BOT_TOKEN',
      value: 'token',
      scope: 'runtime' as const,
    }

    const result = await addCollectGuidedInputs(inputs([envEntry]), [service()])

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result.configEntries).toEqual([envEntry])
  })
})
