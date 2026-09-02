/**
 * Label-size matching between a print job and configured printers.
 *
 * Kept pure (no Vue, no Nuxt) so it can be unit-tested from the root test suite
 * the same way the template engine is.
 */

export interface LabelSizeDots {
  widthDots: number
  heightDots: number
}

/**
 * Do two label sizes describe the same stock?
 *
 * Compared in dots, not inches: template elements are resolved into dot
 * coordinates for a specific size, so "3×5 at 203 DPI" and "3×5 at 300 DPI" are
 * different print targets even though the paper is the same.
 */
export function sameLabelSize(a: LabelSizeDots, b: LabelSizeDots): boolean {
  return a.widthDots === b.widthDots && a.heightDots === b.heightDots
}

/**
 * The printer to offer when the selected one is loaded with the wrong stock.
 *
 * Only ready printers qualify — offering an unplugged printer would swap one
 * failed print for another. When several match, one the whole shop shares wins
 * over one paired to this browser, and the server default wins among servers,
 * on the logic that the shared printer is the one most likely to actually be
 * loaded with what its configuration claims.
 */
export function findPrinterForSize<
  T extends {
    id: string
    ready: boolean
    connection: 'server' | 'local'
    isDefault: boolean
    labelSize: LabelSizeDots
  },
>(printers: readonly T[], size: LabelSizeDots, excludeId?: string | null): T | null {
  const candidates = printers.filter(p =>
    p.id !== excludeId && p.ready && sameLabelSize(p.labelSize, size))
  if (candidates.length === 0) return null

  const rank = (p: T): number =>
    p.connection === 'server' ? (p.isDefault ? 0 : 1) : 2
  return [...candidates].sort((a, b) => rank(a) - rank(b))[0] ?? null
}
