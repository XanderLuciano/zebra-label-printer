/**
 * A fixed-window rate limiter for the endpoints that spend label stock.
 *
 * **Not a security boundary** — setting `ZEBRA_API_KEY` is. This bounds the damage
 * a runaway loop or casual abuser does before somebody notices, which matters
 * because the consumed resource is physical and doesn't come back.
 *
 * Two limitations, both preferred to the alternatives:
 *
 *   - **Per-process.** Nothing to share counters with: one process, local hardware.
 *   - **Keyed on the socket address**, ignoring `X-Forwarded-For`. Behind a proxy
 *     the limit becomes global rather than per-client — the wrong shape, but the
 *     safe direction to be wrong in, since trusting a client-supplied header lets
 *     anyone bypass the limit by varying it.
 */

import type { IncomingMessage } from 'http'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  /** Seconds until the window resets. Meant for `Retry-After`. */
  retryAfterSeconds: number
  limit: number
}

interface Window {
  count: number
  /** Epoch ms at which this window expires. */
  expiresAt: number
}

const SWEEP_INTERVAL_MS = 60_000

export class RateLimiter {
  private windows = new Map<string, Window>()
  private lastSweep = 0

  /** @param limit - Requests per window. 0 or below disables the limiter. */
  constructor(
    private readonly limit: number,
    private readonly windowMs: number = 60_000
  ) {}

  get enabled(): boolean {
    return this.limit > 0
  }

  /** @param now - Injectable so tests don't have to sleep. */
  check(key: string, now: number = Date.now()): RateLimitResult {
    if (!this.enabled) {
      return { allowed: true, remaining: Infinity, retryAfterSeconds: 0, limit: this.limit }
    }

    this.sweep(now)

    const existing = this.windows.get(key)
    if (!existing || existing.expiresAt <= now) {
      this.windows.set(key, { count: 1, expiresAt: now + this.windowMs })
      return {
        allowed: true,
        remaining: this.limit - 1,
        retryAfterSeconds: 0,
        limit: this.limit
      }
    }

    existing.count += 1
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.expiresAt - now) / 1000))
    if (existing.count > this.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds, limit: this.limit }
    }
    return {
      allowed: true,
      remaining: this.limit - existing.count,
      retryAfterSeconds,
      limit: this.limit
    }
  }

  reset(): void {
    this.windows.clear()
    this.lastSweep = 0
  }

  /**
   * Drop expired windows. Without this the Map grows one entry per caller
   * forever — for a publicly reachable endpoint, an unbounded allocation driven
   * by strangers.
   */
  private sweep(now: number): void {
    if (now - this.lastSweep < SWEEP_INTERVAL_MS) return
    this.lastSweep = now
    for (const [key, window] of this.windows) {
      if (window.expiresAt <= now) this.windows.delete(key)
    }
  }
}

/**
 * Falls back to a constant when the address is unavailable, so those requests
 * share one bucket rather than escaping the limit.
 */
export function rateLimitKey(req: IncomingMessage): string {
  return req.socket?.remoteAddress ?? 'unknown'
}
