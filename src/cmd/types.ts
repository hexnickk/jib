import type { ArgumentsCamelCase, BuilderCallback, Options } from 'yargs'

/** Shared yargs argv fields supplied by global CLI options. */
export interface CliGlobalArgv {
  interactive?: string
  debug?: boolean
}

type CliCommandBuilder<TArgs extends {}> =
  | BuilderCallback<CliGlobalArgv, CliGlobalArgv & TArgs>
  | Record<string, Options>

/** Minimal command object shape used before converting commands to yargs modules. */
export interface CliCommand<TArgs extends {} = Record<string, unknown>> {
  command: string | readonly string[]
  describe: string
  builder?: CliCommandBuilder<TArgs>
  run: (args: ArgumentsCamelCase<CliGlobalArgv & TArgs>) => Promise<unknown> | unknown
}
