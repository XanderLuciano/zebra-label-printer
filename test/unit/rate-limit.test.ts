/**
 * RateLimiter. Time is injected into `check()` so these tests don't sleep —
 * anything that looks like it tests the clock is testing window arithmetic.
 */

import { describe, it, expect } from 'vitest'
import { RateLimiter, rateLimitKey } from '../../src/server/rate-limit'
import type { IncomingMessage } from 'http'

describe('RateLimiter', () => {
  it('allows requests up to the limit and refuses the next', () => {
    const limiter = new RateLimiter(3)
    const t = 1_000_000

    expect(limiter.check('a', t).allowed).toBe(true)
    expect(limiter.check('a', t).allowed).toBe(true)
    expect(limiter.check('a', t).allowed).toBe(true)
    expect(limiter.check('a', t).allowed).toBe(false)
  })

  it('counts down the remaining allowance', () => {
    const limiter = new RateLimiter(3)
    const t = 1_000_000
    expect(limiter.check('a', t).remaining).toBe(2)
    expect(limiter.check('a', t).remaining).toBe(1)
    expect(limiter.check('a', t).remaining).toBe(0)
    expect(limiter.check('a', t).remaining).toBe(0)
  })

  it('keys separate callers independently', () => {
    // Otherwise one busy integration would lock out everybody else.
    const limiter = new RateLimiter(1)
    const t = 1_000_000
    expect(limiter.check('a', t).allowed).toBe(true)
    expect(limiter.check('b', t).allowed).toBe(true)
    expect(limiter.check('a', t).allowed).toBe(false)
    expect(limiter.check('b', t).allowed).toBe(false)
  })

  it('opens a fresh window once the old one expires', () => {
    const limiter = new RateLimiter(2, 60_000)
    const t = 1_000_000
    limiter.check('a', t)
    limiter.check('a', t)
    expect(limiter.check('a', t).allowed).toBe(false)

    // One millisecond before expiry: still closed.
    expect(limiter.check('a', t + 59_999).allowed).toBe(false)
    // At expiry: a new window, full allowance.
    const reopened = limiter.check('a', t + 60_000)
    expect(reopened.allowed).toBe(true)
    expect(reopened.remaining).toBe(1)
  })

  it('reports a retry-after that never rounds down to zero', () => {
    // `Retry-After: 0` invites an immediate retry, which is exactly what we're
    // trying to prevent.
    const limiter = new RateLimiter(1, 60_000)
    const t = 1_000_000
    limiter.check('a', t)
    const blocked = limiter.check('a', t + 59_999)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  it('reports the full window as retry-after at the start of one', () => {
    const limiter = new RateLimiter(1, 60_000)
    const t = 1_000_000
    limiter.check('a', t)
    expect(limiter.check('a', t).retryAfterSeconds).toBe(60)
  })

  it('is disabled by a limit of zero or below', () => {
    for (const limit of [0, -1]) {
      const limiter = new RateLimiter(limit)
      expect(limiter.enabled).toBe(false)
      // Not just "allows a lot" — allows without bookkeeping.
      for (let i = 0; i < 1000; i++) {
        expect(limiter.check('a', 1_000_000).allowed).toBe(true)
      }
    }
  })

  it('is enabled by any positive limit', () => {
    expect(new RateLimiter(1).enabled).toBe(true)
  })

  it('forgets everything on reset', () => {
    const limiter = new RateLimiter(1)
    const t = 1_000_000
    limiter.check('a', t)
    expect(limiter.check('a', t).allowed).toBe(false)
    limiter.reset()
    expect(limiter.check('a', t).allowed).toBe(true)
  })

  it('does not accumulate windows for callers that have gone away', () => {
    // A publicly reachable endpoint means the key space is driven by strangers, so
    // without a sweep the Map is an unbounded allocation.
    const limiter = new RateLimiter(5, 1000)
    const start = 1_000_000
    for (let i = 0; i < 500; i++) {
      limiter.check(`caller-${i}`, start)
    }
    // Well past both the window and the sweep interval.
    limiter.check('someone-else', start + 120_000)

    const windows = (limiter as unknown as { windows: Map<string, unknown> }).windows
    expect(windows.size).toBeLessThan(500)
  })
})

describe('rateLimitKey', () => {
  it('uses the socket address', () => {
    const req = { socket: { remoteAddress: '10.0.0.5' } } as IncomingMessage
    expect(rateLimitKey(req)).toBe('10.0.0.5')
  })

  it('ignores X-Forwarded-For, which a caller could forge to escape the limit', () => {
    const req = {
      socket: { remoteAddress: '10.0.0.5' },
      headers: { 'x-forwarded-for': '1.2.3.4' }
    } as unknown as IncomingMessage
    expect(rateLimitKey(req)).toBe('10.0.0.5')
  })

  it('falls back to a shared bucket rather than escaping the limit', () => {
    // An address we can't read must not become an exemption.
    const req = { socket: {} } as IncomingMessage
    expect(rateLimitKey(req)).toBe('unknown')
  })
})
