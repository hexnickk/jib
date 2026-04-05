#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'
import { consola } from 'consola'

const run = defineCommand({
  meta: {
    name: 'run',
    description: 'Run a jib module as a long-running service',
  },
  args: {
    module: {
      type: 'positional',
      description: 'Module name (e.g. deployer, gitsitter)',
      required: true,
    },
  },
  run({ args }) {
    consola.info(`TODO: resolve and start module ${args.module}`)
    process.exit(1)
  },
})

const main = defineCommand({
  meta: {
    name: 'jib',
    version: '0.0.0',
    description: 'Lightweight deploy tool for docker-compose apps over SSH',
  },
  subCommands: {
    run,
  },
})

await runMain(main)
