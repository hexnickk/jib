import { cloudflaredEnableConfig, cloudflaredReadStatus } from '@jib-module/cloudflared'
import { configLoad } from '@jib/config'
import { pathsGetPaths } from '@jib/paths'
import type { CommandModule } from 'yargs'
import { cloudflaredRunSetup } from '@/flows/cloudflared/setup.ts'
import { cmdCreateHandler } from './handler.ts'

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
  const configured = await cloudflaredRunSetup(paths)
  if (!configured) {
    return
  }
  const enableError = await cloudflaredEnableConfig(paths)
  return enableError instanceof Error ? enableError : { configured: true }
}

/** Reads Cloudflare Tunnel status and writes the text status view. */
async function cloudflaredStatusRunCommand() {
  const paths = pathsGetPaths()
  const config = await configLoad(paths.configFile)
  if (config instanceof Error) {
    return config
  }
  const status = cloudflaredReadStatus(config, paths)
  process.stdout.write(
    status.configured ? 'cloudflare tunnel: configured\n' : 'cloudflare tunnel: not configured\n',
  )
  process.stdout.write(`  module: ${status.enabled ? 'enabled' : 'disabled'}\n`)
  process.stdout.write(`  token:  ${status.hasToken ? 'present' : 'missing'}\n`)
}

export default cliCloudflaredCommands
