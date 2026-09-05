/**
 * templatePrintSchema — the webhook print request body.
 *
 * The seams worth covering are in the flat/nested duality: both forms must land on
 * one normalised shape. See .ai/template-print-api.md for why both are accepted.
 */

import { describe, it, expect } from 'vitest'
import {
  templatePrintSchema,
  templateShortNameSchema,
  optionalTemplateShortNameSchema,
  templateSchema
} from '../../src/schemas'
import { MAX_COPIES, RESERVED_TEMPLATE_SHORT_NAMES } from '../../src/constants'

/** Parse and return data, failing the test with the issues if it didn't validate. */
function parse(input: unknown) {
  const result = templatePrintSchema.safeParse(input)
  if (!result.success) {
    throw new Error(`expected valid, got: ${JSON.stringify(result.error.issues)}`)
  }
  return result.data
}

/** The issues from a parse expected to fail. */
function issues(input: unknown) {
  const result = templatePrintSchema.safeParse(input)
  expect(result.success).toBe(false)
  return result.success ? [] : result.error.issues
}

describe('templatePrintSchema — nested (canonical) form', () => {
  it('accepts variables and a quantity', () => {
    const data = parse({ variables: { partNumber: '135853-002' }, quantity: 3 })
    expect(data.variables).toEqual({ partNumber: '135853-002' })
    expect(data.quantity).toBe(3)
  })

  it('defaults to one copy, no variables, server target', () => {
    const data = parse({})
    expect(data.quantity).toBe(1)
    expect(data.variables).toEqual({})
    expect(data.target).toBe('server')
    expect(data.dryRun).toBe(false)
    expect(data.allowMissingVariables).toBe(false)
  })

  it('rejects a stray sibling key rather than treating it as a variable', () => {
    // Once `variables` is present the body's shape is known, so an unexpected key
    // is likelier a mistake than a variable.
    const found = issues({ variables: { a: '1' }, partNumber: 'X' })
    expect(JSON.stringify(found)).toMatch(/partNumber/)
  })
})

