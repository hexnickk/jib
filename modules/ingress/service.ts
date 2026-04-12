import type { App } from '@jib/config'
import { IngressMissingPortError } from './errors.ts'
import type { IngressClaim, IngressOperator, IngressProgress } from './types.ts'

export function buildIngressClaim(
  app: string,
  appCfg: App,
): IngressClaim | IngressMissingPortError | null {
  if (appCfg.domains.length === 0) return null
  const domains: IngressClaim['domains'] = []
  for (const domain of appCfg.domains) {
    const port = getIngressPort(app, domain.host, domain.port)
    if (port instanceof IngressMissingPortError) return port
    domains.push({
      host: domain.host,
      port,
      isTunnel: domain.ingress === 'cloudflare-tunnel',
    })
  }
  return {
    app,
    domains,
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
  if (claim instanceof IngressMissingPortError) throw claim
  await operator.claim(claim, onProgress)
}

export async function releaseIngress(
  operator: IngressOperator,
  app: string,
  onProgress?: (progress: IngressProgress) => void,
): Promise<void> {
  await operator.release(app, onProgress)
}

function getIngressPort(
  app: string,
  host: string,
  port: number | undefined,
): number | IngressMissingPortError {
  if (port !== undefined) return port
  return new IngressMissingPortError(app, host)
}
