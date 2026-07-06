const BYTE_SIZE_RE = /^(0|[1-9]\d*)\s*([kmg])?(?:b)?$/i

export const DEFAULT_INGRESS_MAX_BODY_SIZE = '10m'

/**
 * Normalizes human byte-size input into ingress-compatible size syntax.
 * Input accepts integer bytes (`1048576`), nginx-style units (`10m`), and common
 * aliases (`10mb`, `10 MB`). Output is safe for backends that use k/m/g suffixes.
 * Returns `undefined` when the value cannot be represented by the supported grammar.
 */
export function configNormalizeByteSize(value: string): string | undefined {
  const match = value.trim().match(BYTE_SIZE_RE)
  if (!match) return undefined
  const amount = match[1]
  if (amount === undefined) return undefined
  const unit = match[2]?.toLowerCase() ?? ''
  return `${amount}${unit}`
}
