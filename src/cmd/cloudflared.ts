import { cloudflaredRunSetup, cloudflaredRunSetupResult } from '@/flows/cloudflared/setup.ts'
import { cloudflaredReadStatus } from '@jib-module/cloudflared'
import { cliIsTextOutput } from '@jib/cli'
import { configLoad } from '@jib/config'
import { pathsGetPaths } from '@jib/paths'
import type { CommandModule } from 'yargs'
import { cmdCreateHandler } from './handler.ts'

/** Writes the cloudflared status block used in text mode. */
function writeCloudflaredStatusText(status: ReturnType<typeof cloudflaredReadStatus>): void {
  process.stdout.write(
    status.configured ? 'cloudflare tunnel: configured\n' : 'cloudflare tunnel: not configured\n',
  )
  if (!status.configured || !status.tunnelId) return
  process.stdout.write(`  tunnel id:  ${status.tunnelId}\n`)
  process.stdout.write(`  account id: ${status.accountId ?? '(unknown)'}\n`)
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

/** Runs Cloudflare Tunnel setup and returns its non-text result or typed error. */
async function cloudflaredSetupRunCommand() {
  const paths = pathsGetPaths()
  if (cliIsTextOutput()) {
    await cloudflaredRunSetup(paths)
    return
  }
  return await cloudflaredRunSetupResult(paths)
}

/** Reads Cloudflare Tunnel status and writes the text status view when enabled. */
async function cloudflaredStatusRunCommand() {
  const paths = pathsGetPaths()
  const config = await configLoad(paths.configFile)
  if (config instanceof Error) return config
  const status = cloudflaredReadStatus(config)
  if (cliIsTextOutput()) {
    writeCloudflaredStatusText(status)
    return
  }
  return status
}

export default cliCloudflaredCommands
