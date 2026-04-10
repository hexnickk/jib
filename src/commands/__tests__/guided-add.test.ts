import { describe, expect, test } from 'bun:test'
import {
  assignCliDomainsToServices,
  buildManualSecretPromptLines,
  buildSecretPromptMessage,
  mergeGuidedServiceAnswers,
  parseEnvEntry,
  renderAddPlanSummary,
  secretPromptPlaceholder,
  shouldDefaultExposeService,
  splitCommaValues,
  summarizeComposeServices,
  validateEnvEntry,
} from '../add-guided.ts'

describe('guided add helpers', () => {
  test('single-service web app can collect a domain and app secret', () => {
    const services = summarizeComposeServices([
      { name: 'web', ports: ['8080:80'], expose: [], envRefs: [] },
    ])

    const [service] = services
    expect(service).toBeDefined()
    expect(
      shouldDefaultExposeService(service as NonNullable<typeof service>, services.length),
    ).toBe(true)

    const merged = mergeGuidedServiceAnswers(
      [],
      ['web'],
      [
        {
          service: 'web',
          expose: true,
          domainHosts: ['demo.example.com'],
          secretKeys: ['APP_KEY'],
          envEntries: [{ key: 'DATABASE_URL', value: 'postgres://db' }],
        },
      ],
      'direct',
    )

    expect(merged.domains).toEqual([{ host: 'demo.example.com', service: 'web' }])
    expect(merged.envEntries).toEqual([{ key: 'DATABASE_URL', value: 'postgres://db' }])
    expect(merged.secretKeys.sort()).toEqual(['APP_KEY', 'DATABASE_URL'])
  })

  test('multi-service app keeps public and internal services separate', () => {
    const merged = mergeGuidedServiceAnswers(
      [{ host: 'app.example.com', service: 'web' }],
      ['web', 'worker'],
      [
        { service: 'web', expose: true, secretKeys: ['DATABASE_URL'] },
        { service: 'worker', expose: false, secretKeys: ['DATABASE_URL', 'QUEUE_TOKEN'] },
      ],
      'direct',
    )

    expect(merged.domains).toEqual([{ host: 'app.example.com', service: 'web' }])
    expect(merged.secretKeys.sort()).toEqual(['DATABASE_URL', 'QUEUE_TOKEN'])
  })

  test('worker-only app remains valid without ingress', () => {
    const merged = mergeGuidedServiceAnswers(
      [],
      ['worker'],
      [{ service: 'worker', expose: false }],
      'direct',
    )

    expect(merged.domains).toEqual([])
    expect(merged.secretKeys).toEqual([])
  })

  test('multi-service cli domains must name a service in non-interactive mode', () => {
    const assigned = assignCliDomainsToServices([{ host: 'demo.example.com' }], ['web', 'api'])

    expect(assigned.domains).toEqual([{ host: 'demo.example.com' }])
    expect(assigned.issues).toEqual([
      {
        field: 'domain[0].service',
        message:
          'compose has multiple services (web, api); rerun with --domain host=demo.example.com,service=<web|api>',
      },
    ])
  })

  test('summary renders services, ingress, and secret file expectations', () => {
    const summary = renderAddPlanSummary({
      app: 'demo',
      composeFiles: ['compose.yml'],
      services: [
        { name: 'web', inferredContainerPort: 80, publishesPorts: true },
        { name: 'worker', publishesPorts: false },
      ],
      domains: [{ host: 'demo.example.com', service: 'web' }],
      secretKeys: ['APP_KEY'],
      envFile: '.env',
    })

    expect(summary).toContain('app "demo"')
    expect(summary).toContain('web: demo.example.com')
    expect(summary).toContain('worker: internal only')
    expect(summary).toContain('secrets file: .env')
  })

  test('secret prompt copy explains that jib will prompt for key values next', () => {
    expect(buildSecretPromptMessage('blog', ['DATABASE_URL'])).toContain(
      'detected in docker-compose',
    )
    expect(buildSecretPromptMessage('blog', ['DATABASE_URL'])).toContain('values prompted next')
    expect(secretPromptPlaceholder()).toBe('DATABASE_URL, API_KEY')
    expect(buildManualSecretPromptLines()).toContain(
      'Jib could not detect any required secrets from docker-compose.',
    )
    expect(buildManualSecretPromptLines()).toContain('SECRET_KEY=VALUE')
  })

  test('env entry parser accepts KEY=VALUE format and rejects missing equals', () => {
    expect(parseEnvEntry('API_KEY=secret')).toEqual({ key: 'API_KEY', value: 'secret' })
    expect(validateEnvEntry('API_KEY=secret')).toBeUndefined()
    expect(validateEnvEntry('API_KEY')).toContain('expected KEY=VALUE')
  })

  test('comma splitter treats missing optional prompt input as empty', () => {
    expect(splitCommaValues(undefined)).toEqual([])
    expect(splitCommaValues(null)).toEqual([])
  })
})
