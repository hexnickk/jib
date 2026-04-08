import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import {
  ALL_MODULES,
  installedOptionalModules,
  optionalModules,
  requiredModules,
  resolveModules,
  unseenOptionalModules,
} from './registry.ts'

const REQUIRED_NAMES = ['nats', 'deployer', 'gitsitter', 'nginx']
const OPTIONAL_NAMES = ['cloudflared', 'github']

function configWith(modules: Record<string, boolean>): Config {
  return { config_version: 3, poll_interval: '5m', modules, apps: {} } as Config
}

describe('module registry', () => {
  test('ALL_MODULES has 6 entries', () => {
    expect(ALL_MODULES).toHaveLength(6)
  })

  test('requiredModules returns exactly the 4 core modules', () => {
    const names = requiredModules().map((m) => m.manifest.name)
    expect(names).toEqual(REQUIRED_NAMES)
  })

  test('optionalModules returns the 2 optional modules', () => {
    const names = optionalModules().map((m) => m.manifest.name)
    expect(names).toEqual(OPTIONAL_NAMES)
  })

  test('resolveModules looks up by name', () => {
    const mods = resolveModules(['nginx', 'cloudflared'])
    expect(mods.map((m) => m.manifest.name)).toEqual(['nginx', 'cloudflared'])
  })

  test('resolveModules ignores unknown names', () => {
    const mods = resolveModules(['nginx', 'nonexistent'])
    expect(mods.map((m) => m.manifest.name)).toEqual(['nginx'])
  })

  test('installedOptionalModules returns modules with true', () => {
    const config = configWith({ cloudflared: true, github: false })
    const names = installedOptionalModules(config).map((m) => m.manifest.name)
    expect(names).toEqual(['cloudflared'])
  })

  test('unseenOptionalModules returns modules not in config.modules', () => {
    const config = configWith({ cloudflared: true })
    const names = unseenOptionalModules(config).map((m) => m.manifest.name)
    expect(names).toEqual(['github'])
  })

  test('unseenOptionalModules returns all when modules is empty', () => {
    const config = configWith({})
    const names = unseenOptionalModules(config).map((m) => m.manifest.name)
    expect(names).toEqual(OPTIONAL_NAMES)
  })

  test('unseenOptionalModules returns none when all are decided', () => {
    const config = configWith({ cloudflared: true, github: false })
    const names = unseenOptionalModules(config).map((m) => m.manifest.name)
    expect(names).toEqual([])
  })
})
