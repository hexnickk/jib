import { cloudflaredRunSetup, cloudflaredRunSetupResult } from '@/flows/cloudflared/setup.ts'
import { cloudflaredReadStatus } from '@jib-module/cloudflared'
import { cliIsTextOutput } from '@jib/cli'
import { configLoad } from '@jib/config'
import { pathsGetPaths } from '@jib/paths'
import type { CliCommand } from './command.ts'

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
    async run() {
      const paths = pathsGetPaths()
      if (cliIsTextOutput()) {
        await cloudflaredRunSetup(paths)
        return
      }
      return await cloudflaredRunSetupResult(paths)
    },
  },
  {
    command: 'cloudflared status',
    describe: 'Show Cloudflare Tunnel status',
    async run() {
      const paths = pathsGetPaths()
      const config = await configLoad(paths.configFile)
      if (config instanceof Error) return config
      const status = cloudflaredReadStatus(config)
      if (cliIsTextOutput()) {
        writeCloudflaredStatusText(status)
        return
      }
      return status
    },
  },
] satisfies CliCommand[]

export default cliCloudflaredCommands
