import {
  CliError,
  cliCanPrompt,
  cliCheckLinuxHost,
  cliCheckRootHost,
  cliCreateMissingInputError,
} from '@jib/cli'
import { configLoad } from '@jib/config'
import { pathsGetPaths } from '@jib/paths'
import { tuiIntro, tuiNote, tuiOutro } from '@jib/tui'
import type { ArgumentsCamelCase, CommandModule } from 'yargs'
import { initConfigureOptionalModules } from '@/flows/init/optional.ts'
import { initReconcileOptionalModules } from '@/flows/init/reconcile.ts'
import {
  initDescribeModules,
  initInstalledOptionalModules,
  initPendingOptionalModuleNames,
  initUnseenOptionalModules,
} from '@/flows/init/registry.ts'
import { hasBootstrapState } from '../migrations/service.ts'
import { cmdCreateHandler } from './handler.ts'

const cliInitCommand = {
  command: 'init',
  describe: 'Configure optional modules',
  builder: {
    check: {
      type: 'boolean',
      description: 'Print pending optional module setup without making changes',
    },
  },
  handler: cmdCreateHandler(initRunCommand),
} satisfies CommandModule<Record<string, unknown>, { check?: boolean }>

/** Runs optional module setup and returns a setup summary or typed error. */
async function initRunCommand(args: ArgumentsCamelCase<{ check?: boolean }>) {
  const linuxError = cliCheckLinuxHost('init')
  if (linuxError) {
    return linuxError
  }
  if (!args.check) {
    const rootError = cliCheckRootHost('init')
    if (rootError) {
      return rootError
    }
  }

  const paths = pathsGetPaths()
  if (!hasBootstrapState(paths)) {
    return new CliError('migrate_required', 'jib is not bootstrapped yet', {
      hint: 'run `sudo jib migrate` first',
    })
  }
  tuiIntro('jib init')

  const loaded = await configLoad(paths.configFile)
  if (loaded instanceof Error) {
    return loaded
  }
  const config = await initReconcileOptionalModules(
    loaded,
    paths,
    args.check ? { writeConfig: async () => undefined } : {},
  )
  if (config instanceof Error) {
    return config
  }

  const unseen = initUnseenOptionalModules(config)
  if (args.check || unseen.length === 0) {
    const pending = initPendingOptionalModuleNames(config)
    if (pending.length === 0) {
      tuiNote('No optional modules are waiting for setup.', 'Optional modules')
      tuiOutro('nothing to do')
    } else {
      tuiNote(`Pending optional modules: ${pending.join(', ')}`, 'Optional modules')
      tuiOutro('run `sudo jib init` to configure them')
    }
    return {
      enabledOptionalModules: initInstalledOptionalModules(config).map((mod) => mod.manifest.name),
      optionalModulesPending: pending,
    }
  }

  tuiNote(
    `Choose which optional pieces you want Jib to manage now.\n${initDescribeModules(unseen).join('\n')}`,
    'Optional modules',
  )

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
  if (configureError instanceof Error) {
    return configureError
  }
  const finalConfig = await configLoad(paths.configFile)
  if (finalConfig instanceof Error) {
    return finalConfig
  }
  tuiOutro('modules configured')
  tuiNote('Next: run `jib status` to confirm services are healthy.', 'Next steps')

  return {
    enabledOptionalModules: initInstalledOptionalModules(finalConfig).map(
      (mod) => mod.manifest.name,
    ),
    optionalModulesPending: initUnseenOptionalModules(finalConfig).map((mod) => mod.manifest.name),
  }
}

export default cliInitCommand
