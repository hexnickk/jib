import {
  CliError,
  cliCanPrompt,
  cliCheckLinuxHost,
  cliCheckRootHost,
  cliCreateMissingInputError,
  cliIsTextOutput,
} from '@jib/cli'
import { configLoad } from '@jib/config'
import { getPaths } from '@jib/paths'
import { tuiIntro, tuiNote, tuiOutro } from '@jib/tui'
import { hasBootstrapState } from '../migrations/service.ts'
import { initConfigureOptionalModules } from '../modules/init/optional.ts'
import { initReconcileOptionalModules } from '../modules/init/reconcile.ts'
import {
  initDescribeModules,
  initInstalledOptionalModules,
  initPendingOptionalModuleNames,
  initUnseenOptionalModules,
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
    if (cliIsTextOutput()) tuiIntro('jib init')

    if (args.check) {
      let config = await configLoad(paths.configFile)
      if (config instanceof Error) return config
      const reconciled = await initReconcileOptionalModules(config, paths, {
        writeConfig: async () => undefined,
      })
      if (reconciled instanceof Error) return reconciled
      config = reconciled
      const pending = initPendingOptionalModuleNames(config)
      if (cliIsTextOutput()) {
        if (pending.length === 0) {
          tuiNote('No optional modules are waiting for setup.', 'Optional modules')
          tuiOutro('nothing to do')
        } else {
          tuiNote(`Pending optional modules: ${pending.join(', ')}`, 'Optional modules')
          tuiOutro('run `sudo jib init` to configure them')
        }
      }
      return {
        enabledOptionalModules: initInstalledOptionalModules(config).map(
          (mod) => mod.manifest.name,
        ),
        optionalModulesPending: pending,
      }
    }

    let config = await configLoad(paths.configFile)
    if (config instanceof Error) return config
    const reconciled = await initReconcileOptionalModules(config, paths)
    if (reconciled instanceof Error) return reconciled
    config = reconciled
    const unseen = initUnseenOptionalModules(config)

    if (unseen.length === 0) {
      if (cliIsTextOutput()) {
        tuiNote('No optional modules are waiting for setup.', 'Optional modules')
        tuiOutro('nothing to do')
      }
      return {
        enabledOptionalModules: initInstalledOptionalModules(config).map(
          (mod) => mod.manifest.name,
        ),
        optionalModulesPending: [],
      }
    }

    if (cliIsTextOutput()) {
      tuiNote(
        `Choose which optional pieces you want Jib to manage now.\n${initDescribeModules(unseen).join('\n')}`,
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

    const configureError = await initConfigureOptionalModules(config, paths, unseen)
    if (configureError instanceof Error) return configureError
    const finalConfig = await configLoad(paths.configFile)
    if (finalConfig instanceof Error) return finalConfig
    if (cliIsTextOutput()) {
      tuiOutro('modules configured')
      tuiNote('Next: run `jib status` to confirm services are healthy.', 'Next steps')
    }

    return {
      enabledOptionalModules: initInstalledOptionalModules(finalConfig).map(
        (mod) => mod.manifest.name,
      ),
      optionalModulesPending: initUnseenOptionalModules(finalConfig).map(
        (mod) => mod.manifest.name,
      ),
    }
  },
} satisfies CliCommand

export default cliInitCommand
