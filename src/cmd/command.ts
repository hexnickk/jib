import type { ArgumentsCamelCase, Argv, BuilderCallback, Options } from 'yargs'

export interface CliGlobalArgv {
  interactive?: string
  output?: string
  debug?: boolean
}

type CliCommandBuilder<TArgs extends {}> =
  | BuilderCallback<CliGlobalArgv, CliGlobalArgv & TArgs>
  | Record<string, Options>

export interface CliCommand<TArgs extends {} = Record<string, unknown>> {
  command: string | readonly string[]
  describe: string
  builder?: CliCommandBuilder<TArgs>
  run: (args: ArgumentsCamelCase<CliGlobalArgv & TArgs>) => Promise<unknown> | unknown
}

/** Registers one command and forwards its return value to the top-level renderer. */
export function cliRegisterCommand<TArgs extends {}>(
  yargs: Argv<CliGlobalArgv>,
  command: CliCommand<TArgs>,
  onResult: (value: unknown) => void,
): Argv<CliGlobalArgv> {
  const handleCommand = async (argv: ArgumentsCamelCase<CliGlobalArgv & TArgs>) => {
    onResult(await command.run(argv))
  }
  if (!command.builder || typeof command.builder === 'function') {
    return yargs.command<CliGlobalArgv & TArgs>(
      command.command,
      command.describe,
      command.builder ?? ((builder) => builder),
      handleCommand,
    )
  }
  return yargs.command(command.command, command.describe, command.builder, async (argv) => {
    await handleCommand(argv as ArgumentsCamelCase<CliGlobalArgv & TArgs>)
  })
}

/** Registers multiple commands onto the same yargs instance. */
export function cliRegisterCommands(
  yargs: Argv<CliGlobalArgv>,
  commands: CliCommand[],
  onResult: (value: unknown) => void,
): Argv<CliGlobalArgv> {
  return commands.reduce(
    (builder, command) => cliRegisterCommand(builder, command, onResult),
    yargs,
  )
}
