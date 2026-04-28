/**
 * Update checker — compares current version against latest GitHub tag.
 *
 * Uses the GitHub Tags API. Results are cached in settings to avoid rate-limiting.
 */

import { getSetting, setSetting } from './db/settings-repo'

const GITHUB_API = 'https://api.github.com/repos/XanderLuciano/zebra-label-printer/tags'
const CURRENT_VERSION = '0.1.0' // Keep in sync with package.json

export interface UpdateInfo {
  current: string
  latest: string | null
  updateAvailable: boolean
  checkedAt: string | null
  error: string | null
  releaseUrl: string | null
  releaseNotes: string | null
}

/**
 * Check GitHub for the latest tag.
 * Caches the result for `cacheMinutes` to avoid API rate limits.
 */
export async function checkForUpdates(cacheMinutes = 60): Promise<UpdateInfo> {
  const cachedRaw = getSetting('update_check')
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw)
      const age = Date.now() - cached.timestamp
      if (age < cacheMinutes * 60 * 1000) {
        return cached.result
      }
    } catch { /* stale cache, re-check */ }
  }

  try {
    const res = await fetch(GITHUB_API, {
      headers: {
        'User-Agent': 'zebra-label-printer',
        'Accept': 'application/vnd.github+json'
      },
      signal: AbortSignal.timeout(10000)
    })

    if (!res.ok) {
      throw new Error(`GitHub API returned ${res.status}`)
    }

    const tags = await res.json() as Array<{ name: string }>

    if (!Array.isArray(tags) || tags.length === 0) {
      throw new Error('No tags found')
    }

    const latestTag = tags[0].name.replace(/^v/, '')
    const updateAvailable = compareVersions(latestTag, CURRENT_VERSION) > 0
    const releaseUrl = `https://github.com/XanderLuciano/zebra-label-printer/releases/tag/${tags[0].name}`

    const result: UpdateInfo = {
      current: CURRENT_VERSION,
      latest: latestTag,
      updateAvailable,
      checkedAt: new Date().toISOString(),
      error: null,
      releaseUrl,
      releaseNotes: null
    }

    // Cache
    setSetting('update_check', {
      timestamp: Date.now(),
      result
    })

    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return {
      current: CURRENT_VERSION,
      latest: null,
      updateAvailable: false,
      checkedAt: new Date().toISOString(),
      error: msg,
      releaseUrl: null,
      releaseNotes: null
    }
  }
}

/**
 * Compare two semver strings. Returns positive if a > b.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}
