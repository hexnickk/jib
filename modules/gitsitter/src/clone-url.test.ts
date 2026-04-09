import { describe, expect, test } from 'bun:test'
import type { App, Config } from '@jib/config'
import { cloneURL } from './clone-url.ts'

const cfg = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  apps: {},
  github: {
    providers: {
      appy: { type: 'app', app_id: 1 },
      keyy: { type: 'key' },
    },
  },
} as Config

function app(provider?: string): App {
  return {
    repo: 'acme/site',
    branch: 'main',
    domains: [],
    env_file: '.env',
    ...(provider ? { provider } : {}),
  }
}

describe('cloneURL', () => {
  test('public GitHub slugs default to anonymous HTTPS', () => {
    expect(cloneURL(app(), cfg)).toBe('https://github.com/acme/site.git')
  })

  test('deploy-key providers use SSH', () => {
    expect(cloneURL(app('keyy'), cfg)).toBe('git@github.com:acme/site.git')
  })

  test('GitHub App providers use HTTPS', () => {
    expect(cloneURL(app('appy'), cfg)).toBe('https://github.com/acme/site.git')
  })
})
