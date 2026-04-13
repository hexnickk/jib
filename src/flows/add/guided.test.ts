import { describe, expect, test } from 'bun:test'
import {
  addAssignCliDomainsToServices,
  addMergeGuidedServiceAnswers,
  addParseEnvEntry,
  addRenderPlanSummary,
  addRequiredConfigScopes,
  addShouldDefaultExposeService,
  addSplitCommaValues,
  addSummarizeComposeServices,
  addValidateEnvEntry,
} from './guided.ts'

describe('guided add helpers', () => {
  test('single-service web app can collect a domain and scoped config', () => {
    const services = addSummarizeComposeServices([
      { name: 'web', ports: ['8080:80'], expose: [], envRefs: [], buildArgRefs: [] },
    ])

    const [service] = services
    expect(service).toBeDefined()
    expect(
      addShouldDefaultExposeService(service as NonNullable<typeof service>, services.length),
    ).toBe(true)

    const merged = addMergeGuidedServiceAnswers(
      [],
      ['web'],
      [
        {
          service: 'web',
          expose: true,
          domainHosts: ['demo.example.com'],
          configEntries: [
            { key: 'DATABASE_URL', value: 'postgres://db', scope: 'runtime' },
            { key: 'VITE_HOST_URL', value: 'https://demo.example.com', scope: 'build' },
          ],
        },
      ],
      'direct',
    )
    if (merged instanceof Error) throw merged

    expect(merged.domains).toEqual([{ host: 'demo.example.com', service: 'web' }])
    expect(merged.configEntries).toEqual([
      { key: 'DATABASE_URL', value: 'postgres://db', scope: 'runtime' },
      { key: 'VITE_HOST_URL', value: 'https://demo.example.com', scope: 'build' },
    ])
  })

  test('multi-service app merges repeated config keys across scopes', () => {
    const merged = addMergeGuidedServiceAnswers(
      [{ host: 'app.example.com', service: 'web' }],
      ['web', 'worker'],
      [
        {
          service: 'web',
          expose: true,
          configEntries: [{ key: 'API_URL', value: 'https://api', scope: 'build' }],
        },
        {
          service: 'worker',
          expose: false,
          configEntries: [{ key: 'API_URL', value: 'https://api', scope: 'runtime' }],
        },
      ],
      'direct',
    )
    if (merged instanceof Error) throw merged

    expect(merged.domains).toEqual([{ host: 'app.example.com', service: 'web' }])
    expect(merged.configEntries).toEqual([{ key: 'API_URL', value: 'https://api', scope: 'both' }])
  })

  test('worker-only app remains valid without ingress', () => {
    const merged = addMergeGuidedServiceAnswers(
      [],
      ['worker'],
      [{ service: 'worker', expose: false }],
      'direct',
    )
    if (merged instanceof Error) throw merged

    expect(merged.domains).toEqual([])
    expect(merged.configEntries).toEqual([])
  })

  test('multi-service cli domains must name a service in non-interactive mode', () => {
    const assigned = addAssignCliDomainsToServices([{ host: 'demo.example.com' }], ['web', 'api'])

    expect(assigned.domains).toEqual([{ host: 'demo.example.com' }])
    expect(assigned.issues).toEqual([
      {
        field: 'domain[0].service',
        message:
          'compose has multiple services (web, api); rerun with --domain host=demo.example.com,service=<web|api>',
      },
    ])
  })

  test('requiredConfigScopes merges runtime and build references for the same key', () => {
    expect(
      addRequiredConfigScopes({
        name: 'web',
        publishesPorts: true,
        envRefs: ['PUBLIC_URL', 'DATABASE_URL'],
        buildArgRefs: ['PUBLIC_URL'],
      }),
    ).toEqual(
      new Map([
        ['PUBLIC_URL', 'both'],
        ['DATABASE_URL', 'runtime'],
      ]),
    )
  })

  test('summary renders services plus runtime and build config expectations', () => {
    const summary = addRenderPlanSummary({
      app: 'demo',
      composeFiles: ['compose.yml'],
      services: [
        { name: 'web', inferredContainerPort: 80, publishesPorts: true },
        { name: 'worker', publishesPorts: false },
      ],
      domains: [{ host: 'demo.example.com', service: 'web' }],
      configEntries: [
        { key: 'DATABASE_URL', value: 'postgres://db', scope: 'runtime' },
        { key: 'VITE_HOST_URL', value: 'https://demo.example.com', scope: 'build' },
        { key: 'PUBLIC_URL', value: 'https://demo.example.com', scope: 'both' },
      ],
      envFile: '.env',
    })

    expect(summary).toContain('app "demo"')
    expect(summary).toContain('web: demo.example.com')
    expect(summary).toContain('worker: internal only')
    expect(summary).toContain('runtime vars (.env): DATABASE_URL, PUBLIC_URL')
    expect(summary).toContain('build args: VITE_HOST_URL, PUBLIC_URL')
  })

  test('env entry parser accepts KEY=VALUE format and rejects missing equals', () => {
    expect(addParseEnvEntry('API_KEY=secret')).toEqual({ key: 'API_KEY', value: 'secret' })
    expect(addValidateEnvEntry('API_KEY=secret')).toBeUndefined()
    expect(addValidateEnvEntry('API_KEY')).toContain('expected KEY=VALUE')
  })

  test('comma splitter treats missing optional prompt input as empty', () => {
    expect(addSplitCommaValues(undefined)).toEqual([])
    expect(addSplitCommaValues(null)).toEqual([])
  })
})
