import { $ as zx$ } from 'zx'

// Approved project-wide shell default: jib command adapters expect command
// results and decide typed errors themselves, so zx should not throw on
// non-zero exits by default. Keep this in one import path instead of repeating
// `{ quiet: true, nothrow: true }` at every shell-out call site.
zx$.quiet = true
zx$.nothrow = true

export const $ = zx$
