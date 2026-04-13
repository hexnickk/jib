import type { App } from '@jib/config'
import { IngressMissingPortError } from './errors.ts'
import type { IngressClaim, IngressOperator, IngressProgress } from './types.ts'

/** Builds the ingress claim for one app, or returns a typed port error. */
export function ingressBuildClaim(
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

/** Applies the ingress claim through the active operator. */
export async function ingressClaim(
  operator: IngressOperator,
  app: string,
  appCfg: App,
  onProgress?: (progress: IngressProgress) => void,
): Promise<void> {
  const claim = ingressBuildClaim(app, appCfg)
  if (!claim) return
  if (claim instanceof IngressMissingPortError) throw claim
  await operator.claim(claim, onProgress)
}

/** Releases ingress state for an app through the active operator. */
export async function ingressRelease(
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
