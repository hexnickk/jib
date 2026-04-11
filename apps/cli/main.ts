#!/usr/bin/env bun
import pkg from '../../package.json' with { type: 'json' }
import addCmd from './cmd/add.ts'
import cloudflaredCmd from './cmd/cloudflared.ts'
import deployCmd from './cmd/deploy.ts'
import downCmd from './cmd/down.ts'
import execCmd from './cmd/exec.ts'
import initCmd from './cmd/init.ts'
import migrateCmd from './cmd/migrate.ts'
import removeCmd from './cmd/remove.ts'
import restartCmd from './cmd/restart.ts'
import runCmd from './cmd/run.ts'
import secretsCmd from './cmd/secrets.ts'
import sourcesCmd from './cmd/sources.ts'
import statusCmd from './cmd/status.ts'
import upCmd from './cmd/up.ts'
import watchCmd from './cmd/watch.ts'
import { commonCliArgs } from './modules/runtime/cli-runtime.ts'
import { runCommandApp } from './modules/runtime/command-app.ts'

await runCommandApp({
  name: 'jib',
  version: pkg.version,
  description: 'Lightweight deploy tool for docker-compose apps over SSH',
  args: commonCliArgs,
  subCommands: {
    migrate: migrateCmd,
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
    status: statusCmd,
    watch: watchCmd,
    sources: sourcesCmd,
    cloudflared: cloudflaredCmd,
  },
})
