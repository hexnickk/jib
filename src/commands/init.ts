import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import * as cloudflareMod from '@jib-module/cloudflare'
import * as cloudflaredMod from '@jib-module/cloudflared'
import * as deployerMod from '@jib-module/deployer'
import * as gitsitterMod from '@jib-module/gitsitter'
import * as natsMod from '@jib-module/nats'
import * as nginxMod from '@jib-module/nginx'
import { type Config, loadConfig } from '@jib/config'
import { type ModuleContext, createLogger, getPaths } from '@jib/core'
import { isInteractive, promptConfirm } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'

/**
 * `jib init` — bootstrap a server. Creates the jib filesystem layout, a
 * minimal v3 config, and installs required modules (nats, deployer,
 * gitsitter) plus optional ones (nginx, cloudflared, cloudflare operator)
 * on interactive confirmation. Install order: nats → deployer → gitsitter
 * → nginx → cloudflared → cloudflare operator.
 */

const MINIMAL_CONFIG = `config_version: 3
poll_interval: 5m
apps: {}
`

async function ensureDirs(): Promise<void> {
  const p = getPaths()
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
  for (const d of dirs) {
    await mkdir(d, { recursive: true, mode: 0o755 })
  }
  consola.info(`directories ready under ${p.root}`)
}

async function ensureConfig(): Promise<Config> {
  const p = getPaths()
  if (!existsSync(p.configFile)) {
    await writeFile(p.configFile, MINIMAL_CONFIG, { mode: 0o600 })
    consola.success(`wrote ${p.configFile}`)
  } else {
    consola.info(`${p.configFile} exists, skipping`)
  }
  return loadConfig(p.configFile)
}

interface ModLike {
  manifest: { name: string }
  install?: (ctx: ModuleContext<Config>) => Promise<void>
}

async function installMod(mod: ModLike, ctx: ModuleContext<Config>): Promise<void> {
  if (!mod.install) {
    consola.warn(`${mod.manifest.name}: no install() — skipping`)
    return
  }
  consola.info(`installing ${mod.manifest.name}`)
  await mod.install(ctx)
  consola.success(`${mod.manifest.name} installed`)
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

    await ensureDirs()
    const config = await ensureConfig()

    if (skipInstall) {
      consola.info('--skip-install: done (no modules installed)')
      return
    }

    const ctx: ModuleContext<Config> = {
      config,
      logger: createLogger('init'),
      paths: getPaths(),
    }

    // Required modules — order matters: nats must be up before the
    // services that depend on it.
    await installMod(natsMod, ctx)
    await installMod(deployerMod, ctx)
    await installMod(gitsitterMod, ctx)

    // Optional modules: nginx (strongly recommended — sole routing layer
    // for apps with domains), cloudflared (tunnel daemon), and the
    // cloudflare operator (DNS + ingress via the Cloudflare API).
    const wantNginx = nonInteractive
      ? true
      : await promptConfirm({ message: 'Install nginx reverse-proxy module?', initialValue: true })
    if (wantNginx) await installMod(nginxMod, ctx)

    const wantCFD = nonInteractive
      ? false
      : await promptConfirm({ message: 'Install cloudflared tunnel daemon?', initialValue: false })
    if (wantCFD && !wantNginx) {
      // cloudflared tunnels to localhost:80 — that port is nginx's job. Without
      // nginx the tunnel will land on nothing. Warn loudly but don't block;
      // operators running a custom proxy on :80 may know what they're doing.
      consola.warn(
        'cloudflared without nginx: the tunnel will hit localhost:80 with no default handler',
      )
    }
    if (wantCFD) await installMod(cloudflaredMod, ctx)

    const wantCFOp = nonInteractive
      ? false
      : await promptConfirm({
          message: 'Install cloudflare operator (DNS/ingress API)?',
          initialValue: false,
        })
    if (wantCFOp) await installMod(cloudflareMod, ctx)

    consola.box(
      'jib initialized. Next:\n  jib add <app> --repo org/repo --domain example.com\n  jib deploy <app>',
    )
  },
})
