#!/usr/bin/env bun
import pkg from '../../package.json' with { type: 'json' }
import { runCommandApp } from '../../src/command-app.ts'
import { commonCliArgs } from '../../src/commands/_cli.ts'
import { listServicesCmd, startServiceCmd } from '../../src/service-runtime.ts'

await runCommandApp({
  name: 'jib-daemon',
  version: pkg.version,
  description: 'Run long-lived jib operators',
  args: commonCliArgs,
  subCommands: {
    start: startServiceCmd,
    list: listServicesCmd,
  },
})
