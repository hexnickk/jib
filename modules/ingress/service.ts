import type { App } from '@jib/config'
import type { IngressClaim, IngressOperator, IngressProgress } from './types.ts'

export function buildIngressClaim(app: string, appCfg: App): IngressClaim | null {
  if (appCfg.domains.length === 0) return null
  return {
    app,
    domains: appCfg.domains.map((domain) => ({
      host: domain.host,
      port: requireIngressPort(app, domain.host, domain.port),
      isTunnel: domain.ingress === 'cloudflare-tunnel',
    })),
  }
}

export async function claimIngress(
  operator: IngressOperator,
  app: string,
  appCfg: App,
  onProgress?: (progress: IngressProgress) => void,
): Promise<void> {
  const claim = buildIngressClaim(app, appCfg)
  if (!claim) return
  await operator.claim(claim, onProgress)
}

export async function releaseIngress(
  operator: IngressOperator,
  app: string,
  onProgress?: (progress: IngressProgress) => void,
): Promise<void> {
  await operator.release(app, onProgress)
}

function requireIngressPort(app: string, host: string, port: number | undefined): number {
  if (port !== undefined) return port
  throw new Error(`ingress port missing for app "${app}" domain "${host}"`)
}
