import type { App } from '@jib/config'
import type { OverrideService } from '@jib/docker'

/**
 * Group ingress mappings by target compose service and build the
 * `OverrideService[]` list the deploy flow passes to `writeOverride`. Only
 * services targeted by ingress receive a jib-managed `ports:` replacement.
 */
export function buildOverrideServices(
  parsed: { name: string }[],
  domains: App['domains'],
): OverrideService[] {
  const byService = new Map<string, { host: number; container: number }[]>()
  const single = parsed.length === 1 ? parsed[0]?.name : undefined
  for (const domain of domains) {
    const target = domain.service ?? single
    if (!target || domain.port === undefined || domain.container_port === undefined) continue
    const ports = byService.get(target) ?? []
    ports.push({ host: domain.port, container: domain.container_port })
    byService.set(target, ports)
  }

  return parsed
    .filter((service) => byService.has(service.name))
    .map((service) => ({ name: service.name, ports: byService.get(service.name) ?? [] }))
}
