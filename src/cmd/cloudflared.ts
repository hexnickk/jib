import { getCloudflaredStatus } from '@jib-module/cloudflared'
import { isTextOutput } from '@jib/cli'
import { loadConfig } from '@jib/config'
import { getPaths } from '@jib/paths'
import { defineCommand } from 'citty'
import { runCloudflaredSetup } from '../modules/cloudflared/setup.ts'

function printCloudflaredStatus(status: ReturnType<typeof getCloudflaredStatus>): void {
  process.stdout.write(
    status.configured ? 'cloudflare tunnel: configured\n' : 'cloudflare tunnel: not configured\n',
  )
  if (!status.configured || !status.tunnelId) return
  process.stdout.write(`  tunnel id:  ${status.tunnelId}\n`)
  process.stdout.write(`  account id: ${status.accountId ?? '(unknown)'}\n`)
}

const setupCmd = defineCommand({
  meta: { name: 'setup', description: 'Configure Cloudflare Tunnel token' },
  async run() {
    await runCloudflaredSetup(getPaths())
  },
})

const statusCmd = defineCommand({
  meta: { name: 'status', description: 'Show Cloudflare Tunnel status' },
  async run() {
    const paths = getPaths()
    const config = await loadConfig(paths.configFile)
    const status = getCloudflaredStatus(config)
    if (isTextOutput()) return printCloudflaredStatus(status)
    return status
  },
})

export default defineCommand({
  meta: { name: 'cloudflared', description: 'Manage Cloudflare Tunnel' },
  subCommands: { setup: setupCmd, status: statusCmd },
})
