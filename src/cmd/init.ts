import {
  CliError,
  applyCliArgs,
  canPrompt,
  ensureLinux,
  ensureRoot,
  isTextOutput,
  missingInput,
  withCliArgs,
} from '@jib/cli'
import { loadConfig } from '@jib/config'
import { getPaths } from '@jib/paths'
import { intro, note, outro } from '@jib/tui'
import { defineCommand } from 'citty'
import { hasBootstrapState } from '../migrations/service.ts'
import { configureOptionalModules } from '../modules/init/optional.ts'
import { reconcileOptionalModules } from '../modules/init/reconcile.ts'
import {
  describeModules,
  installedOptionalModules,
  pendingOptionalModuleNames,
  unseenOptionalModules,
} from '../modules/init/registry.ts'

function ensureMigrated(rootReady: boolean): void {
  if (rootReady) return
  throw new CliError('migrate_required', 'jib is not bootstrapped yet', {
    hint: 'run `sudo jib migrate` first',
  })
}

export default defineCommand({
  meta: { name: 'init', description: 'Configure optional modules' },
  args: withCliArgs({
    check: {
      type: 'boolean',
      description: 'Print pending optional module setup without making changes',
    },
  }),
  async run({ args }) {
    applyCliArgs(args)
    ensureLinux('init')
    if (!args.check) ensureRoot('init')

    const paths = getPaths()
    ensureMigrated(hasBootstrapState(paths))
    if (isTextOutput()) intro('jib init')

    let config = await loadConfig(paths.configFile)
    config = await reconcileOptionalModules(config, paths)
    const pending = pendingOptionalModuleNames(config)

    if (args.check) {
      if (isTextOutput()) {
        if (pending.length === 0) {
          note('No optional modules are waiting for setup.', 'Optional modules')
          outro('nothing to do')
        } else {
          note(`Pending optional modules: ${pending.join(', ')}`, 'Optional modules')
          outro('run `sudo jib init` to configure them')
        }
      }
      return {
        enabledOptionalModules: installedOptionalModules(config).map((mod) => mod.manifest.name),
        optionalModulesPending: pending,
      }
    }

    const unseen = unseenOptionalModules(config)

    if (unseen.length === 0) {
      if (isTextOutput()) {
        note('No optional modules are waiting for setup.', 'Optional modules')
        outro('nothing to do')
      }
      return {
        enabledOptionalModules: installedOptionalModules(config).map((mod) => mod.manifest.name),
        optionalModulesPending: [],
      }
    }

    if (isTextOutput()) {
      note(
        `Choose which optional pieces you want Jib to manage now.\n${describeModules(unseen).join('\n')}`,
        'Optional modules',
      )
    }

    if (!canPrompt()) {
      missingInput(
        'missing optional module choices for jib init',
        unseen.map((mod) => ({
          field: `modules.${mod.manifest.name}`,
          message:
            'set this module to true or false in config, or rerun with interactive prompts enabled',
        })),
      )
    }

    await configureOptionalModules(config, paths, unseen)
    const finalConfig = await loadConfig(paths.configFile)
    if (isTextOutput()) {
      outro('modules configured')
      note('Next: run `jib status` to confirm services are healthy.', 'Next steps')
    }

    return {
      enabledOptionalModules: installedOptionalModules(finalConfig).map((mod) => mod.manifest.name),
      optionalModulesPending: unseenOptionalModules(finalConfig).map((mod) => mod.manifest.name),
    }
  },
})
