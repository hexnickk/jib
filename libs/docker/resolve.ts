import type { App, Domain } from '@jib/config'
import { consola } from 'consola'
import {
  type ComposeService,
  hasPublishedPorts,
  inferContainerPort,
  parseComposeServices,
} from './parse.ts'

const FALLBACK_CONTAINER_PORT = 80

/**
 * Parse the compose file from the prepared workdir, resolve each ingress
 * mapping's `service` + `container_port`, and warn loudly if the user's
 * compose already publishes ports that jib will later replace via
 * `!override`. Pure aside from the consola warnings — no disk writes.
 */
export function resolveFromCompose(appCfg: App, workdir: string): App {
  let parsed: ComposeService[]
  try {
    parsed = parseComposeServices(workdir, appCfg.compose ?? [])
  } catch (err) {
    throw new Error(`failed to parse compose file: ${err instanceof Error ? err.message : err}`)
  }
  if (parsed.length === 0) throw new Error('compose file has no services')
  if (appCfg.domains.length === 0) return appCfg
  const byName = new Map(parsed.map((s) => [s.name, s]))
  const single = parsed.length === 1 ? parsed[0]?.name : undefined
  const publishing = new Map<string, ComposeService>()

  const nextDomains: Domain[] = appCfg.domains.map((d) => {
    const serviceName = d.service ?? single
    if (!serviceName) {
      throw new Error(
        `compose has multiple services (${parsed.map((s) => s.name).join(', ')}); specify =service in --domain for ${d.host}`,
      )
    }
    const svc = byName.get(serviceName)
    if (!svc) throw new Error(`--domain ${d.host}: compose has no service "${serviceName}"`)
    if (hasPublishedPorts(svc)) publishing.set(svc.name, svc)
    const containerPort = d.container_port ?? resolvePort(svc)
    return { ...d, service: svc.name, container_port: containerPort }
  })

  if (publishing.size > 0) warnPublished(publishing, nextDomains)
  return { ...appCfg, domains: nextDomains }
}

function resolvePort(svc: ComposeService): number {
  const inferred = inferContainerPort(svc)
  if (inferred !== undefined) return inferred
  consola.warn(
    `could not infer container port for service "${svc.name}"; defaulting to ${FALLBACK_CONTAINER_PORT}`,
  )
  return FALLBACK_CONTAINER_PORT
}

function warnPublished(publishing: Map<string, ComposeService>, domains: Domain[]): void {
  for (const [name, svc] of publishing) {
    const original = svc.ports.map((p) => JSON.stringify(p)).join(', ')
    const replacements = domains
      .filter((d) => d.service === name)
      .map((d) => `${d.port}:${d.container_port}`)
      .join(', ')
    consola.warn(
      `service "${name}" publishes ports in compose (${original}); jib will replace with [${replacements}] via !override at deploy time.`,
    )
  }
  consola.warn('consider removing `ports:` from your compose file to avoid confusion.')
}
