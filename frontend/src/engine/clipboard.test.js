import { describe, it, expect, beforeEach } from 'vitest'
import { createClipboard } from './clipboard.js'

function makeSheet(initial = {}) {
  const store = { ...initial }
  return {
    getRawData:     () => store,
    getCell:        id => store[id] ?? '',
    setCell:        (id, v) => { store[id] = v },
    getCurrentSheet: () => 'Sheet1',
    getDisplayValue: id => store[id] ?? '',
    _store: () => store,
  }
}

describe('clipboard — destination-aware paste', () => {
  let sheet, cb
  beforeEach(() => {
    sheet = makeSheet({ A1: 'X' })
    cb = createClipboard({ sheet })
  })

  it('1×1 source pasted into a multi-cell selection fills every dest cell', () => {
    cb.copy({ r0: 0, c0: 0, r1: 0, c1: 0 })
    cb.paste('B1', null, 'all', { r0: 0, c0: 1, r1: 0, c1: 3 })       // B1:D1
    expect(sheet.getCell('B1')).toBe('X')
    expect(sheet.getCell('C1')).toBe('X')
    expect(sheet.getCell('D1')).toBe('X')
  })

  it('1×1 source into a multi-row + multi-col selection tiles fully', () => {
    cb.copy({ r0: 0, c0: 0, r1: 0, c1: 0 })
    cb.paste('B2', null, 'all', { r0: 1, c0: 1, r1: 2, c1: 2 })       // B2:C3
    expect(sheet.getCell('B2')).toBe('X')
    expect(sheet.getCell('C2')).toBe('X')
    expect(sheet.getCell('B3')).toBe('X')
    expect(sheet.getCell('C3')).toBe('X')
  })

  it('multi-cell source tiles into a destination that is an integer multiple', () => {
    sheet = makeSheet({ A1: '1', B1: '2' })
    cb = createClipboard({ sheet })
    cb.copy({ r0: 0, c0: 0, r1: 0, c1: 1 })                            // A1:B1 = [1, 2]
    cb.paste('A2', null, 'all', { r0: 1, c0: 0, r1: 1, c1: 3 })        // A2:D2
    expect(sheet.getCell('A2')).toBe('1')
    expect(sheet.getCell('B2')).toBe('2')
    expect(sheet.getCell('C2')).toBe('1')
    expect(sheet.getCell('D2')).toBe('2')
  })

  it('non-tileable destination falls back to anchor paste', () => {
    sheet = makeSheet({ A1: '1', B1: '2' })
    cb = createClipboard({ sheet })
    cb.copy({ r0: 0, c0: 0, r1: 0, c1: 1 })                            // 2 cols
    cb.paste('A2', null, 'all', { r0: 1, c0: 0, r1: 1, c1: 2 })        // 3 cols → not divisible
    expect(sheet.getCell('A2')).toBe('1')
    expect(sheet.getCell('B2')).toBe('2')
    expect(sheet.getCell('C2')).toBe('')                                // untouched
  })

  it('single-cell destination behaves the same as no destSel', () => {
    cb.copy({ r0: 0, c0: 0, r1: 0, c1: 0 })
    cb.paste('B1', null, 'all', { r0: 0, c0: 1, r1: 0, c1: 1 })
    expect(sheet.getCell('B1')).toBe('X')
    expect(sheet.getCell('C1')).toBe('')
  })

  it('pasteFromText tiles a single token across a multi-cell destination', () => {
    cb.pasteFromText('hello', 'B1', null, { r0: 0, c0: 1, r1: 0, c1: 3 })
    expect(sheet.getCell('B1')).toBe('hello')
    expect(sheet.getCell('C1')).toBe('hello')
    expect(sheet.getCell('D1')).toBe('hello')
  })

  it('pasteFromText with a single token but single-cell dest writes one cell', () => {
    cb.pasteFromText('hi', 'B1', null, { r0: 0, c0: 1, r1: 0, c1: 1 })
    expect(sheet.getCell('B1')).toBe('hi')
    expect(sheet.getCell('C1')).toBe('')
  })
})
