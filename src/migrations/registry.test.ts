import { expect, test } from 'vitest'
import { migrations } from './registry.ts'

test('migration IDs and ordering stay stable when source files are renamed', () => {
  expect(migrations.map((migration) => migration.id)).toEqual([
    '0001_ensure_dirs',
    '0002_ensure_config',
    '0003_ensure_group',
    '0006_install_docker',
    '0007_install_watcher',
    '0008_install_nginx',
    '0009_install_sudoers',
    '0010_expand_sudoers_for_nginx',
    '0011_repair_managed_secret_permissions',
    '0012_start_managed_services',
    '0013_apply_ingress_body_limit',
    '0014_move_build_args_to_env',
  ])
})
