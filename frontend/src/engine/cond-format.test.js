import { describe, it, expect, beforeEach } from 'vitest'
import { createCondFormatEngine } from './cond-format.js'

describe('CondFormatEngine', () => {
  let cf

  beforeEach(() => { cf = createCondFormatEngine() })

  const rule = (condition, format = { backgroundColor: '#ff0' }) => ({
    range: { r0: 0, c0: 0, r1: 2, c1: 2 },
    condition,
    format,
  })

  it('addRule and getRules work', () => {
    cf.addRule(rule({ type: 'gt', value: '5' }), 'Sheet1')
    expect(cf.getRules('Sheet1')).toHaveLength(1)
  })

  it('removeRule removes by id', () => {
    const id = cf.addRule(rule({ type: 'gt', value: '5' }), 'Sheet1')
    cf.removeRule(id, 'Sheet1')
    expect(cf.getRules('Sheet1')).toHaveLength(0)
  })

  it('getFormatOverride returns format when condition matches — gt', () => {
    cf.addRule(rule({ type: 'gt', value: '5' }, { backgroundColor: '#f00' }), 'Sheet1')
    const fmt = cf.getFormatOverride('A1', '10', 'Sheet1')
    expect(fmt?.backgroundColor).toBe('#f00')
  })

  it('getFormatOverride returns null when condition does not match', () => {
    cf.addRule(rule({ type: 'gt', value: '5' }), 'Sheet1')
    expect(cf.getFormatOverride('A1', '3', 'Sheet1')).toBeNull()
  })

  it('conditions: lt, lte, gte, eq, neq', () => {
    const cases = [
      ['lt',  '3', '5', true],
      ['lt',  '7', '5', false],
      ['gte', '5', '5', true],
      ['eq',  '5', '5', true],
      ['neq', '3', '5', true],
      ['neq', '5', '5', false],
    ]
    for (const [type, rawVal, value, expected] of cases) {
      const c = createCondFormatEngine()
      c.addRule(rule({ type, value }), 'Sheet1')
      const r = c.getFormatOverride('A1', rawVal, 'Sheet1')
      expect(r !== null).toBe(expected)
    }
  })

  it('condition: between', () => {
    cf.addRule(rule({ type: 'between', value: '3', value2: '7' }), 'Sheet1')
    expect(cf.getFormatOverride('A1', '5', 'Sheet1')).not.toBeNull()
    expect(cf.getFormatOverride('A1', '2', 'Sheet1')).toBeNull()
  })

  it('condition: contains', () => {
    cf.addRule(rule({ type: 'contains', value: 'foo' }), 'Sheet1')
    expect(cf.getFormatOverride('A1', 'foobar', 'Sheet1')).not.toBeNull()
    expect(cf.getFormatOverride('A1', 'bar', 'Sheet1')).toBeNull()
  })

  it('condition: empty / notempty', () => {
    cf.addRule(rule({ type: 'empty' }), 'Sheet1')
    expect(cf.getFormatOverride('A1', '', 'Sheet1')).not.toBeNull()
    expect(cf.getFormatOverride('A1', 'x', 'Sheet1')).toBeNull()
  })

  it('ignores cells outside rule range', () => {
    cf.addRule(rule({ type: 'gt', value: '0' }), 'Sheet1')
    expect(cf.getFormatOverride('Z99', '999', 'Sheet1')).toBeNull()
  })

  it('first matching rule wins', () => {
    cf.addRule(rule({ type: 'gt', value: '0' }, { backgroundColor: '#first' }), 'Sheet1')
    cf.addRule(rule({ type: 'gt', value: '0' }, { backgroundColor: '#second' }), 'Sheet1')
    expect(cf.getFormatOverride('A1', '1', 'Sheet1')?.backgroundColor).toBe('#first')
  })

  it('snapshot and restore round-trips', () => {
    cf.addRule(rule({ type: 'eq', value: '1' }, { backgroundColor: '#abc' }), 'Sheet1')
    const snap = cf.snapshot()
    const cf2 = createCondFormatEngine()
    cf2.restore(snap)
    expect(cf2.getRules('Sheet1')).toHaveLength(1)
    expect(cf2.getFormatOverride('A1', '1', 'Sheet1')?.backgroundColor).toBe('#abc')
  })

  it('insertRow shifts rule ranges', () => {
    cf.addRule({ range: { r0: 2, c0: 0, r1: 4, c1: 2 }, condition: { type: 'gt', value: '0' }, format: {} }, 'Sheet1')
    cf.insertRow(2, 'Sheet1')
    expect(cf.getRules('Sheet1')[0].range.r0).toBe(3)
  })

  it('addRulesForRange clones overlapping rules to destination', () => {
    cf.addRule({ range: { r0: 0, c0: 0, r1: 2, c1: 2 }, condition: { type: 'gt', value: '5' }, format: { backgroundColor: '#f00' } }, 'Sheet1')
    cf.addRulesForRange({ r0: 0, c0: 0, r1: 2, c1: 2 }, { r0: 5, c0: 5, r1: 7, c1: 7 }, 'Sheet1')
    const rules = cf.getRules('Sheet1')
    expect(rules).toHaveLength(2)
    const cloned = rules[1]
    expect(cloned.range).toEqual({ r0: 5, c0: 5, r1: 7, c1: 7 })
    expect(cloned.format.backgroundColor).toBe('#f00')
  })

  it('addRulesForRange ignores non-overlapping rules', () => {
    cf.addRule({ range: { r0: 10, c0: 10, r1: 12, c1: 12 }, condition: { type: 'gt', value: '0' }, format: {} }, 'Sheet1')
    cf.addRulesForRange({ r0: 0, c0: 0, r1: 2, c1: 2 }, { r0: 5, c0: 5, r1: 7, c1: 7 }, 'Sheet1')
    expect(cf.getRules('Sheet1')).toHaveLength(1)
  })

  it('extendRulesToRange expands an overlapping rule to cover the new total', () => {
    cf.addRule({ range: { r0: 0, c0: 0, r1: 2, c1: 0 }, condition: { type: 'gt', value: '0' }, format: {} }, 'Sheet1')
    cf.extendRulesToRange({ r0: 0, c0: 0, r1: 2, c1: 0 }, { r0: 0, c0: 0, r1: 5, c1: 0 }, 'Sheet1')
    expect(cf.getRules('Sheet1')[0].range.r1).toBe(5)
  })

  it('extendRulesToRange ignores non-overlapping rules', () => {
    cf.addRule({ range: { r0: 10, c0: 10, r1: 12, c1: 12 }, condition: { type: 'gt', value: '0' }, format: {} }, 'Sheet1')
    cf.extendRulesToRange({ r0: 0, c0: 0, r1: 2, c1: 0 }, { r0: 0, c0: 0, r1: 5, c1: 0 }, 'Sheet1')
    expect(cf.getRules('Sheet1')[0].range.r1).toBe(12)
  })
})
