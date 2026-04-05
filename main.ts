#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'
import {
  addCmd,
  configCmd,
  deployCmd,
  downCmd,
  editCmd,
  execCmd,
  initCmd,
  removeCmd,
  restartCmd,
  resumeCmd,
  rollbackCmd,
  runCmd,
  secretsCmd,
  serviceCmd,
  upCmd,
  webhookCmd,
} from './src/commands/index.ts'

/**
 * CLI entry point. Kept intentionally thin: every command's business logic
 * lives under `src/commands/` so this file only wires them into citty's
 * tree. `bun build --compile` uses this as the single input for the
 * distribution binary.
 */
const main = defineCommand({
  meta: {
    name: 'jib',
    version: '0.0.0',
    description: 'Lightweight deploy tool for docker-compose apps over SSH',
  },
  subCommands: {
    init: initCmd,
    add: addCmd,
    remove: removeCmd,
    deploy: deployCmd,
    rollback: rollbackCmd,
    resume: resumeCmd,
    config: configCmd,
    edit: editCmd,
    up: upCmd,
    down: downCmd,
    restart: restartCmd,
    exec: execCmd,
    run: runCmd,
    secrets: secretsCmd,
    service: serviceCmd,
    webhook: webhookCmd,
  },
})

await runMain(main)
