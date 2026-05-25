import { describe, it, expect } from 'vitest'
import { adjustFormula, renameSheetInFormula } from './formula-adjust.js'

describe('adjustFormula', () => {
  it('returns non-formula values unchanged', () => {
    expect(adjustFormula('hello', 1, 1)).toBe('hello')
    expect(adjustFormula(42, 1, 1)).toBe(42)
    expect(adjustFormula(null, 1, 1)).toBe(null)
  })

  it('returns formula unchanged when offset is zero', () => {
    expect(adjustFormula('=SUM(A1:A10)', 0, 0)).toBe('=SUM(A1:A10)')
  })

  it('shifts a single ref by column offset', () => {
    // I15 pasted to B15: dc = B(1) - I(8) = -7, dr = 0
    expect(adjustFormula('=SUM(I2:I14)', 0, -7)).toBe('=SUM(B2:B14)')
  })

  it('shifts a ref by row offset', () => {
    expect(adjustFormula('=A1', 2, 0)).toBe('=A3')
  })

  it('shifts a ref by both row and column offsets', () => {
    expect(adjustFormula('=B2', 1, 2)).toBe('=D3')
  })

  it('leaves absolute column ref unchanged', () => {
    expect(adjustFormula('=$A1', 0, 5)).toBe('=$A1')
  })

  it('leaves absolute row ref unchanged', () => {
    expect(adjustFormula('=A$1', 5, 0)).toBe('=A$1')
  })

  it('leaves fully absolute ref unchanged', () => {
    expect(adjustFormula('=$A$1', 3, 3)).toBe('=$A$1')
  })

  it('handles mixed refs in a range', () => {
    // =SUM($A1:B$10) shifted by dr=1, dc=2 → $A col stays, B→D; row 1→2 (relative), $10 stays
    expect(adjustFormula('=SUM($A1:B$10)', 1, 2)).toBe('=SUM($A2:D$10)')
  })

  it('does not shift ref that would go negative (keeps original)', () => {
    // A1 shifted left 3 cols → col < 0 → keep original token
    expect(adjustFormula('=A1', 0, -3)).toBe('=A1')
  })

  it('handles multi-letter column names', () => {
    // AA = col 26 (0-based), shift +1 → AB
    expect(adjustFormula('=AA5', 0, 1)).toBe('=AB5')
  })

  describe('cross-sheet references', () => {
    it('shifts cell ref inside a cross-sheet range (mixed-case sheet name)', () => {
      expect(adjustFormula('=SUM(Sheet2!A1:Sheet2!B5)', 2, 0)).toBe('=SUM(Sheet2!A3:Sheet2!B7)')
    })

    it('does not corrupt all-uppercase sheet name identifier', () => {
      // SHEET2 followed by ! must not be shifted as a cell ref
      expect(adjustFormula('=SHEET2!A1', 0, 1)).toBe('=SHEET2!B1')
    })

    it('shifts cell ref after uppercase sheet name and digit', () => {
      // Q1!B2 → Q1 followed by ! skipped, B2 shifted
      expect(adjustFormula('=Q1!B2', 1, 1)).toBe('=Q1!C3')
    })

    it('leaves absolute cross-sheet ref unchanged', () => {
      expect(adjustFormula('=Sheet2!$A$1', 3, 3)).toBe('=Sheet2!$A$1')
    })
  })
})

describe('renameSheetInFormula', () => {
  it('rewrites a single cross-sheet ref', () => {
    expect(renameSheetInFormula('=Sheet2!A1', 'Sheet2', 'Data')).toBe('=Data!A1')
  })

  it('rewrites every occurrence in a complex formula', () => {
    expect(renameSheetInFormula('=Sheet2!A1+Sheet2!B2+Other!C3', 'Sheet2', 'X'))
      .toBe('=X!A1+X!B2+Other!C3')
  })

  it('rewrites a cross-sheet range', () => {
    expect(renameSheetInFormula('=SUM(Sheet2!A1:Sheet2!B3)', 'Sheet2', 'X'))
      .toBe('=SUM(X!A1:X!B3)')
  })

  it('does not touch unrelated sheet names', () => {
    expect(renameSheetInFormula('=Sheet22!A1+Sheet2!B1', 'Sheet2', 'X'))
      .toBe('=Sheet22!A1+X!B1')
  })

  it('handles quoted names with spaces', () => {
    expect(renameSheetInFormula("='Old Sheet'!A1", 'Old Sheet', 'New One'))
      .toBe("='New One'!A1")
  })

  it('upgrades unquoted → quoted when the new name needs it', () => {
    expect(renameSheetInFormula('=Old!A1', 'Old', 'New Sheet'))
      .toBe("='New Sheet'!A1")
  })

  it('no-op when names match', () => {
    expect(renameSheetInFormula('=Sheet2!A1', 'Sheet2', 'Sheet2')).toBe('=Sheet2!A1')
  })

  it('no-op on non-formula strings', () => {
    expect(renameSheetInFormula('Sheet2!A1', 'Sheet2', 'X')).toBe('Sheet2!A1')
  })
})
