import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import {
  INIT_ALL_MODULES,
  initInstalledOptionalModules,
  initOptionalModules,
  initPendingOptionalModuleNames,
  initRequiredModules,
  initResolveModules,
  initUnseenOptionalModules,
} from './registry.ts'

const REQUIRED_NAMES = ['watcher', 'ingress']
const OPTIONAL_NAMES = ['cloudflared']

function configWith(modules: Record<string, boolean>): Config {
  return { config_version: 3, poll_interval: '5m', modules, sources: {}, apps: {} } as Config
}

describe('module registry', () => {
  test('all first-party modules are present in dependency order', () => {
    expect(INIT_ALL_MODULES.map((mod) => mod.manifest.name)).toEqual([
      'watcher',
      'ingress',
      'cloudflared',
    ])
  })

  test('initRequiredModules returns the core install set', () => {
    const names = initRequiredModules().map((m) => m.manifest.name)
    expect(names).toEqual(REQUIRED_NAMES)
  })

  test('initOptionalModules returns the opt-in module set', () => {
    const names = initOptionalModules().map((m) => m.manifest.name)
    expect(names).toEqual(OPTIONAL_NAMES)
  })

  test('initResolveModules looks up by name', () => {
    const mods = initResolveModules(['ingress', 'cloudflared'])
    expect(mods.map((m) => m.manifest.name)).toEqual(['ingress', 'cloudflared'])
  })

  test('initResolveModules ignores unknown names', () => {
    const mods = initResolveModules(['ingress', 'nonexistent'])
    expect(mods.map((m) => m.manifest.name)).toEqual(['ingress'])
  })

  test('initInstalledOptionalModules returns modules with true', () => {
    const config = configWith({ cloudflared: true })
    const names = initInstalledOptionalModules(config).map((m) => m.manifest.name)
    expect(names).toEqual(['cloudflared'])
  })

  test('initUnseenOptionalModules returns modules not in config.modules', () => {
    const config = configWith({ cloudflared: true })
    const names = initUnseenOptionalModules(config).map((m) => m.manifest.name)
    expect(names).toEqual([])
  })

  test('initUnseenOptionalModules returns all when modules is empty', () => {
    const config = configWith({})
    const names = initUnseenOptionalModules(config).map((m) => m.manifest.name)
    expect(names).toEqual(OPTIONAL_NAMES)
  })

  test('initUnseenOptionalModules returns none when all are decided', () => {
    const config = configWith({ cloudflared: true })
    const names = initUnseenOptionalModules(config).map((m) => m.manifest.name)
    expect(names).toEqual([])
  })

  test('initPendingOptionalModuleNames returns undecided optional module names', () => {
    expect(initPendingOptionalModuleNames(configWith({}))).toEqual(['cloudflared'])
    expect(initPendingOptionalModuleNames(configWith({ cloudflared: false }))).toEqual([])
  })
})
