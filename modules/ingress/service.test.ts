import { describe, expect, test } from 'bun:test'
import { IngressMissingPortError } from './errors.ts'
import { ingressBuildClaim, ingressClaim } from './service.ts'

describe('ingress service', () => {
  test('ingressBuildClaim maps configured domains into an ingress claim', () => {
    const claim = ingressBuildClaim('web', {
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

  test('ingressBuildClaim returns null when the app has no domains', () => {
    const claim = ingressBuildClaim('web', {
      repo: 'acme/web',
      branch: 'main',
      domains: [],
      env_file: '.env',
    })
    expect(claim).toBeNull()
  })

  test('ingressBuildClaim returns a typed error when a domain is missing its ingress port', () => {
    const claim = ingressBuildClaim('web', {
      repo: 'acme/web',
      branch: 'main',
      domains: [{ host: 'web.example.com', ingress: 'direct' }],
      env_file: '.env',
    })

    expect(claim).toBeInstanceOf(IngressMissingPortError)
    expect(claim).toMatchObject({
      message: 'ingress port missing for app "web" domain "web.example.com"',
    })
  })

  test('ingressClaim still fails at the boundary with the typed port error', async () => {
    await expect(
      ingressClaim(
        {
          claim: async () => undefined,
          release: async () => undefined,
        },
        'web',
        {
          repo: 'acme/web',
          branch: 'main',
          domains: [{ host: 'web.example.com', ingress: 'direct' }],
          env_file: '.env',
        },
      ),
    ).rejects.toBeInstanceOf(IngressMissingPortError)
  })
})
