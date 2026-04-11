import { describe, expect, test } from 'bun:test'
import type { App, Config } from '@jib/config'
import { cloneURL } from './driver.ts'

const cfg = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  sources: {
    appy: { driver: 'github', type: 'app', app_id: 1 },
    keyy: { driver: 'github', type: 'key' },
  },
  apps: {},
} as Config

function app(source?: string): App {
  return {
    repo: 'acme/site',
    branch: 'main',
    domains: [],
    env_file: '.env',
    ...(source ? { source } : {}),
  }
}

describe('GitHub source driver', () => {
  test('public GitHub slugs default to anonymous HTTPS', () => {
    expect(cloneURL(app(), cfg)).toBe('https://github.com/acme/site.git')
  })

  test('deploy-key sources use SSH', () => {
    expect(cloneURL(app('keyy'), cfg)).toBe('git@github.com:acme/site.git')
  })

  test('GitHub App sources use HTTPS', () => {
    expect(cloneURL(app('appy'), cfg)).toBe('https://github.com/acme/site.git')
  })
})
