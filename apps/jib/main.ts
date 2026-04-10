#!/usr/bin/env bun
import pkg from '../../package.json' with { type: 'json' }
import { runCommandApp } from '../../src/command-app.ts'
import { commonCliArgs } from '../../src/commands/_cli.ts'
import {
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
  sourcesCmd,
  statusCmd,
  upCmd,
} from '../../src/commands/index.ts'
import { moduleSubCommands as getModuleSubCommands } from '../../src/module-registry.ts'

await runCommandApp({
  name: 'jib',
  version: pkg.version,
  description: 'Lightweight deploy tool for docker-compose apps over SSH',
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
    sources: sourcesCmd,
    ...getModuleSubCommands(),
  },
})
