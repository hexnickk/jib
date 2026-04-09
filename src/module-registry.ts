import * as cloudflaredMod from '@jib-module/cloudflared'
import * as deployerMod from '@jib-module/deployer'
import * as githubMod from '@jib-module/github'
import * as gitsitterMod from '@jib-module/gitsitter'
import * as natsMod from '@jib-module/nats'
import * as nginxMod from '@jib-module/nginx'
import type { Config } from '@jib/config'
import { CliError, type Module, type ModuleManifest } from '@jib/core'
import type { CommandDef } from 'citty'

export type FirstPartyModule = Module<Config> & {
  manifest: ModuleManifest & { name: string }
}

export type CliModule = FirstPartyModule & { cli: readonly CommandDef[] }
export type RunnableModule = FirstPartyModule & {
  manifest: ModuleManifest & { name: string }
  start: NonNullable<FirstPartyModule['start']>
}

/** Static first-party module registry for bun build --compile visibility. */
export const MODULES: readonly FirstPartyModule[] = [
  natsMod,
  deployerMod,
  gitsitterMod,
  nginxMod,
  cloudflaredMod,
  githubMod,
]

export function allModules(
  registry: readonly FirstPartyModule[] = MODULES,
): readonly FirstPartyModule[] {
  return registry
}

export function requiredModules(
  registry: readonly FirstPartyModule[] = MODULES,
): FirstPartyModule[] {
  return registry.filter((mod) => mod.manifest.required)
}

export function optionalModules(
  registry: readonly FirstPartyModule[] = MODULES,
): FirstPartyModule[] {
  return registry.filter((mod) => !mod.manifest.required)
}

export function resolveModules(
  names: readonly string[],
  registry: readonly FirstPartyModule[] = MODULES,
): FirstPartyModule[] {
  const wanted = new Set(names)
  return registry.filter((mod) => wanted.has(mod.manifest.name))
}

export function modulesWithCli(registry: readonly FirstPartyModule[] = MODULES): CliModule[] {
  return registry.filter((mod): mod is CliModule => Array.isArray(mod.cli) && mod.cli.length > 0)
}

export function runnableModules(registry: readonly FirstPartyModule[] = MODULES): RunnableModule[] {
  return registry.filter((mod): mod is RunnableModule => typeof mod.start === 'function')
}

export function runnableModuleNames(registry: readonly FirstPartyModule[] = MODULES): string[] {
  return runnableModules(registry).map((mod) => mod.manifest.name)
}

export function resolveRunnableModule(
  name: string,
  registry: readonly FirstPartyModule[] = MODULES,
): RunnableModule | undefined {
  return runnableModules(registry).find((mod) => mod.manifest.name === name)
}

export function moduleSubCommands(
  registry: readonly FirstPartyModule[] = MODULES,
): Record<string, CommandDef> {
  const out: Record<string, CommandDef> = {}
  for (const mod of modulesWithCli(registry)) {
    for (const cmd of mod.cli) {
      const name = resolveCommandName(cmd)
      if (!name) {
        throw new CliError(
          'invalid_module_cli',
          `module "${mod.manifest.name}" exports a CLI command without meta.name`,
        )
      }
      if (out[name]) {
        throw new CliError(
          'duplicate_module_cli',
          `module CLI command "${name}" is exported more than once`,
          {
            details: { command: name, module: mod.manifest.name },
          },
        )
      }
      out[name] = cmd
    }
  }
  return out
}

function resolveCommandName(cmd: CommandDef): string | undefined {
  const meta = (cmd as { meta?: unknown }).meta
  if (meta && typeof meta === 'object' && 'name' in meta) {
    const name = (meta as { name?: unknown }).name
    if (typeof name === 'string') return name
  }
  return undefined
}