describe('templatePrintSchema — flat convenience form', () => {
  it('treats unrecognised top-level keys as variables', () => {
    const data = parse({ partNumber: '135853-002', rev: 'C' })
    expect(data.variables).toEqual({ partNumber: '135853-002', rev: 'C' })
  })

  it('separates control fields from variables', () => {
    const data = parse({
      partNumber: 'X',
      quantity: 2,
      dryRun: true,
      printerId: 'prt_1',
      target: 'local',
      labelSize: { widthDots: 406, heightDots: 203 }
    })
    expect(data.variables).toEqual({ partNumber: 'X' })
    expect(data.quantity).toBe(2)
    expect(data.dryRun).toBe(true)
    expect(data.printerId).toBe('prt_1')
    expect(data.target).toBe('local')
  })

  it('yields no variables when the body is only control fields', () => {
    expect(parse({ quantity: 5 }).variables).toEqual({})
  })

  it('cannot express a variable that collides with a control key', () => {
    // Asserted so the documented trade-off stays a known one rather than a surprise.
    const data = parse({ quantity: 4 })
    expect(data.variables).not.toHaveProperty('quantity')
    expect(data.quantity).toBe(4)

    // The nested form is the escape hatch.
    const nested = parse({ variables: { quantity: '4' }, quantity: 1 })
    expect(nested.variables).toEqual({ quantity: '4' })
    expect(nested.quantity).toBe(1)
  })

  it('does not let a variable named __proto__ pollute the prototype', () => {
    // `__proto__` matches the variable-name pattern and JSON.parse creates it as a
    // real own property, so it does reach the fold. The prototype staying untouched
    // is what matters; the key being dropped means such a variable is reported
    // missing, which is legible, rather than blank on a label.
    const body = JSON.parse('{"__proto__": "polluted", "partNumber": "X"}')
    expect(Object.keys(body)).toContain('__proto__')

    const data = parse(body)
    expect(data.variables).toEqual({ partNumber: 'X' })
    expect(Object.keys(data.variables)).not.toContain('__proto__')
    expect(Object.getPrototypeOf(data.variables)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect('polluted' in Object.prototype).toBe(false)
  })
})

describe('templatePrintSchema — variable values', () => {
  it('stringifies numbers and booleans', () => {
    // A payload assembled by another service very often has real JSON numbers in
    // it; requiring them quoted would reject the common case.
    const data = parse({ variables: { qty: 12, ok: true, zero: 0, negative: -3.5 } })
    expect(data.variables).toEqual({ qty: '12', ok: 'true', zero: '0', negative: '-3.5' })
  })

  it('rejects objects, arrays, and null', () => {
    expect(templatePrintSchema.safeParse({ variables: { a: { b: 1 } } }).success).toBe(false)
    expect(templatePrintSchema.safeParse({ variables: { a: ['x'] } }).success).toBe(false)
    expect(templatePrintSchema.safeParse({ variables: { a: null } }).success).toBe(false)
  })

  it('rejects a non-finite number rather than printing "Infinity"', () => {
    // JSON has no Infinity literal, but a library caller can hand one over.
    expect(templatePrintSchema.safeParse({ variables: { a: Infinity } }).success).toBe(false)
    expect(templatePrintSchema.safeParse({ variables: { a: NaN } }).success).toBe(false)
  })

  it('rejects a variable name with characters a template could never declare', () => {
    expect(templatePrintSchema.safeParse({ variables: { 'part-number': 'X' } }).success).toBe(false)
    expect(templatePrintSchema.safeParse({ variables: { 'part number': 'X' } }).success).toBe(false)
  })

  it('accepts an empty string as an explicit blank', () => {
    // Distinct from omitting the variable: the caller is saying "print nothing
    // here", which the handler must not treat as missing.
    expect(parse({ variables: { rev: '' } }).variables).toEqual({ rev: '' })
  })
})

describe('templatePrintSchema — quantity', () => {
  it('accepts `copies` as a synonym', () => {
    expect(parse({ copies: 7 }).quantity).toBe(7)
  })

  it('accepts both when they agree', () => {
    expect(parse({ quantity: 7, copies: 7 }).quantity).toBe(7)
  })

  it('rejects both when they disagree', () => {
    const found = issues({ quantity: 7, copies: 4 })
    expect(found[0]?.message).toMatch(/not both/)
  })

  it('drops `copies` from the parsed output so the handler reads one field', () => {
    expect(parse({ copies: 7 })).not.toHaveProperty('copies')
  })

  it('enforces the copy ceiling with a message that names the limit', () => {
    expect(parse({ quantity: MAX_COPIES }).quantity).toBe(MAX_COPIES)
    const found = issues({ quantity: MAX_COPIES + 1 })
    expect(found[0]?.message).toContain(String(MAX_COPIES))
  })

  it('rejects zero, negatives, and fractions', () => {
    for (const quantity of [0, -1, 2.5]) {
      expect(templatePrintSchema.safeParse({ quantity }).success).toBe(false)
    }
  })
})

describe('templatePrintSchema — malformed bodies', () => {
  it('rejects an array', () => {
    // A future batch endpoint may take an array; until then, rejecting it is
    // better than folding it into a single nonsensical print.
    expect(templatePrintSchema.safeParse([{ partNumber: 'X' }]).success).toBe(false)
  })

  it('rejects a bare string or number', () => {
    expect(templatePrintSchema.safeParse('part-2x1').success).toBe(false)
    expect(templatePrintSchema.safeParse(42).success).toBe(false)
  })
})

describe('templateShortNameSchema', () => {
  it('accepts hyphen-separated lowercase alphanumerics', () => {
    for (const slug of ['part-2x1', 'bag', 'asset-3x5-landscape', 'x1', '2x1']) {
      expect(templateShortNameSchema.safeParse(slug)).toMatchObject({ success: true })
    }
  })

  it('normalises case and surrounding whitespace', () => {
    // So nobody has to remember capitalisation in a URL, and so two rows can't
    // differ only in a way that is invisible in a webhook address.
    expect(templateShortNameSchema.parse('  PART-2X1 ')).toBe('part-2x1')
  })

  it('rejects leading, trailing, and doubled hyphens', () => {
    for (const slug of ['-part', 'part-', 'part--2x1', '-', '--']) {
      expect(templateShortNameSchema.safeParse(slug).success).toBe(false)
    }
  })

  it('rejects spaces, underscores, dots, and slashes', () => {
    for (const slug of ['part 2x1', 'part_2x1', 'part.2x1', 'part/2x1', 'part%202x1']) {
      expect(templateShortNameSchema.safeParse(slug).success).toBe(false)
    }
  })

  it('enforces the length bounds', () => {
    expect(templateShortNameSchema.safeParse('a').success).toBe(false)
    expect(templateShortNameSchema.safeParse('ab').success).toBe(true)
    expect(templateShortNameSchema.safeParse('a'.repeat(64)).success).toBe(true)
    expect(templateShortNameSchema.safeParse('a'.repeat(65)).success).toBe(false)
  })

  it('refuses every reserved word, so no template can shadow an API path', () => {
    for (const reserved of RESERVED_TEMPLATE_SHORT_NAMES) {
      expect(
        templateShortNameSchema.safeParse(reserved).success,
        `'${reserved}' should be reserved`
      ).toBe(false)
    }
  })

  it('refuses a reserved word regardless of case, since lookup lowercases', () => {
    expect(templateShortNameSchema.safeParse('LABEL').success).toBe(false)
  })

  it('allows a reserved word used as part of a longer slug', () => {
    expect(templateShortNameSchema.safeParse('label-2x1').success).toBe(true)
    expect(templateShortNameSchema.safeParse('text-only').success).toBe(true)
  })
})

describe('optionalTemplateShortNameSchema', () => {
  it('treats blank and null as "no short name"', () => {
    // A form binding an empty input and a client explicitly nulling the field are
    // saying the same thing; neither is a validation failure.
    expect(optionalTemplateShortNameSchema.parse('')).toBeUndefined()
    expect(optionalTemplateShortNameSchema.parse(null)).toBeUndefined()
    expect(optionalTemplateShortNameSchema.parse(undefined)).toBeUndefined()
  })

  it('still validates a value that is present', () => {
    expect(optionalTemplateShortNameSchema.safeParse('Bad Slug').success).toBe(false)
  })
})

describe('templateSchema — shortName integration', () => {
  const base = {
    name: 'Test Template',
    baseWidthDots: 406,
    baseHeightDots: 203,
    variables: [],
    elements: [],
    overrides: {}
  }

  it('accepts a template without a short name', () => {
    const parsed = templateSchema.parse(base)
    expect(parsed.shortName).toBeUndefined()
  })

  it('normalises a short name into the definition', () => {
    expect(templateSchema.parse({ ...base, shortName: 'My-Label' }).shortName).toBe('my-label')
  })

  it('rejects a template whose short name is reserved', () => {
    expect(templateSchema.safeParse({ ...base, shortName: 'label' }).success).toBe(false)
  })
})
