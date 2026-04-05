import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { loadConfig, writeConfig } from '@jib/config'
import { getPaths } from '@jib/core'
import { isInteractive, promptConfirm, promptString } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'

/**
 * `jib webhook setup` — generates a shared secret, derives a receiver URL
 * from the first configured app's domain (prompting if none exist), writes
 * the secret to disk at 0600, and records a `webhook` block in config.yml.
 * The HTTP receiver itself lives in `modules/webhook` and runs under
 * `jib service start webhook`.
 */

function deriveUrl(cfg: Awaited<ReturnType<typeof loadConfig>>): string | undefined {
  for (const app of Object.values(cfg.apps)) {
    const host = app.domains[0]?.host
    if (host) return `https://${host}/webhooks/jib`
  }
  return undefined
}

function secretPathFor(root: string): string {
  return join(root, 'secrets', '_jib', 'webhook', 'secret')
}

async function writeSecret(path: string, secret: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, secret, { mode: 0o600 })
}

function printInstructions(url: string, secret: string, masked: boolean): void {
  consola.box(
    [
      'Configure your GitHub repository webhook:',
      `  Payload URL:  ${url}`,
      '  Content type: application/json',
      `  Secret:       ${masked ? '•'.repeat(12) : secret}`,
      '  Events:       Just the push event',
      '  SSL:          Enable verification',
    ].join('\n'),
  )
}

const setup = defineCommand({
  meta: { name: 'setup', description: 'Generate webhook secret + configure receiver URL' },
  args: {
    url: { type: 'string', description: 'Override webhook URL (skip derivation)' },
    listen: { type: 'string', description: 'Receiver listen address (default :9876)' },
  },
  async run({ args }) {
    const paths = getPaths()
    const cfg = await loadConfig(paths.configFile)

    let url = args.url ?? deriveUrl(cfg) ?? ''
    if (!url) {
      if (!isInteractive()) {
        consola.error('no domain found in config and --url not supplied')
        process.exit(1)
      }
      url = await promptString({
        message: 'Webhook URL (publicly reachable)',
        placeholder: 'https://example.com/webhooks/jib',
      })
    }

    const secret = randomBytes(32).toString('hex')
    const secretPath = secretPathFor(paths.root)
    await writeSecret(secretPath, secret)
    consola.success(`secret written to ${secretPath}`)

    cfg.webhook = {
      enabled: true,
      url,
      secret_path: secretPath,
      listen: args.listen ?? ':9876',
    }
    await writeConfig(paths.configFile, cfg)
    consola.success('config updated with webhook block')

    printInstructions(url, secret, true)
    if (isInteractive()) {
      const reveal = await promptConfirm({ message: 'Reveal secret?', initialValue: false })
      if (reveal) printInstructions(url, secret, false)
    } else {
      printInstructions(url, secret, false)
    }
    consola.info('start the receiver with: jib service start webhook')
  },
})

export default defineCommand({
  meta: { name: 'webhook', description: 'Manage webhook-triggered deploys' },
  subCommands: { setup },
})
