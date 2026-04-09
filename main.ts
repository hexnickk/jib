#!/usr/bin/env bun
import {
  type CliIssue,
  configureCliRuntime,
  isJsonOutput,
  normalizeCliError,
  stripCliRuntimeArgs,
} from '@jib/core'
import { type CommandDef, defineCommand, renderUsage, runCommand } from 'citty'
import { consola } from 'consola'
import pkg from './package.json' with { type: 'json' }
import { commonCliArgs } from './src/commands/_cli.ts'

function printJson(stream: NodeJS.WriteStream, value: unknown): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`)
}

interface CommandNode {
  subCommands?: Record<string, CommandNode>
}

async function resolveCommandInvocation(
  cmd: CommandNode,
  rawArgs: string[],
  parent?: CommandNode,
): Promise<{ leaf: CommandNode; parent: CommandNode | undefined; leafArgs: string[] }> {
  const subCommands = cmd.subCommands ?? {}
  const subCommandIndex = rawArgs.findIndex((arg) => !arg.startsWith('-'))
  const name = subCommandIndex >= 0 ? rawArgs[subCommandIndex] : undefined
  if (name === undefined || !subCommands[name]) return { leaf: cmd, parent, leafArgs: rawArgs }
  return resolveCommandInvocation(subCommands[name], rawArgs.slice(subCommandIndex + 1), cmd)
}

function renderTextError(error: ReturnType<typeof normalizeCliError>): void {
  consola.error(error.message)
  for (const issue of error.issues ?? ([] as CliIssue[])) {
    consola.error(`${issue.field}: ${issue.message}`)
  }
  if (error.hint) consola.error(error.hint)
}

const [
  {
    addCmd,
    deployCmd,
    downCmd,
    execCmd,
    initCmd,
    removeCmd,
    restartCmd,
    runCmd,
    secretsCmd,
    serviceCmd,
    statusCmd,
    upCmd,
  },
  { moduleSubCommands },
] = await Promise.all([import('./src/commands/index.ts'), import('./src/module-cli.ts')])

const main = defineCommand({
  meta: {
    name: 'jib',
    version: pkg.version,
    description: 'Lightweight deploy tool for docker-compose apps over SSH',
  },
  args: commonCliArgs,
  subCommands: {
    init: initCmd,
    add: addCmd,
    remove: removeCmd,
    deploy: deployCmd,
    up: upCmd,
    down: downCmd,
    restart: restartCmd,
    exec: execCmd,
    run: runCmd,
    secrets: secretsCmd,
    service: serviceCmd,
    status: statusCmd,
    ...moduleSubCommands(),
  },
})

try {
  const rawArgs = process.argv.slice(2)
  configureCliRuntime(rawArgs)
  const sanitizedArgs = stripCliRuntimeArgs(rawArgs)

  if (sanitizedArgs.includes('--help') || sanitizedArgs.includes('-h')) {
    const { leaf, parent } = await resolveCommandInvocation(main as CommandNode, sanitizedArgs)
    consola.log(`${await renderUsage(leaf as CommandDef, parent as CommandDef | undefined)}\n`)
  } else if (sanitizedArgs.length === 1 && sanitizedArgs[0] === '--version') {
    consola.log(pkg.version)
  } else {
    const { leaf, leafArgs } = await resolveCommandInvocation(main as CommandNode, sanitizedArgs)
    const { result } = await runCommand(leaf as CommandDef, { rawArgs: leafArgs })
    if (isJsonOutput()) {
      printJson(process.stdout, { ok: true, data: result ?? null })
    }
  }
} catch (error) {
  const normalized = normalizeCliError(error)
  if (isJsonOutput()) {
    printJson(process.stderr, { ok: false, error: normalized })
  } else {
    renderTextError(normalized)
  }
  process.exit(normalized.exitCode)
}
