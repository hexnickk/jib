/**
 * Barrel of every citty command definition under `src/commands/`. `main.ts`
 * imports this and mounts them on the root command. Each export is a
 * `CommandDef`; per-domain subcommand trees are assembled inside their
 * own file.
 */
export { default as addCmd } from './add.ts'
export { default as configCmd } from './config.ts'
export { downCmd, restartCmd, upCmd } from './containers.ts'
export { default as deployCmd } from './deploy.ts'
export { default as editCmd } from './edit.ts'
export { default as initCmd } from './init.ts'
export { default as removeCmd } from './remove.ts'
export { default as secretsCmd } from './secrets.ts'
export { default as serviceCmd } from './service.ts'
export { default as statusCmd } from './status.ts'
export { execCmd, runCmd } from './shell.ts'
