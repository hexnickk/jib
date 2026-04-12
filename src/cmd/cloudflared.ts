import { cloudflaredReadStatus } from '@jib-module/cloudflared'
import { cliIsTextOutput } from '@jib/cli'
import { loadConfig } from '@jib/config'
import { getPaths } from '@jib/paths'
import { cloudflaredRunSetup, cloudflaredRunSetupResult } from '../modules/cloudflared/setup.ts'
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
      const paths = getPaths()
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
      const paths = getPaths()
      const config = await loadConfig(paths.configFile)
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
