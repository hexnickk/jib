import { cli as cloudflaredCli } from '@jib-module/cloudflared'
import { cli as githubCli } from '@jib-module/github'
import type { CommandDef } from 'citty'

/**
 * Statically aggregates `cli.ts` exports from every module that publishes a
 * user-facing CLI tree. Each module exports `CommandDef[]` — usually a single
 * top-level group (e.g. `github`, `cloudflared`). We flatten them into a
 * `{ name: CommandDef }` map keyed on each command's `meta.name` so
 * `main.ts` can plug them straight into citty's `subCommands`.
 *
 * Keeping this list static (rather than a glob/loader) is intentional:
 * `bun build --compile` needs every import visible at build time.
 */
const MODULE_CLIS: readonly CommandDef[][] = [githubCli, cloudflaredCli]

export function moduleSubCommands(): Record<string, CommandDef> {
  const out: Record<string, CommandDef> = {}
  for (const list of MODULE_CLIS) {
    for (const cmd of list) {
      const name = resolveName(cmd)
      if (name) out[name] = cmd
    }
  }
  return out
}

function resolveName(cmd: CommandDef): string | undefined {
  const meta = (cmd as { meta?: unknown }).meta
  if (meta && typeof meta === 'object' && 'name' in meta) {
    const n = (meta as { name?: unknown }).name
    if (typeof n === 'string') return n
  }
  return undefined
}
