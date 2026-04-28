# Remove JSON Output and Simplify CLI Setup

## Why

The current CLI setup is more custom than it needs to be because `--output=json` requires behavior that yargs does not provide by default:

- pre-parsing global runtime flags so `--output=json --help` can be detected before yargs renders help
- intercepting yargs help/version output and wrapping it in `{ ok, data }`
- a central success renderer for command return values
- an `onResult` callback adapter in `src/cmd/command.ts`
- command code gating normal human output behind `cliIsTextOutput()`

If JSON output is not a product requirement, removing it lets yargs own the CLI lifecycle again.

## Goals

- Remove `--output` and `JIB_OUTPUT` completely.
- Make help/version/default-command behavior yargs-native.
- Keep typed-error handling, but simplify it to text-only output.
- Remove `src/cmd/command.ts`; inline any minimal registration glue in `src/main.ts` or move commands to yargs `CommandModule`s where practical.
- Keep command behavior otherwise unchanged.
- Keep each intermediate step testable and green.

## Non-Goals

- Redesigning command names or arguments.
- Changing interactive prompt behavior beyond removing JSON-related gating.
- Reworking deploy/add business flows.
- Preserving JSON compatibility.

## Target CLI Shape

`src/main.ts` should read like a normal yargs entrypoint:

```ts
const runtime = cliReadRuntime()
if (runtime instanceof Error) exitCliError(runtime)

const parser = yargs(hideBin(process.argv))
  .scriptName('jib')
  .usage('$0 <command>')
  .showHelpOnFail(true)
  .parserConfiguration({ 'populate--': true })
  .strict()
  .recommendCommands()
  .options(createCliRuntimeOptions(runtime))
  .middleware((argv) => {
    // Do not validate argv here: yargs middleware runs before choices
    // validation, so doing so would preempt yargs help-on-fail output.
    const nextRuntime = cliSetRuntime({
      interactive: readParsedInteractiveMode(argv.interactive) ?? runtime.interactive,
      debug: typeof argv.debug === 'boolean' ? argv.debug : runtime.debug,
      stdinTty: runtime.stdinTty,
      stdoutTty: runtime.stdoutTty,
    })
    if (nextRuntime instanceof Error) exitCliError(nextRuntime)
  }, true)
  .help()
  .version(pkg.version)

parser.command('$0', false, (builder) => builder, () => {
  parser.showHelp('log')
})

let commandResult: unknown
for (const command of cliCommands) registerCliCommand(parser, command, (result) => {
  commandResult = result
})

await parser.parseAsync()
if (commandResult instanceof Error) exitCliError(commandResult)
```

Important differences from today:

- no `readCliRuntimeArgv()` pre-parse
- no `cliOutput`, `cliHelpRequested`, or `cliVersionRequested`
- no `writeCliSuccess()` / JSON envelope
- no yargs parse callback for normal output
- no custom `.fail(...)`; invalid yargs usage is rendered by yargs itself
- yargs `choices` owns invalid `--interactive` rendering, so middleware must not preempt it
- empty `jib` handled by yargs default command `$0`
- returned command `Error`s still handled centrally, without a success renderer

Note: keep `.strict()` rather than replacing it with only `.strictCommands().strictOptions()`. With a `$0` default command, yargs can otherwise treat unknown commands as default-command invocations. `.strict()` preserves the current desired behavior where `jib wat` exits non-zero.

## Command Registration Direction

Use a small transition step first:

- keep command files exporting simple command objects for now
- move `registerCliCommand()` into `src/main.ts`
- keep any shared command shape as type-only code outside `src/main.ts`, or convert commands to yargs `CommandModule`s
- delete `src/cmd/command.ts` as a behavior/adapter module
- command handlers keep returning `Error | data | undefined`
- the local `registerCliCommand()` records returned values; `src/main.ts` exits only when a returned value is an `Error`; successful returned data is ignored in text-only mode

This removes the extra abstraction file without forcing a large command-module rewrite.

Do not import types from `src/main.ts` into command files; `main.ts` is an entrypoint with side effects. If command files still need contextual typing for `run(args)` and `builder`, use a tiny side-effect-free type file such as `src/cmd/types.ts`, or convert the command file to yargs `CommandModule` directly.

After that is stable, optionally convert command files to yargs `CommandModule`s one by one if the local adapter still feels unnecessary.

## Related `modules/cli` Simplification

Remove alongside JSON mode:

- `cliOutputModes`
- `OutputMode`
- `cliReadOutputMode()`
- `InvalidOutputModeError`
- `CliRuntime.output`
- `CliRuntimeArgv` and `cliApplyRuntimeArgv()`
- `JIB_OUTPUT` env handling
- `cliIsJsonOutput()`
- machine-readable `details` fields from CLI error normalization

Keep for now:

