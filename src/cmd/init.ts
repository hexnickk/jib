import {
  CliError,
  cliCanPrompt,
  cliCheckLinuxHost,
  cliCheckRootHost,
  cliCreateMissingInputError,
  cliIsTextOutput,
} from '@jib/cli'
import { loadConfig } from '@jib/config'
import { getPaths } from '@jib/paths'
import { intro, note, outro } from '@jib/tui'
import { hasBootstrapState } from '../migrations/service.ts'
import { configureOptionalModules } from '../modules/init/optional.ts'
import { reconcileOptionalModules } from '../modules/init/reconcile.ts'
import {
  describeModules,
  installedOptionalModules,
  pendingOptionalModuleNames,
  unseenOptionalModules,
} from '../modules/init/registry.ts'
import type { CliCommand } from './command.ts'

/** Returns a typed error until the machine has completed the bootstrap migration. */
function initCheckMigration(rootReady: boolean): CliError | undefined {
  if (rootReady) return undefined
  return new CliError('migrate_required', 'jib is not bootstrapped yet', {
    hint: 'run `sudo jib migrate` first',
  })
}

const cliInitCommand = {
  command: 'init',
  describe: 'Configure optional modules',
  builder: {
    check: {
      type: 'boolean',
      description: 'Print pending optional module setup without making changes',
    },
  },
  async run(args) {
    const linuxError = cliCheckLinuxHost('init')
    if (linuxError) return linuxError
    if (!args.check) {
      const rootError = cliCheckRootHost('init')
      if (rootError) return rootError
    }

    const paths = getPaths()
    const migrationError = initCheckMigration(hasBootstrapState(paths))
    if (migrationError) return migrationError
    if (cliIsTextOutput()) intro('jib init')

    if (args.check) {
      let config = await loadConfig(paths.configFile)
      config = await reconcileOptionalModules(config, paths, {
        writeConfig: async () => undefined,
      })
      const pending = pendingOptionalModuleNames(config)
      if (cliIsTextOutput()) {
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

    let config = await loadConfig(paths.configFile)
    config = await reconcileOptionalModules(config, paths)
    const unseen = unseenOptionalModules(config)

    if (unseen.length === 0) {
      if (cliIsTextOutput()) {
        note('No optional modules are waiting for setup.', 'Optional modules')
        outro('nothing to do')
      }
      return {
        enabledOptionalModules: installedOptionalModules(config).map((mod) => mod.manifest.name),
        optionalModulesPending: [],
      }
    }

    if (cliIsTextOutput()) {
      note(
        `Choose which optional pieces you want Jib to manage now.\n${describeModules(unseen).join('\n')}`,
        'Optional modules',
      )
    }

    if (!cliCanPrompt()) {
      return cliCreateMissingInputError(
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
    if (cliIsTextOutput()) {
      outro('modules configured')
      note('Next: run `jib status` to confirm services are healthy.', 'Next steps')
    }

    return {
      enabledOptionalModules: installedOptionalModules(finalConfig).map((mod) => mod.manifest.name),
      optionalModulesPending: unseenOptionalModules(finalConfig).map((mod) => mod.manifest.name),
    }
  },
} satisfies CliCommand

export default cliInitCommand
