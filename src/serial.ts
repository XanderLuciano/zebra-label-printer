/**
 * Serial number sequences for multi-copy prints.
 *
 * Increments the trailing digit run of a value, so `NRG-001` yields `NRG-002`,
 * `NRG-003`, … The prefix and the zero-padding come from the value the caller sent,
 * which is why there is no separate format or width option: `NRG-001` and `NRG-1`
 * are different requests and both are honoured as written.
 *
 * Distinct from the scheme `POST /api/print/serial` uses, which takes a numeric
 * `serialStart` plus a `serialFormat` of hashes and substitutes a `{serial}`
 * placeholder. That endpoint composes text labels from scratch; here the serial is
 * an ordinary template variable whose value the caller already supplies, so deriving
 * the width and prefix from that value is both simpler and less to get wrong.
 */

/** A value split into the part that stays and the number that advances. */
interface ParsedSerial {
  prefix: string
  /** Numeric value of the trailing digit run. */
  value: number
  /** Digits in the run, so zero-padding is preserved. */
  width: number
}

/** Trailing digits, and everything before them. Null when there are no trailing digits. */
export function parseSerial(serial: string): ParsedSerial | null {
  const match = /^(.*?)(\d+)$/.exec(serial)
  if (!match) return null
  const [, prefix, digits] = match as unknown as [string, string, string]
  return { prefix, value: Number.parseInt(digits, 10), width: digits.length }
}

/**
 * The value `steps` after `serial`.
 *
 * Padding is preserved and *widened* rather than wrapped when the number outgrows it:
 * `NRG-999` + 1 is `NRG-1000`, not `NRG-000`. A silently wrapped serial would put two
 * different parts into the world carrying the same identifier, which is the one
 * outcome worth going out of the way to avoid.
 *
 * @returns null when `serial` has no trailing digits to advance.
 */
export function incrementSerial(serial: string, steps = 1): string | null {
  const parsed = parseSerial(serial)
  if (!parsed) return null
  const next = parsed.value + steps
  return `${parsed.prefix}${String(next).padStart(parsed.width, '0')}`
}

/**
 * `count` consecutive serials starting at `start`.
 *
 * @returns null when `start` has no trailing digits, so the caller can report that as
 *   a request problem rather than printing a batch of identical labels.
 */
export function serialSequence(start: string, count: number): string[] | null {
  if (!parseSerial(start)) return null
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    // Non-null: parseSerial already succeeded for this prefix/width.
    out.push(incrementSerial(start, i)!)
  }
  return out
}
