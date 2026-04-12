import { describe, expect, test } from 'bun:test'
import type { App } from '@jib/config'
import { makeDeps, makeParams } from './service.test-support.ts'

describe('add flow rollback', () => {
  test('post-config failures roll back repo, secrets, and remove only the failed app', async () => {
    const { calls, flow, warnings, writtenConfigs } = makeDeps('claimRoutes', true)

    const result = await flow.run(makeParams())
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe('claimRoutes failed')
    expect(calls).toContain('rollbackRepo')
    expect(calls).toContain('loadConfig')
    expect(calls).toContain('removeSecret:APP_KEY')
    expect(calls).toContain('removeSecret:PUBLIC_URL')
    expect(warnings).toEqual([])

    const rollbackConfig = writtenConfigs.at(-1)
    expect(rollbackConfig?.apps.blog).toBeUndefined()
    expect(rollbackConfig?.apps.worker).toBeDefined()
    expect(rollbackConfig?.apps.existing).toBeDefined()
  })

  test('cleanup removes a managed compose file written during add', async () => {
    const base = makeDeps()
    const managedApp = {
      repo: 'owner/blog',
      branch: 'main',
      compose: [base.managedCompose],
      services: ['web'],
      domains: [{ host: 'blog.example.com', service: 'web', port: 20000, container_port: 80 }],
      env_file: '.env',
    } satisfies App
    const { calls, flow } = makeDeps('claimRoutes', false, false, false, managedApp)

    const result = await flow.run(makeParams())
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe('claimRoutes failed')
    expect(calls).toContain('removeManagedCompose:blog')
  })

  test('cleanup keeps going when repo rollback itself fails', async () => {
    const { calls, flow, warnings, writtenConfigs } = makeDeps('claimRoutes', true, false, true)

    const result = await flow.run(makeParams())
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe('claimRoutes failed')
    expect(calls).toContain('rollbackRepo')
    expect(calls).toContain('loadConfig')
    expect(calls).toContain('removeSecret:APP_KEY')
    expect(calls).toContain('removeSecret:PUBLIC_URL')
    expect(warnings).toContain('repo rollback: rollbackRepo failed')
    expect(writtenConfigs.at(-1)?.apps.blog).toBeUndefined()
    expect(writtenConfigs.at(-1)?.apps.worker).toBeDefined()
  })
})
