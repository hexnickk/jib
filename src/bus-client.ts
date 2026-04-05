/**
 * Legacy re-export. `withBus` now lives in `@jib/bus` so modules (e.g.
 * `modules/cloudflare/cli-domain.ts`) can reach it without importing from
 * `src/`. Existing CLI commands still import from `./bus-client` for minimal
 * churn; a follow-up may migrate them directly to `@jib/bus`.
 */
export { withBus } from '@jib/bus'
