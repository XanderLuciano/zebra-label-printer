/**
 * Template engine — re-exported from the backend package.
 *
 * The implementation moved to `src/template-engine.ts` when the server gained
 * the ability to render templates itself (`POST /api/print/template/{shortName}`).
 * The designer preview and a webhook print now resolve the same template through
 * the same code, so they cannot drift apart.
 *
 * This file stays so the web app's import paths don't change, and so Nuxt's
 * composable auto-import still sees the names.
 *
 * @see src/template-engine.ts — resolveTemplate(), substitute(), rotation geometry
 */

export * from '../../../src/template-engine'
