import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import type { Module, ModuleContext } from '@jib/core'
import { type CommandDef, defineCommand } from 'citty'
import {
  type FirstPartyModule,
  moduleSubCommands,
  modulesWithCli,
  optionalModules,
  requiredModules,
  resolveModules,
  resolveRunnableModule,
  runnableModuleNames,
} from './module-registry.ts'

function fakeModule(
  mod: Module<Config> & { manifest: { name: string; required?: boolean } },
): FirstPartyModule {
  return mod
}

describe('module registry projections', () => {
  test('one registry can power cli, service, and init capability views', () => {
    const cliOnly = fakeModule({
      manifest: { name: 'cli-only' },
      cli: [
        defineCommand({
          meta: { name: 'fake-cli', description: 'fake cli command' },
        }),
      ],
    })
    const serviceOnly = fakeModule({
      manifest: { name: 'service-only', required: true },
      start: async (_ctx: ModuleContext<Config>) => undefined,
    })
    const setupModule = fakeModule({
      manifest: { name: 'setup-module' },
      install: async (_ctx: ModuleContext<Config>) => undefined,
      setup: async (_ctx: ModuleContext<Config>) => undefined,
    })
    const registry = [cliOnly, serviceOnly, setupModule] as const

    expect(requiredModules(registry).map((mod) => mod.manifest.name)).toEqual(['service-only'])
    expect(optionalModules(registry).map((mod) => mod.manifest.name)).toEqual([
      'cli-only',
      'setup-module',
    ])
    expect(modulesWithCli(registry).map((mod) => mod.manifest.name)).toEqual(['cli-only'])
    expect(Object.keys(moduleSubCommands(registry))).toEqual(['fake-cli'])
    expect(runnableModuleNames(registry)).toEqual(['service-only'])
    expect(resolveRunnableModule('service-only', registry)).toBe(serviceOnly)
    expect(
      resolveModules(['setup-module', 'service-only'], registry).map((mod) => mod.manifest.name),
    ).toEqual(['service-only', 'setup-module'])
    expect(typeof resolveModules(['setup-module'], registry)[0]?.setup).toBe('function')
    expect(typeof resolveModules(['setup-module'], registry)[0]?.install).toBe('function')
  })

  test('duplicate top-level module CLI names are rejected', () => {
    const first = fakeModule({
      manifest: { name: 'first' },
      cli: [defineCommand({ meta: { name: 'shared', description: 'first command' } })],
    })
    const second = fakeModule({
      manifest: { name: 'second' },
      cli: [defineCommand({ meta: { name: 'shared', description: 'second command' } })],
    })

    expect(() => moduleSubCommands([first, second])).toThrow(
      'module CLI command "shared" is exported more than once',
    )
  })

  test('module CLI commands must expose meta.name', () => {
    const broken = fakeModule({
      manifest: { name: 'broken' },
      cli: [{ meta: { description: 'missing name' } } as CommandDef],
    })

    expect(() => moduleSubCommands([broken])).toThrow(
      'module "broken" exports a CLI command without meta.name',
    )
  })
})
