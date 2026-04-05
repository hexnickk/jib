/**
 * Indirection over `Bun.$` so install/uninstall can be code-reviewed without
 * reaching for Bun globals directly. The re-export is a single symbol so
 * tests can stub it via module mock if end-to-end install coverage is ever
 * added (today install is not tested — it requires root + systemctl).
 */
export const Bun$ = Bun.$
