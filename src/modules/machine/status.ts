import { readFile, stat, statfs } from 'node:fs/promises'
import { cpus, hostname, loadavg, uptime } from 'node:os'
import { setTimeout } from 'node:timers/promises'
import type { Paths } from '@jib/paths'
import { $ } from '@/libs/shell'

export interface MachineDisk {
  mount: string
  total: number
  used: number
  available: number
  usedPercent: number
  inodePercent?: number
}

export interface MachineStatus {
  hostname: string
  cpuCount: number
  cpuPercent?: number
  load: number[]
  uptimeSeconds: number
  memory?: { total: number; available: number }
  swap?: { total: number; used: number }
  disks: MachineDisk[]
  unavailable: string[]
}

/** Samples CPU and collects root/Jib/Docker filesystem usage, deduplicated by device. */
export async function machineCollectStatus(ctx: { paths: Paths }): Promise<MachineStatus> {
  const first = cpus()
  const cpuSample = setTimeout(250).then(() => cpus())
  const result: MachineStatus = {
    hostname: hostname(),
    cpuCount: first.length,
    load: loadavg(),
    uptimeSeconds: uptime(),
    disks: [],
    unavailable: [],
  }
  try {
    const raw = await readFile('/proc/meminfo', 'utf8')
    const values = Object.fromEntries(
      [...raw.matchAll(/^(\w+):\s+(\d+) kB$/gm)].map((match) => [
        match[1],
        Number(match[2]) * 1024,
      ]),
    )
    // MemAvailable includes reclaimable cache; MemFree alone overstates memory pressure.
    if (values.MemTotal !== undefined && values.MemAvailable !== undefined) {
      result.memory = { total: values.MemTotal, available: values.MemAvailable }
    }
    if (values.SwapTotal !== undefined && values.SwapFree !== undefined) {
      result.swap = { total: values.SwapTotal, used: values.SwapTotal - values.SwapFree }
    }
  } catch {
    result.unavailable.push('memory and swap')
  }
  const targets = ['/', ctx.paths.root]
  try {
    const docker = await $({ timeout: '5s' })`docker info --format ${'{{.DockerRootDir}}'}`
    if (docker.exitCode === 0 && docker.stdout.trim().startsWith('/')) {
      targets.push(docker.stdout.trim())
    } else {
      result.unavailable.push('Docker data filesystem')
    }
  } catch {
    result.unavailable.push('Docker data filesystem')
  }
  const devices = new Set<number>()
  for (const path of targets) {
    try {
      const info = await stat(path)
      if (devices.has(info.dev)) {
        continue
      }
      const space = await statfs(path)
      const mount = await $({ timeout: '5s' })`findmnt --json --target ${path} --output TARGET`
      const parsed: { filesystems?: { target?: string }[] } =
        mount.exitCode === 0 ? JSON.parse(mount.stdout) : {}
      const used = (space.blocks - space.bfree) * space.bsize
      const available = space.bavail * space.bsize
      result.disks.push({
        mount: parsed.filesystems?.[0]?.target ?? path,
        total: space.blocks * space.bsize,
        used,
        available,
        usedPercent: used + available > 0 ? (used / (used + available)) * 100 : 0,
        ...(space.files > 0
          ? { inodePercent: ((space.files - space.ffree) / space.files) * 100 }
          : {}),
      })
      devices.add(info.dev)
    } catch {
      result.unavailable.push(`filesystem ${path}`)
    }
  }
  const second = await cpuSample
  let elapsed = 0
  let idle = 0
  if (first.length === second.length) {
    first.forEach((cpu, index) => {
      const after = second[index]
      if (after) {
        elapsed +=
          Object.values(after.times).reduce((sum, time) => sum + time, 0) -
          Object.values(cpu.times).reduce((sum, time) => sum + time, 0)
        idle += after.times.idle - cpu.times.idle
      }
    })
  }
  if (elapsed > 0) {
    result.cpuPercent = Math.max(0, Math.min(100, (1 - idle / elapsed) * 100))
  }
  return result
}

/** Formats binary resource sizes consistently in terminal and Telegram snapshots. */
function machineFormatBytes(bytes: number) {
  if (bytes === 0) {
    return '0 B'
  }
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const unit = Math.min(Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))), units.length - 1)
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** Summarizes actionable resource pressure without treating one CPU spike as an outage. */
export function machineWarnings(machine: MachineStatus) {
  const warnings: string[] = []
  for (const disk of machine.disks) {
    if (disk.usedPercent >= 85) {
      warnings.push(
        `Disk space low: ${disk.mount} has ${machineFormatBytes(disk.available)} free (${Math.round(disk.usedPercent)}% used)`,
      )
    }
    if ((disk.inodePercent ?? 0) >= 85) {
      warnings.push(`Inodes low: ${disk.mount} (${Math.round(disk.inodePercent ?? 0)}% used)`)
    }
  }
  if (machine.memory && machine.memory.available < machine.memory.total * 0.1) {
    warnings.push(`Memory pressure: ${machineFormatBytes(machine.memory.available)} available`)
  }
  if (machine.cpuCount > 0 && (machine.load[1] ?? 0) > machine.cpuCount) {
    warnings.push('5-minute load exceeds CPU count')
  }
  return warnings
}

/** Shared host snapshot lines: sampled values, not historical daily averages. */
export function machineFormatStatus(machine: MachineStatus) {
  const memory = machine.memory
  const swap = machine.swap
  return [
    `CPU: ${machine.cpuPercent === undefined ? 'unknown' : `${Math.round(machine.cpuPercent)}% (sampled)`} · ${machine.cpuCount || 'unknown'} cores`,
    `Load: ${machine.load.map((load) => load.toFixed(2)).join(' / ')} (1/5/15 min)`,
    `Memory: ${memory ? `${machineFormatBytes(memory.total - memory.available)} / ${machineFormatBytes(memory.total)} used` : 'unknown'}`,
    `Swap: ${swap ? `${machineFormatBytes(swap.used)} / ${machineFormatBytes(swap.total)} used` : 'unknown'}`,
    ...machine.disks.map(
      (disk) =>
        `Disk ${disk.mount}: ${machineFormatBytes(disk.used)} / ${machineFormatBytes(disk.total)} used (${Math.round(disk.usedPercent)}%) · ${machineFormatBytes(disk.available)} free`,
    ),
    `Uptime: ${Math.floor(machine.uptimeSeconds / 86400)} days, ${Math.floor((machine.uptimeSeconds % 86400) / 3600)} hours`,
    ...machine.unavailable.map((metric) => `${metric}: unknown`),
  ]
}
