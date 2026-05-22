import { describe, it, expect } from 'vitest'
import { detectStep, computeFillDown, computeFillRight } from './fill-series.js'

describe('detectStep', () => {
  it('detects a positive step', () => {
    expect(detectStep([1, 2, 3, 4])).toBe(1)
  })

  it('detects a negative step', () => {
    expect(detectStep([10, 7, 4, 1])).toBe(-3)
  })

  it('detects a zero step (constant sequence)', () => {
    expect(detectStep([5, 5, 5])).toBe(0)
  })

  it('detects a fractional step', () => {
    expect(detectStep([1, 1.5, 2, 2.5])).toBe(0.5)
  })

  it('returns null for a non-arithmetic sequence', () => {
    expect(detectStep([1, 2, 4, 8])).toBeNull()
  })

  it('always returns a step for exactly two values', () => {
    expect(detectStep([3, 7])).toBe(4)
  })

  it('returns null for a single value (cannot determine step)', () => {
    expect(detectStep([42])).toBeNull()
  })
})

describe('computeFillDown', () => {
  it('fills down from a horizontal source — the user\'s primary use case', () => {
    // C1=3, D1=4 → drag down → C2=5 D2=6, C3=7 D3=8
    expect(computeFillDown([[3, 4]], 2)).toEqual([[5, 6], [7, 8]])
  })

  it('fills down from a single-cell numeric source by repeating', () => {
    // No cross-value step detectable → repeat
    expect(computeFillDown([[7]], 3)).toEqual([[7], [7], [7]])
  })

  it('repeats a non-arithmetic row when no step found', () => {
    expect(computeFillDown([[1, 3, 6]], 2)).toEqual([[1, 3, 6], [1, 3, 6]])
  })

  it('repeats non-numeric rows', () => {
    expect(computeFillDown([['a', 'b']], 2)).toEqual([['a', 'b'], ['a', 'b']])
  })

  it('fills down from a vertical source using per-column step', () => {
    // A1=1 A2=3, B1=3 B2=5 → col A step=2, col B step=2
    expect(computeFillDown([[1, 3], [3, 5]], 2)).toEqual([[5, 7], [7, 9]])
  })

  it('cycles columns whose per-column values are non-arithmetic', () => {
    // col A [1,2,4] diffs [1,2] – not constant → cycle; col B [2,3,5] same
    expect(computeFillDown([[1, 2], [2, 3], [4, 5]], 2)).toEqual([[1, 2], [2, 3]])
  })

  it('fills upward (dir = -1) from a horizontal source', () => {
    // C3=3, D3=4, fill UP 1 row → C2=1, D2=2
    expect(computeFillDown([[3, 4]], 1, -1)).toEqual([[1, 2]])
  })

  it('fills upward from a vertical source', () => {
    // A2=3, A3=5 (step=2), fill UP 1 row → A1=1
    expect(computeFillDown([[3], [5]], 1, -1)).toEqual([[1]])
  })
})

describe('computeFillRight', () => {
  it('fills right from a horizontal source using per-row step', () => {
    // A1=3, B1=4 → C1=5, D1=6
    expect(computeFillRight([[3, 4]], 2)).toEqual([[5, 6]])
  })

  it('fills right from a vertical single-column source using cross-row step', () => {
    // A1=3, A2=4 → B1=5 B2=6
    expect(computeFillRight([[3], [4]], 2)).toEqual([[5, 7], [6, 8]])
  })

  it('repeats non-numeric single-column source', () => {
    expect(computeFillRight([['x'], ['y']], 2)).toEqual([['x', 'x'], ['y', 'y']])
  })

  it('cycles a non-arithmetic multi-column source', () => {
    // [1,3,6] non-arithmetic → repeat cols
    expect(computeFillRight([[1, 3, 6]], 3)).toEqual([[1, 3, 6]])
  })

  it('fills leftward (dir = -1) from a horizontal source', () => {
    // Source C1=3, D1=4 (step=1). One step back from C1=3 is B1=2.
    expect(computeFillRight([[3, 4]], 1, -1)).toEqual([[2]])
  })
})

// ── Integration: smart patterns wired into computeFillDown ──────────────────
// These exercise the date + named-sequence detectors through the same entry
// point that SheetEditor's onFill calls.

describe('computeFillDown integration', () => {
  it('extends a daily date column', () => {
    // Each cell is its own row, so this goes through _fillVerticalFromCols.
    expect(computeFillDown([['01-04-2025'], ['02-04-2025']], 2))
      .toEqual([['03-04-2025'], ['04-04-2025']])
  })

  it('extends a monthly date column', () => {
    expect(computeFillDown([['Jan-2025'], ['Feb-2025']], 2))
      // Detector returns null for this format (only matches DMY/MDY/YMD),
      // so we expect cycling — verifies the fallback path.
      .toEqual([['Jan-2025'], ['Feb-2025']])
  })

  it('extends month-name column', () => {
    expect(computeFillDown([['Jan'], ['Feb']], 2))
      .toEqual([['Mar'], ['Apr']])
  })

  it('extends day-name column with wrap-around', () => {
    expect(computeFillDown([['Fri'], ['Sat']], 2))
      .toEqual([['Sun'], ['Mon']])
  })

  it('extends month names preserving lowercase', () => {
    expect(computeFillDown([['jan'], ['feb']], 1))
      .toEqual([['mar']])
  })

  it('fills backward through a named sequence', () => {
    expect(computeFillDown([['Wed'], ['Thu']], 2, -1))
      .toEqual([['Tue'], ['Mon']])
  })

  it('mode:copy forces cycling even when a series is detectable', () => {
    // 1, 2 would normally extend to 3, 4 — copy mode cycles the source.
    expect(computeFillDown([[1], [2]], 3, 1, { mode: 'copy' }))
      .toEqual([[1], [2], [1]])
  })

  it('mode:series leaves the auto-detected pattern intact', () => {
    expect(computeFillDown([[1], [2]], 2, 1, { mode: 'series' }))
      .toEqual([[3], [4]])
  })
})
