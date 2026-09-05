/**
 * ZPL font metrics — re-exported from the backend package.
 *
 * The implementation moved to `src/zpl-fonts.ts` when the server gained the
 * ability to render templates itself (`POST /api/print/template/{shortName}`).
 * Two copies of these measurements would let the designer canvas and the printed
 * label disagree, which is the one thing this module exists to prevent.
 *
 * This file stays so the web app's import paths don't change, and so Nuxt's
 * composable auto-import still sees the names.
 *
 * @see src/zpl-fonts.ts — the measurements, and how they were taken
 */

export * from '../../../src/zpl-fonts'
