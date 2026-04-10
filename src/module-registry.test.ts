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
} from './module-registry.ts'

function fakeModule(
  mod: Module<Config> & { manifest: { name: string; required?: boolean } },
): FirstPartyModule {
  return mod
}

describe('module registry projections', () => {
  test('one registry can power cli and init capability views', () => {
    const cliOnly = fakeModule({
      manifest: { name: 'cli-only' },
      cli: [
        defineCommand({
          meta: { name: 'fake-cli', description: 'fake cli command' },
        }),
      ],
    })
    const requiredOnly = fakeModule({
      manifest: { name: 'required-only', required: true },
      install: async (_ctx: ModuleContext<Config>) => undefined,
    })
    const setupModule = fakeModule({
      manifest: { name: 'setup-module' },
      install: async (_ctx: ModuleContext<Config>) => undefined,
      setup: async (_ctx: ModuleContext<Config>) => undefined,
    })
    const registry = [cliOnly, requiredOnly, setupModule] as const

    expect(requiredModules(registry).map((mod) => mod.manifest.name)).toEqual(['required-only'])
    expect(optionalModules(registry).map((mod) => mod.manifest.name)).toEqual([
      'cli-only',
      'setup-module',
    ])
    expect(modulesWithCli(registry).map((mod) => mod.manifest.name)).toEqual(['cli-only'])
    expect(Object.keys(moduleSubCommands(registry))).toEqual(['fake-cli'])
    expect(
      resolveModules(['setup-module', 'required-only'], registry).map((mod) => mod.manifest.name),
    ).toEqual(['required-only', 'setup-module'])
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
