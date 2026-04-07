/**
 * Barrel of every citty command definition under `src/commands/`. `main.ts`
 * imports this and mounts them on the root command. Each export is a
 * `CommandDef`; per-domain subcommand trees are assembled inside their
 * own file.
 */
export { default as addCmd } from './add.ts'
export { default as downCmd } from './down.ts'
export { default as restartCmd } from './restart.ts'
export { default as upCmd } from './up.ts'
export { default as deployCmd } from './deploy.ts'
export { default as initCmd } from './init/index.ts'
export { default as removeCmd } from './remove.ts'
export { default as secretsCmd } from './secrets.ts'
export { default as serviceCmd } from './service.ts'
export { default as statusCmd } from './status.ts'
export { default as execCmd } from './exec.ts'
export { default as runCmd } from './run.ts'
