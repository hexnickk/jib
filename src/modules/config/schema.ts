import { z } from 'zod'
import { DEFAULT_INGRESS_MAX_BODY_SIZE, configNormalizeByteSize } from './byte-size.ts'

/** Accepts either a string or an array of strings; normalizes to `string[]`. */
export const StringOrSlice = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (typeof v === 'string' ? [v] : v))

export const GitHubSourceSchema = z.object({
  driver: z.literal('github'),
  type: z.enum(['key', 'app']),
  app_id: z.number().int().positive().optional(),
})

export const SourceSchema = z.discriminatedUnion('driver', [GitHubSourceSchema])

export const ByteSizeSchema = z.string().transform((value, ctx) => {
  const normalized = configNormalizeByteSize(value)
  if (!normalized) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'must be an integer byte size like 1048576, 10m, or 10mb',
    })
    return z.NEVER
  }
  return normalized
})

export const IngressConfigSchema = z.object({
  max_body_size: ByteSizeSchema.default(DEFAULT_INGRESS_MAX_BODY_SIZE),
})

// NOTE: `port` is the *host* port jib proxies to, and is only needed when a
// service has ingress. It is optional at parse time because `jib add`
// populates it via `allocatePort` before the first `writeConfig`.
// `container_port` is the port exposed *inside* the container. Both are
// optional on input; the CLI fills them in only for ingress-backed routes.
export const DomainSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  container_port: z.number().int().min(1).max(65535).optional(),
  ingress: z.enum(['', 'direct', 'cloudflare-tunnel']).optional(),
  // Compose service name this domain targets. Required when the compose
  // file has multiple services; `jib add` auto-fills it for single-service
  // apps. The deploy engine uses it to attach the `!override` ports list to the
  // right service.
  service: z.string().min(1).optional(),
})

export const HealthCheckSchema = z.object({
  path: z.string(),
  port: z.number().int().min(1).max(65535),
})

export const PreDeployHookSchema = z.object({
  service: z.string().min(1),
})

export const AppSchema = z.object({
  repo: z.string().min(1),
  image: z.string().min(1).optional(),
  source: z.string().optional(),
  branch: z.string().default('main'),
  compose: StringOrSlice.optional(),
  health: z.array(HealthCheckSchema).optional(),
  pre_deploy: z.array(PreDeployHookSchema).optional(),
  domains: z.array(DomainSchema).default([]),
  services: z.array(z.string()).optional(),
})

export const TunnelConfigSchema = z.object({
  provider: z.literal('cloudflare'),
  tunnel_id: z.string().optional(),
  account_id: z.string().optional(),
})

export const ConfigSchema = z.object({
  config_version: z.number().int().positive(),
  poll_interval: z.string().default('5m'),
  modules: z.record(z.string(), z.boolean()).optional().default({}),
  sources: z.record(z.string(), SourceSchema).optional().default({}),
  apps: z.record(z.string(), AppSchema).default({}),
  ingress: IngressConfigSchema.optional(),
  tunnel: TunnelConfigSchema.optional(),
})

export type GitHubSource = z.infer<typeof GitHubSourceSchema>
export type Source = z.infer<typeof SourceSchema>
export type IngressConfig = z.infer<typeof IngressConfigSchema>
export type Domain = z.infer<typeof DomainSchema>
export type HealthCheck = z.infer<typeof HealthCheckSchema>
export type PreDeployHook = z.infer<typeof PreDeployHookSchema>
export type App = z.infer<typeof AppSchema>
export type TunnelConfig = z.infer<typeof TunnelConfigSchema>
export type Config = z.infer<typeof ConfigSchema>
