/**
 * Serial sequences for multi-copy template prints.
 *
 * The padding-overflow case is the one that matters most: a wrapped serial puts two
 * different parts into the world under the same identifier.
 */

import { describe, it, expect } from 'vitest'
import { parseSerial, incrementSerial, serialSequence } from '../../src/serial'

describe('parseSerial', () => {
  it('splits a prefix from the trailing digits', () => {
    expect(parseSerial('NRG-001')).toEqual({ prefix: 'NRG-', value: 1, width: 3 })
  })

  it('handles a bare number', () => {
    expect(parseSerial('42')).toEqual({ prefix: '', value: 42, width: 2 })
  })

  it('takes only the trailing run, leaving earlier digits in the prefix', () => {
    // `135853-002` is a part number with a revision suffix; only the suffix advances.
    expect(parseSerial('135853-002')).toEqual({ prefix: '135853-', value: 2, width: 3 })
  })

  it('returns null when there are no trailing digits', () => {
    expect(parseSerial('NRG-ABC')).toBeNull()
    expect(parseSerial('')).toBeNull()
    expect(parseSerial('001-NRG')).toBeNull()
  })
})

describe('incrementSerial', () => {
  it('advances by one, preserving prefix and padding', () => {
    expect(incrementSerial('NRG-001')).toBe('NRG-002')
    expect(incrementSerial('NRG-009')).toBe('NRG-010')
    expect(incrementSerial('A1')).toBe('A2')
  })

  it('advances by an arbitrary number of steps', () => {
    expect(incrementSerial('NRG-001', 0)).toBe('NRG-001')
    expect(incrementSerial('NRG-001', 4)).toBe('NRG-005')
    expect(incrementSerial('NRG-001', 99)).toBe('NRG-100')
  })

  it('widens the padding instead of wrapping', () => {
    // Wrapping would reissue NRG-000 and give two parts the same serial.
    expect(incrementSerial('NRG-999')).toBe('NRG-1000')
    expect(incrementSerial('NRG-99', 2)).toBe('NRG-101')
    expect(incrementSerial('9')).toBe('10')
  })

  it('preserves padding it does not need to widen', () => {
    expect(incrementSerial('NRG-0001')).toBe('NRG-0002')
    expect(incrementSerial('NRG-00099')).toBe('NRG-00100')
  })

  it('returns null when there is nothing to advance', () => {
    expect(incrementSerial('NRG-ABC')).toBeNull()
  })
})

describe('serialSequence', () => {
  it('starts at the value given, not one past it', () => {
    // The caller sends the first serial they want printed.
    expect(serialSequence('NRG-001', 5)).toEqual([
      'NRG-001', 'NRG-002', 'NRG-003', 'NRG-004', 'NRG-005'
    ])
  })

  it('returns a single value for a quantity of one', () => {
    expect(serialSequence('NRG-001', 1)).toEqual(['NRG-001'])
  })

  it('returns an empty list for a count of zero', () => {
    expect(serialSequence('NRG-001', 0)).toEqual([])
  })

  it('carries a padding overflow across the sequence', () => {
    expect(serialSequence('NRG-998', 4)).toEqual([
      'NRG-998', 'NRG-999', 'NRG-1000', 'NRG-1001'
    ])
  })

  it('produces no duplicates over a long run', () => {
    const values = serialSequence('SN-0001', 500)!
    expect(values).toHaveLength(500)
    expect(new Set(values).size).toBe(500)
    expect(values[0]).toBe('SN-0001')
    expect(values[499]).toBe('SN-0500')
  })

  it('returns null when the start value has no trailing digits', () => {
    expect(serialSequence('NRG-ABC', 3)).toBeNull()
  })
})
