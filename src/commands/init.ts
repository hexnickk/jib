import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { extractTunnelToken } from '@jib-module/cloudflared'
import * as cloudflaredMod from '@jib-module/cloudflared'
import * as deployerMod from '@jib-module/deployer'
import * as gitsitterMod from '@jib-module/gitsitter'
import * as natsMod from '@jib-module/nats'
import * as nginxMod from '@jib-module/nginx'
import { type Config, loadConfig } from '@jib/config'
import { type ModuleContext, createLogger, getPaths } from '@jib/core'
import { isInteractive, promptPassword, promptSelect } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'

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
  const log = createLogger('init')
  for (const d of dirs) {
    await mkdir(d, { recursive: true, mode: 0o755 })
  }
  log.info(`directories ready under ${p.root}`)
}

async function ensureConfig(): Promise<Config> {
  const log = createLogger('init')
  const p = getPaths()
  if (!existsSync(p.configFile)) {
    await writeFile(p.configFile, MINIMAL_CONFIG, { mode: 0o600 })
    consola.success(`wrote ${p.configFile}`)
  } else {
    log.info(`${p.configFile} exists, skipping`)
  }
  return loadConfig(p.configFile)
}

export interface ModLike {
  manifest: { name: string }
  install?: (ctx: ModuleContext<Config>) => Promise<void>
  uninstall?: (ctx: ModuleContext<Config>) => Promise<void>
}

/**
 * Install every module in `mods` in order. On the first failure, walk the
 * already-installed set in reverse and call each module's `uninstall()` as
 * best-effort rollback, so the host is either fully initialized or fully
 * unchanged. Each rollback step is independently try/catch'd — a failing
 * uninstall doesn't abort the rest; we just log and continue. Re-throws
 * the original install error once rollback finishes so callers can surface
 * it and exit.
 */
export async function runInstallsTx(mods: ModLike[], ctx: ModuleContext<Config>): Promise<void> {
  const installed: ModLike[] = []
  try {
    for (const m of mods) {
      if (!m.install) {
        consola.warn(`${m.manifest.name}: no install() — skipping`)
        continue
      }
      await m.install(ctx)
      consola.success(`${m.manifest.name}`)
      installed.push(m)
    }
  } catch (err) {
    if (installed.length > 0) {
      consola.warn(`install failed; rolling back ${installed.length} module(s)…`)
      for (const m of [...installed].reverse()) {
        if (!m.uninstall) {
          consola.warn(`${m.manifest.name}: no uninstall() — leaving in place`)
          continue
        }
        try {
          await m.uninstall(ctx)
          consola.info(`rolled back ${m.manifest.name}`)
        } catch (e) {
          const em = e instanceof Error ? e.message : String(e)
          consola.warn(`${m.manifest.name} uninstall failed: ${em}`)
        }
      }
    }
    throw err
  }
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

    // Collect the full module list BEFORE any install runs. This lets us
    // prompt once (interactive mode) and install as a single transaction —
    // on any failure mid-install we roll back the installed set cleanly.
    // Order matters: nats must be up before the services that depend on it.
    const mods: ModLike[] = [natsMod, deployerMod, gitsitterMod, nginxMod]

    // Ingress mode determines whether traffic reaches this server directly
    // (public IP, DNS pointed at it) or via a Cloudflare Tunnel. The tunnel
    // path installs cloudflared + prompts for a tunnel token; no API calls.
    const ingress = nonInteractive
      ? 'direct'
      : await promptSelect<'direct' | 'tunnel'>({
          message: 'How does traffic reach this server?',
          options: [
            { value: 'direct', label: 'Direct — server has a public IP' },
            { value: 'tunnel', label: 'Cloudflare Tunnel — server is behind NAT or uses CF' },
          ],
        })

    if (ingress === 'tunnel') {
      mods.push(cloudflaredMod)
    }

    try {
      await runInstallsTx(mods, ctx)
    } catch (err) {
      consola.error(`jib init failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }

    // If the user picked Cloudflare Tunnel, prompt for the tunnel token
    // right away. They create the tunnel in the CF dashboard and paste the
    // token here; cloudflared will connect with it on next start.
    if (ingress === 'tunnel' && !nonInteractive) {
      consola.info('Create a tunnel at dash.cloudflare.com → Zero Trust → Tunnels,')
      consola.info('then paste the install command or just the token.')
      try {
        const raw = await promptPassword({
          message: 'Tunnel token (or full "cloudflared service install <token>" command)',
        })
        const token = extractTunnelToken(raw)
        if (token) {
          const { dirname } = await import('node:path')
          const { credsPath } = await import('@jib/core')
          const tokenPath = credsPath(ctx.paths, 'cloudflare', 'tunnel.env')
          await mkdir(dirname(tokenPath), { recursive: true, mode: 0o700 })
          await writeFile(tokenPath, `TUNNEL_TOKEN=${token.trim()}\n`, { mode: 0o600 })
          consola.success('tunnel token stored')
          // Now enable + start cloudflared (install.ts deliberately skipped
          // this because cloudflared can't run without a token).
          const { $ } = await import('bun')
          await $`systemctl enable --now jib-cloudflared`.quiet().nothrow()
          consola.success('cloudflared started')
        }
      } catch (err) {
        consola.warn(
          `tunnel token setup skipped: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // Git auth provider — needed for private repos. SSH key is inline (just
    // keygen); GitHub App requires a browser (manifest flow) so we punt to
    // the dedicated command.
    if (!nonInteractive) {
      const gitAuth = await promptSelect<'key' | 'app' | 'skip'>({
        message: 'Set up a git auth provider? (needed for private repos)',
        options: [
          { value: 'key', label: 'SSH deploy key (simplest, per-repo)' },
          { value: 'app', label: 'GitHub App (recommended for orgs)' },
          { value: 'skip', label: 'Skip — public repos only or set up later' },
        ],
      })
      if (gitAuth === 'key') {
        try {
          const { promptString } = await import('@jib/tui')
          const name = await promptString({ message: 'Provider name (e.g. my-org-key)' })
          const { generateDeployKey, deployKeyPaths } = await import('@jib-module/github')
          const { addKeyProvider } = await import('@jib-module/github')
          const pubKey = await generateDeployKey(name, ctx.paths)
          await addKeyProvider(ctx.paths.configFile, name)
          const keyPaths = deployKeyPaths(ctx.paths, name)
          consola.success(`SSH deploy key "${name}" generated`)
          consola.box(
            [
              'Add this public key to your GitHub repo → Settings → Deploy Keys:',
              '',
              pubKey,
              '',
              `Private key: ${keyPaths.privateKey}`,
            ].join('\n'),
          )
        } catch (err) {
          consola.warn(`key setup failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      } else if (gitAuth === 'app') {
        consola.box(
          [
            'GitHub App setup requires a browser. Run:',
            '',
            '  jib github app setup <name>',
            '',
            'This opens a browser to register the app with GitHub.',
          ].join('\n'),
        )
      }
    }

    consola.box(
      [
        'jib initialized. Next:',
        '  jib add <app> --repo org/repo --domain example.com',
        '  jib deploy <app>',
      ].join('\n'),
    )
  },
})
