import { cloudflaredRunSetup, cloudflaredRunSetupResult } from '@/flows/cloudflared/setup.ts'
import { cloudflaredEnableConfig, cloudflaredReadStatus } from '@jib-module/cloudflared'
import { cliIsTextOutput } from '@jib/cli'
import { configLoad } from '@jib/config'
import { pathsGetPaths } from '@jib/paths'
import type { CommandModule } from 'yargs'
import { cmdCreateHandler } from './handler.ts'

/** Writes Cloudflare readiness from the same module and token state used by setup. */
function writeCloudflaredStatusText(status: ReturnType<typeof cloudflaredReadStatus>): void {
  process.stdout.write(
    status.configured ? 'cloudflare tunnel: configured\n' : 'cloudflare tunnel: not configured\n',
  )
  process.stdout.write(`  module: ${status.enabled ? 'enabled' : 'disabled'}\n`)
  process.stdout.write(`  token:  ${status.hasToken ? 'present' : 'missing'}\n`)
}

const cliCloudflaredCommands = [
  {
    command: 'cloudflared setup',
    describe: 'Configure Cloudflare Tunnel token',
    handler: cmdCreateHandler(cloudflaredSetupRunCommand),
  },
  {
    command: 'cloudflared status',
    describe: 'Show Cloudflare Tunnel status',
    handler: cmdCreateHandler(cloudflaredStatusRunCommand),
  },
] satisfies CommandModule[]

/** Runs Cloudflare setup and persists module enablement after successful configuration. */
async function cloudflaredSetupRunCommand() {
  const paths = pathsGetPaths()
  if (cliIsTextOutput()) {
    const configured = await cloudflaredRunSetup(paths)
    if (!configured) return
    const enableError = await cloudflaredEnableConfig(paths)
    return enableError instanceof Error ? enableError : { configured: true }
  }
  const result = await cloudflaredRunSetupResult(paths)
  if (result instanceof Error || result.status !== 'configured') return result
  const enableError = await cloudflaredEnableConfig(paths)
  return enableError instanceof Error ? enableError : result
}

/** Reads Cloudflare Tunnel status and writes the text status view when enabled. */
async function cloudflaredStatusRunCommand() {
  const paths = pathsGetPaths()
  const config = await configLoad(paths.configFile)
  if (config instanceof Error) return config
  const status = cloudflaredReadStatus(config, paths)
  if (cliIsTextOutput()) {
    writeCloudflaredStatusText(status)
    return
  }
  return status
}

export default cliCloudflaredCommands
