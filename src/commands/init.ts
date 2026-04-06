import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import * as cloudflaredMod from '@jib-module/cloudflared'
import * as deployerMod from '@jib-module/deployer'
import * as gitsitterMod from '@jib-module/gitsitter'
import * as natsMod from '@jib-module/nats'
import * as nginxMod from '@jib-module/nginx'
import { type Config, loadConfig } from '@jib/config'
import { type ModuleContext, type Paths, createLogger, getPaths } from '@jib/core'
import { isInteractive, promptConfirm, promptSelect } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { promptGitAuth } from './_init_git.ts'
import { addUserToGroup, ensureGroup } from './_init_group.ts'
import { type ModLike, runInstallsTx } from './_init_install.ts'
import { promptTunnelToken } from './_init_tunnel.ts'
import { hasTunnelToken } from './_status_collect.ts'

/**
 * `jib init` — bootstrap a server. Creates the jib filesystem layout, a
 * minimal v3 config, and installs required modules. Always installs: nats,
 * deployer, gitsitter, nginx. If the user picks Cloudflare Tunnel ingress,
 * also installs cloudflared and prompts for a tunnel token.
 */

const MINIMAL_CONFIG = `config_version: 3
poll_interval: 5m
apps: {}
`

async function ensureDirs(p: Paths): Promise<void> {
  const dirs = [
    p.root,
    p.stateDir,
    p.locksDir,
    p.secretsDir,
    p.overridesDir,
    p.reposDir,
    p.repoRoot,
    p.nginxDir,
    p.busDir,
    p.cloudflaredDir,
  ]
  const log = createLogger('init')
  for (const d of dirs) {
    await mkdir(d, { recursive: true, mode: 0o750 })
  }
  log.info(`directories ready under ${p.root}`)
}

async function ensureConfig(p: Paths): Promise<Config> {
  const log = createLogger('init')
  if (!existsSync(p.configFile)) {
    await writeFile(p.configFile, MINIMAL_CONFIG, { mode: 0o640 })
    consola.success(`wrote ${p.configFile}`)
  } else {
    log.info(`${p.configFile} exists, skipping`)
  }
  return loadConfig(p.configFile)
}

export default defineCommand({
  meta: { name: 'init', description: 'Bootstrap server: dirs, config, required modules' },
  args: {
    'non-interactive': { type: 'boolean', description: 'Skip prompts, install defaults only' },
    'skip-install': { type: 'boolean', description: 'Create dirs/config, skip module installs' },
  },
  async run({ args }) {
    if (process.getuid && process.getuid() !== 0) {
      consola.error('jib init must run as root (try: sudo jib init)')
      process.exit(1)
    }
    const nonInteractive = Boolean(args['non-interactive']) || !isInteractive()
    const skipInstall = Boolean(args['skip-install'])

    const paths = getPaths()
    await ensureDirs(paths)
    const config = await ensureConfig(paths)
    await ensureGroup(paths)

    const sudoUser = process.env.SUDO_USER
    if (sudoUser && !nonInteractive) {
      const add = await promptConfirm({
        message: `Add ${sudoUser} to jib group? (allows running jib without sudo)`,
        initialValue: true,
      })
      if (add) await addUserToGroup(sudoUser)
    }

    if (skipInstall) {
      consola.info('--skip-install: done (no modules installed)')
      return
    }

    const ctx: ModuleContext<Config> = {
      config,
      logger: createLogger('init'),
      paths,
    }

    const mods: ModLike[] = [natsMod, deployerMod, gitsitterMod, nginxMod]

    const hasTunnel = hasTunnelToken(ctx.paths)

    const ingress = nonInteractive
      ? 'direct'
      : await promptSelect<'direct' | 'tunnel'>({
          message: 'How does traffic reach this server?',
          options: [
            { value: 'direct', label: 'Direct — server has a public IP' },
            {
              value: 'tunnel',
              label: `Cloudflare Tunnel — server is behind NAT or uses CF${hasTunnel ? ' [configured]' : ''}`,
            },
          ],
        })

    if (ingress === 'tunnel') {
      mods.push(cloudflaredMod)
    }

    try {
      await runInstallsTx(mods, ctx)
    } catch (err) {
      consola.error(`jib init failed: ${err instanceof Error ? err.message : String(err)}`)
      consola.info('safe to retry: sudo jib init')
      process.exit(1)
    }

    if (ingress === 'tunnel' && !nonInteractive) {
      await promptTunnelToken(ctx)
    }

    if (!nonInteractive) {
      const freshCfg = await loadConfig(ctx.paths.configFile)
      const existingProviders = Object.keys(freshCfg.github?.providers ?? {})

      if (existingProviders.length > 0) {
        consola.success(`existing git providers: ${existingProviders.join(', ')}`)
        const addMore = await promptConfirm({
          message: 'Add another git auth provider?',
          initialValue: false,
        })
        if (addMore) {
          await promptGitAuth(ctx)
        }
      } else {
        await promptGitAuth(ctx)
      }
    }

    consola.box(
      [
        'jib initialized. Next:',
        '  jib add <app> --repo org/repo --domain host=example.com',
        '  jib deploy <app>',
      ].join('\n'),
    )
  },
})
