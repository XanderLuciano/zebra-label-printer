/**
 * Label-size matching — re-exported from the backend package.
 *
 * The implementation moved to `src/label-size-match.ts` when the server gained
 * printer auto-selection: `POST /api/print/template/{shortName}` now routes a
 * template to a printer loaded with the stock it was designed for, which is the
 * same question this answers for the print page. Two copies would let the UI offer
 * one printer while the API silently chose another.
 *
 * @see src/label-size-match.ts
 */

export * from '../../../src/label-size-match'
