import { describe, expect, test } from 'bun:test'
import { buildIngressClaim } from './service.ts'

describe('ingress service', () => {
  test('buildIngressClaim maps configured domains into an ingress claim', () => {
    const claim = buildIngressClaim('web', {
      repo: 'acme/web',
      branch: 'main',
      domains: [
        { host: 'web.example.com', port: 20000, ingress: 'direct' },
        { host: 'edge.example.com', port: 20001, ingress: 'cloudflare-tunnel' },
      ],
      env_file: '.env',
    })
    expect(claim).toEqual({
      app: 'web',
      domains: [
        { host: 'web.example.com', port: 20000, isTunnel: false },
        { host: 'edge.example.com', port: 20001, isTunnel: true },
      ],
    })
  })

  test('buildIngressClaim returns null when the app has no domains', () => {
    const claim = buildIngressClaim('web', {
      repo: 'acme/web',
      branch: 'main',
      domains: [],
      env_file: '.env',
    })
    expect(claim).toBeNull()
  })

  test('buildIngressClaim fails clearly when a domain is missing its ingress port', () => {
    expect(() =>
      buildIngressClaim('web', {
        repo: 'acme/web',
        branch: 'main',
        domains: [{ host: 'web.example.com', ingress: 'direct' }],
        env_file: '.env',
      }),
    ).toThrow('ingress port missing for app "web" domain "web.example.com"')
  })
})
