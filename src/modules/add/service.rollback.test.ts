import { describe, expect, test } from 'bun:test'
import type { App } from '@jib/config'
import { makeDeps, makeParams } from './service.test-support.ts'

describe('add flow rollback', () => {
  test('post-config failures roll back repo, secrets, and remove only the failed app', async () => {
    for (const failAt of ['writeSecondSecret', 'claimRoutes'] as const) {
      const { calls, flow, warnings, writtenConfigs } = makeDeps(failAt, true)

      await expect(flow.run(makeParams())).rejects.toThrow(`${failAt} failed`)
      expect(calls).toContain('rollbackRepo')
      expect(calls).toContain('loadConfig')
      expect(calls).toContain('removeSecret:APP_KEY')
      expect(calls.includes('removeSecret:PUBLIC_URL')).toBe(failAt === 'claimRoutes')
      expect(warnings).toEqual([])

      const rollbackConfig = writtenConfigs.at(-1)
      expect(rollbackConfig?.apps.blog).toBeUndefined()
      expect(rollbackConfig?.apps.worker).toBeDefined()
      expect(rollbackConfig?.apps.existing).toBeDefined()
    }
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

    await expect(flow.run(makeParams())).rejects.toThrow('claimRoutes failed')
    expect(calls).toContain('removeManagedCompose:blog')
  })

  test('cleanup falls back to the original snapshot when reloading config fails', async () => {
    const { flow, warnings, writtenConfigs } = makeDeps('claimRoutes', false, true)

    await expect(flow.run(makeParams())).rejects.toThrow('claimRoutes failed')
    expect(
      warnings.some((warning) => warning.includes('config cleanup load: loadConfig failed')),
    ).toBe(true)
    expect(writtenConfigs.at(-1)?.apps.blog).toBeUndefined()
    expect(writtenConfigs.at(-1)?.apps.existing).toBeDefined()
  })

  test('cleanup keeps going when repo rollback itself fails', async () => {
    const { calls, flow, warnings, writtenConfigs } = makeDeps('claimRoutes', true, false, true)

    await expect(flow.run(makeParams())).rejects.toThrow('claimRoutes failed')
    expect(calls).toContain('rollbackRepo')
    expect(calls).toContain('loadConfig')
    expect(calls).toContain('removeSecret:APP_KEY')
    expect(calls).toContain('removeSecret:PUBLIC_URL')
    expect(warnings).toContain('repo rollback: rollbackRepo failed')
    expect(writtenConfigs.at(-1)?.apps.blog).toBeUndefined()
    expect(writtenConfigs.at(-1)?.apps.worker).toBeDefined()
  })
})
