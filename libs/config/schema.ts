import { z } from 'zod'

/** Accepts either a string or an array of strings; normalizes to `string[]`. */
export const StringOrSlice = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (typeof v === 'string' ? [v] : v))

export const GitHubProviderSchema = z.object({
  type: z.enum(['key', 'app']),
  app_id: z.number().int().positive().optional(),
})

export const GitHubConfigSchema = z.object({
  providers: z.record(z.string(), GitHubProviderSchema).optional(),
})

// NOTE: `port` is optional at parse time because `jib add` populates it via
// `allocatePort` before the first `writeConfig`. Every code path that loads a
// config *after* jib has written it (operators, the deployer, the CLI on
// subsequent runs) will see a populated port — treat an undefined port as
// unreachable. The CLI is the single writer responsible for filling it in.
export const DomainSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  ingress: z.enum(['', 'direct', 'cloudflare-tunnel']).optional(),
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
  provider: z.string().optional(),
  branch: z.string().default('main'),
  compose: StringOrSlice.optional(),
  health: z.array(HealthCheckSchema).optional(),
  warmup: z.string().optional(),
  pre_deploy: z.array(PreDeployHookSchema).optional(),
  build_args: z.record(z.string(), z.string()).optional(),
  domains: z.array(DomainSchema).min(1),
  env_file: z.string().default('.env'),
  services: z.array(z.string()).optional(),
})

export const TunnelConfigSchema = z.object({
  provider: z.literal('cloudflare'),
  tunnel_id: z.string().optional(),
  account_id: z.string().optional(),
})

export const WebhookConfigSchema = z.object({
  enabled: z.boolean().default(true),
  url: z.string().min(1),
  secret_path: z.string().min(1),
  listen: z.string().default(':9876'),
})

export const ConfigSchema = z.object({
  config_version: z.literal(3),
  poll_interval: z.string().default('5m'),
  github: GitHubConfigSchema.optional(),
  apps: z.record(z.string(), AppSchema).default({}),
  tunnel: TunnelConfigSchema.optional(),
  webhook: WebhookConfigSchema.optional(),
})

export type GitHubProvider = z.infer<typeof GitHubProviderSchema>
export type GitHubConfig = z.infer<typeof GitHubConfigSchema>
export type Domain = z.infer<typeof DomainSchema>
export type HealthCheck = z.infer<typeof HealthCheckSchema>
export type PreDeployHook = z.infer<typeof PreDeployHookSchema>
export type App = z.infer<typeof AppSchema>
export type TunnelConfig = z.infer<typeof TunnelConfigSchema>
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>
export type Config = z.infer<typeof ConfigSchema>