- `cliIsTextOutput()`, but temporarily make it return `true`
  - this keeps the first refactor smaller because it is used in commands and flows
  - remove call sites in a follow-up cleanup
- `cliCanPrompt()` and `cliDescribePromptBlock()`
  - these still define interactive prompt policy
- `cliIsDebugEnabled()` and debug env syncing
  - unrelated to output mode
- `cliNormalizeError()`
  - still useful for consistent text errors and exit codes

Possible follow-up cleanup after the CLI is text-only:

- remove `cliIsTextOutput()` entirely and make command text output explicit
- replace spinner/progress gating with a narrower helper such as `tuiCanShowProgress()` or `process.stdout.isTTY`

## Implementation Steps

1. Remove JSON runtime mode:
   - delete `OutputMode`, `cliOutputModes`, `cliReadOutputMode()`, `cliIsJsonOutput()`
   - remove `output` from `CliRuntime`
   - remove `JIB_OUTPUT` handling
   - remove `InvalidOutputModeError` if unused
   - update runtime tests

2. Keep text runtime minimal:
   - keep `interactive`, `debug`, `stdinTty`, `stdoutTty`
   - remove `cliApplyRuntimeArgv()` once yargs owns argv validation
   - keep `cliIsTextOutput()` temporarily and make it always return `true`
   - remove `cliIsTextOutput()` call sites in a follow-up cleanup once tests are green

3. Simplify `src/main.ts`:
   - remove JSON/text success renderers
   - keep only text error rendering for returned command errors and startup/runtime errors
   - make `--interactive` yargs-native with `choices: ['auto', 'always', 'never']`
   - remove `readCliRuntimeArgv()`
   - remove yargs parse callback output interception
   - remove custom `.fail(...)` and let yargs render invalid usage with help
   - remove `.exitProcess(false)` unless a specific test seam needs it
   - keep `.strict()` so unknown commands do not fall through to `$0`
   - register `$0` default command that calls `parser.showHelp('log')`
   - parse with `await parser.parseAsync()`

4. Inline command adapter:
   - move the registration wrapper from `src/cmd/command.ts` into `src/main.ts`
   - do not import from `src/main.ts` in command files
   - if keeping simple command objects, move only the shared type to a side-effect-free file such as `src/cmd/types.ts`
   - delete `src/cmd/command.ts` when no imports remain

5. Audit commands that only returned JSON-friendly data:
   - `sources setup` currently returns `{ ok, source }` and may need an explicit text success/no-op message
   - any command that relied on returned data for visible output should print text itself
   - leave data returns only where useful for tests/internal composition; the CLI entrypoint should ignore successful data

6. Clean up JSON-gated command output:
   - replace `if (cliIsTextOutput()) ...` with direct text output where appropriate
   - for progress/spinners, consider gating on TTY rather than output format if needed
   - keep interactive gating based on `cliCanPrompt()`, not output mode

7. Update tests:
   - remove `--output=json` contract tests
   - keep root `jib` help test: exit `0`, stdout contains help, stderr empty
   - keep `--help` and `--version` text tests
   - update invalid runtime flag test from `--output=xml` to an existing runtime flag such as `--interactive=bad`
   - update status/add tests to assert text stderr/stdout instead of JSON envelopes

8. Validate:
   - `bun test`
   - `bun run typecheck`
   - `bun run lint`
   - manual checks:
     - `bun run src/main.ts`
     - `bun run src/main.ts --help`
     - `bun run src/main.ts --version`
     - `bun run src/main.ts --foo`
     - `bun run src/main.ts status`

## Risks

- Some commands may currently rely on JSON-mode returns for test assertions; tests need to move to text behavior.
- Removing `cliIsTextOutput()` all at once may create a large diff because it is used across commands and flows.
- Spinners/progress output may become too noisy in non-TTY contexts if every old `cliIsTextOutput()` gate becomes unconditional.
- Fully converting every command to yargs `CommandModule` in the same change may make the refactor harder to review.

## Recommended Slice Order

1. Remove JSON runtime and tests.
2. Simplify `main.ts` to yargs-owned help/version/default command and help-on-fail behavior.
3. Inline/delete `src/cmd/command.ts`.
4. Fix command text output gaps.
5. Optionally convert command files to yargs `CommandModule`s after the simpler entrypoint is stable.

## Done Looks Like

- `jib`, `jib --help`, and `jib --version` are handled directly by yargs and exit `0`.
- Unknown commands/options are rendered by yargs with help and exit non-zero.
- Returned command errors are rendered by `exitCliError()` as concise text.
- There is no `--output` option and no `JIB_OUTPUT` behavior.
- `src/main.ts` has no JSON renderer or help/version interception.
- `src/cmd/command.ts` is gone.
- Commands print human text directly and only use returned `Error`s for expected failure handling.
