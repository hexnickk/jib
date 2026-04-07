import * as cloudflaredMod from '@jib-module/cloudflared'
import * as deployerMod from '@jib-module/deployer'
import * as githubMod from '@jib-module/github'
import * as gitsitterMod from '@jib-module/gitsitter'
import * as natsMod from '@jib-module/nats'
import * as nginxMod from '@jib-module/nginx'
import { type Config, loadConfig } from '@jib/config'
import { type ModuleContext, type Paths, createLogger } from '@jib/core'
import { log, note, outro, promptConfirm, promptSelect } from '@jib/tui'
import { hasTunnelToken } from '../status-collect.ts'
import { type ModLike, runInstallsTx } from './install.ts'

/**
 * First-run interactive wizard. Prompts for ingress mode, installs core
 * modules, optionally configures cloudflared + git auth.
 */
export async function runWizard(paths: Paths, config: Config): Promise<void> {
  const ctx: ModuleContext<Config> = {
    config,
    logger: createLogger('init'),
    paths,
  }

  const mods: ModLike[] = [natsMod, deployerMod, gitsitterMod, nginxMod]
  const hasTunnel = hasTunnelToken(ctx.paths)

  const ingress = await promptSelect<'direct' | 'tunnel'>({
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
    log.error(`jib init failed: ${err instanceof Error ? err.message : String(err)}`)
    log.info('safe to retry: sudo jib init')
    process.exit(1)
  }

  if (ingress === 'tunnel') {
    await cloudflaredMod.setup(ctx)
  }

  const freshCfg = await loadConfig(ctx.paths.configFile)
  const existingProviders = Object.keys(freshCfg.github?.providers ?? {})

  if (existingProviders.length > 0) {
    log.success(`existing git providers: ${existingProviders.join(', ')}`)
    const addMore = await promptConfirm({
      message: 'Add another git auth provider?',
      initialValue: false,
    })
    if (addMore) {
      await githubMod.setup(ctx)
    }
  } else {
    await githubMod.setup(ctx)
  }

  outro('jib initialized')
  note(
    ['jib add <app> --repo org/repo --domain host=example.com', 'jib deploy <app>'].join('\n'),
    'Next steps',
  )
}
