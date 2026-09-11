/**
 * Label-size matching between a print job and configured printers.
 *
 * Shared by the web print page, which offers the operator a better printer when the
 * selected one holds the wrong stock, and by the template print webhook, which makes
 * that choice on its own. Two copies would let the UI recommend one printer while the
 * API silently picked another. `web/app/utils/label-size-match.ts` re-exports this.
 *
 * Compiled twice — CommonJS by `tsc`, ESM by Vite — so keep it free of Node
 * built-ins and browser globals.
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
 * A printer loaded with the given stock, or null.
 *
 * When several match, one the whole shop shares wins over one paired to a single
 * browser, and the server default wins among servers, on the logic that the shared
 * printer is the one most likely to actually be loaded with what its configuration
 * claims.
 *
 * `ready` is optional and treated as ready when absent, because the two callers want
 * different things from it:
 *
 *   - The **web print page** passes it. It is offering the operator a printer to use
 *     right now, and suggesting an unplugged one swaps one failed print for another.
 *   - The **template print webhook** omits it. An unreachable printer means the job
 *     queues and goes out on the correct stock when the printer returns, which beats
 *     printing immediately on the wrong stock. Probing readiness would also add a
 *     discovery round-trip to every print.
 */
export function findPrinterForSize<
  T extends {
    id: string
    ready?: boolean
    connection: 'server' | 'local'
    isDefault: boolean
    labelSize: LabelSizeDots
  }
>(printers: readonly T[], size: LabelSizeDots, excludeId?: string | null): T | null {
  const candidates = printers.filter(p =>
    p.id !== excludeId && p.ready !== false && sameLabelSize(p.labelSize, size))
  if (candidates.length === 0) return null

  const rank = (p: T): number =>
    p.connection === 'server' ? (p.isDefault ? 0 : 1) : 2
  return [...candidates].sort((a, b) => rank(a) - rank(b))[0] ?? null
}
