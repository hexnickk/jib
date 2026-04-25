import { m0001_ensure_dirs } from './0001_ensure_dirs.ts'
import { m0002_ensure_config } from './0002_ensure_config.ts'
import { m0003_ensure_group } from './0003_ensure_group.ts'
import { m0006_install_docker } from './0006_install_docker.ts'
import { m0007_install_watcher } from './0007_install_watcher.ts'
import { m0008_install_nginx } from './0008_install_nginx.ts'
import { m0009_install_sudoers } from './0009_install_sudoers.ts'
import { m0010_expand_sudoers_for_nginx } from './0010_expand_sudoers_for_nginx.ts'
import { m0011_repair_managed_secret_permissions } from './0011_repair_managed_secret_permissions.ts'
import { m0012_start_managed_services } from './0012_start_managed_services.ts'
import type { JibMigration } from './types.ts'

export const migrations: JibMigration[] = [
  m0001_ensure_dirs,
  m0002_ensure_config,
  m0003_ensure_group,
  m0006_install_docker,
  m0007_install_watcher,
  m0008_install_nginx,
  m0009_install_sudoers,
  m0010_expand_sudoers_for_nginx,
  m0011_repair_managed_secret_permissions,
  m0012_start_managed_services,
]
