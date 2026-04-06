import { addKeyProvider, deployKeyPaths, generateDeployKey } from '@jib-module/github'
import { type Config, loadConfig } from '@jib/config'
import type { ModuleContext } from '@jib/core'
import { promptSelect, promptString } from '@jib/tui'
import { consola } from 'consola'

/**
 * Prompt the user to set up a git auth provider (SSH deploy key or GitHub
 * App). On key setup, generates a deploy key and writes the provider entry;
 * on app setup, prints follow-up instructions.
 */
export async function promptGitAuth(ctx: ModuleContext<Config>): Promise<void> {
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
      const name = await promptString({ message: 'Provider name (e.g. my-org-key)' })
      const cfg = await loadConfig(ctx.paths.configFile)
      if (cfg.github?.providers?.[name]) {
        consola.warn(`provider "${name}" already exists — skipping`)
        return
      }
      const pubKey = await generateDeployKey(name, ctx.paths)
      await addKeyProvider(ctx.paths.configFile, name)
      const keyPaths = deployKeyPaths(ctx.paths, name)
      consola.success(`deploy key "${name}" added to config`)
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
