/**
 * This module's config lives in `libs/config/schema.ts` as
 * `TunnelConfigSchema` — there's only one canonical schema for the tunnel
 * section and we re-export it here so callers can stay module-local.
 */
export { type TunnelConfig, TunnelConfigSchema } from '@jib/config'
