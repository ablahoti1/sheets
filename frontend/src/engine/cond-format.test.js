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

// ── New rule kinds (color-scale, data-bar, icon-set) ────────────────────────

// Light helper to feed the engine values from an in-memory grid.
function makeGetter(grid) {
  return (id) => grid[id] !== undefined ? grid[id] : ''
}

describe('color-scale rules', () => {
  const grid = { A1: 0, A2: 50, A3: 100 }
  let cf
  beforeEach(() => {
    cf = createCondFormatEngine()
    cf.addRule({
      range: { r0: 0, c0: 0, r1: 2, c1: 0 },
      kind:  'color-scale',
      scale: { variant: '2color', minColor: '#FFFFFF', maxColor: '#000000' },
    })
  })

  it('interpolates white→black at the midpoint', () => {
    const out = cf.getFormatOverride('A2', 50, 'Sheet1', makeGetter(grid))
    expect(out.backgroundColor).toMatch(/^#(7e|7f|80)/)
  })

  it('returns the min colour at the lowest value', () => {
    expect(cf.getFormatOverride('A1', 0, 'Sheet1', makeGetter(grid)).backgroundColor).toBe('#ffffff')
  })

  it('returns the max colour at the highest value', () => {
    expect(cf.getFormatOverride('A3', 100, 'Sheet1', makeGetter(grid)).backgroundColor).toBe('#000000')
  })

  it('returns null when all values are equal (degenerate scale)', () => {
    const flat = { A1: 5, A2: 5, A3: 5 }
    const cf2 = createCondFormatEngine()
    cf2.addRule({
      range: { r0: 0, c0: 0, r1: 2, c1: 0 },
      kind:  'color-scale',
      scale: { variant: '2color', minColor: '#fff', maxColor: '#000' },
    })
    expect(cf2.getFormatOverride('A1', 5, 'Sheet1', makeGetter(flat))).toBeNull()
  })

  it('3-color variant routes through mid stop', () => {
    const cf3 = createCondFormatEngine()
    cf3.addRule({
      range: { r0: 0, c0: 0, r1: 2, c1: 0 },
      kind:  'color-scale',
      scale: { variant: '3color', minColor: '#FF0000', midColor: '#FFFF00',
               maxColor: '#00FF00', midPercent: 0.5 },
    })
    const out = cf3.getFormatOverride('A2', 50, 'Sheet1', makeGetter(grid))
    expect(out.backgroundColor.toLowerCase()).toBe('#ffff00')
  })
})

describe('data-bar rules', () => {
  const grid = { A1: 0, A2: 50, A3: 100 }
  let cf
  beforeEach(() => {
    cf = createCondFormatEngine()
    cf.addRule({
      range: { r0: 0, c0: 0, r1: 2, c1: 0 },
      kind:  'data-bar',
      bar:   { color: '#123456' },
    })
  })

  it('returns normalised value + colour', () => {
    const mid = cf.getFormatOverride('A2', 50, 'Sheet1', makeGetter(grid))
    expect(mid.dataBar.value).toBeCloseTo(0.5, 5)
    expect(mid.dataBar.color).toBe('#123456')
  })

  it('clamps to 0 at the min', () => {
    expect(cf.getFormatOverride('A1', 0, 'Sheet1', makeGetter(grid)).dataBar.value).toBe(0)
  })

  it('clamps to 1 at the max', () => {
    expect(cf.getFormatOverride('A3', 100, 'Sheet1', makeGetter(grid)).dataBar.value).toBe(1)
  })

  it('marks negative values via the `negative` flag', () => {
    const grid2 = { A1: -10, A2: 0, A3: 10 }
    const cf2 = createCondFormatEngine()
    cf2.addRule({ range: { r0: 0, c0: 0, r1: 2, c1: 0 }, kind: 'data-bar', bar: { color: '#0E7490' } })
    expect(cf2.getFormatOverride('A1', -10, 'Sheet1', makeGetter(grid2)).dataBar.negative).toBe(true)
    expect(cf2.getFormatOverride('A3',  10, 'Sheet1', makeGetter(grid2)).dataBar.negative).toBe(false)
  })
})

describe('icon-set rules', () => {
  const grid = { A1: 0, A2: 50, A3: 100 }
  let cf
  beforeEach(() => {
    cf = createCondFormatEngine()
    cf.addRule({
      range: { r0: 0, c0: 0, r1: 2, c1: 0 },
      kind:  'icon-set',
      icons: { set: 'arrows3', thresholds: [0.33, 0.66] },
    })
  })

  it('low bucket → red down-arrow', () => {
    const out = cf.getFormatOverride('A1', 0, 'Sheet1', makeGetter(grid))
    expect(out.icon.shape).toBe('arrow-down')
    expect(out.icon.color).toBe('#dc2626')
  })

  it('mid bucket → grey flat-arrow', () => {
    const out = cf.getFormatOverride('A2', 50, 'Sheet1', makeGetter(grid))
    expect(out.icon.shape).toBe('arrow-right')
  })

  it('high bucket → green up-arrow', () => {
    const out = cf.getFormatOverride('A3', 100, 'Sheet1', makeGetter(grid))
    expect(out.icon.shape).toBe('arrow-up')
    expect(out.icon.color).toBe('#16a34a')
  })

  it('alternative sets pick different shapes', () => {
    const traffic = createCondFormatEngine()
    traffic.addRule({ range: { r0: 0, c0: 0, r1: 2, c1: 0 }, kind: 'icon-set',
      icons: { set: 'traffic3', thresholds: [0.33, 0.66] } })
    expect(traffic.getFormatOverride('A1', 0, 'Sheet1', makeGetter(grid)).icon.shape).toBe('circle')

    const circles = createCondFormatEngine()
    circles.addRule({ range: { r0: 0, c0: 0, r1: 2, c1: 0 }, kind: 'icon-set',
      icons: { set: 'circles3', thresholds: [0.33, 0.66] } })
    expect(circles.getFormatOverride('A3', 100, 'Sheet1', makeGetter(grid)).icon.shape).toBe('circle-full')
  })
})

describe('rule composition across kinds', () => {
  it('a colour-scale + an icon-set on the same range merge their keys', () => {
    const grid = { A1: 0, A2: 50, A3: 100 }
    const cf = createCondFormatEngine()
    cf.addRule({
      range: { r0: 0, c0: 0, r1: 2, c1: 0 },
      kind:  'color-scale',
      scale: { variant: '2color', minColor: '#fff', maxColor: '#000' },
    })
    cf.addRule({
      range: { r0: 0, c0: 0, r1: 2, c1: 0 },
      kind:  'icon-set',
      icons: { set: 'arrows3', thresholds: [0.33, 0.66] },
    })
    const out = cf.getFormatOverride('A2', 50, 'Sheet1', makeGetter(grid))
    expect(out.backgroundColor).toBeDefined()
    expect(out.icon).toBeDefined()
  })
})

// Regression: the SheetEditor used to call getFormatOverride(id, val, sheet)
// without the 4th `getCellValue` arg, which silently broke every range-scoped
// kind (color-scale / data-bar / icon-set) because the range-stats scan
// returned count=0 and each formatter bailed at the guard. Pin the contract
// so a future caller that forgets the getter gets caught.
describe('range-scoped kinds require getCellValue', () => {
  const grid = { A1: 0, A2: 50, A3: 100 }
  const cases = [
    ['color-scale', { kind: 'color-scale', scale: { variant: '2color', minColor: '#fff', maxColor: '#000' } }],
    ['data-bar',    { kind: 'data-bar',    bar:   { color: '#0E7490' } }],
    ['icon-set',    { kind: 'icon-set',    icons: { set: 'arrows3', thresholds: [0.33, 0.66] } }],
  ]
  for (const [label, ruleBody] of cases) {
    it(`${label}: returns null without getCellValue, paints with it`, () => {
      const broken = createCondFormatEngine()
      broken.addRule({ range: { r0: 0, c0: 0, r1: 2, c1: 0 }, ...ruleBody })
      expect(broken.getFormatOverride('A2', 50, 'Sheet1')).toBeNull()

      const fixed = createCondFormatEngine()
      fixed.addRule({ range: { r0: 0, c0: 0, r1: 2, c1: 0 }, ...ruleBody })
      expect(fixed.getFormatOverride('A2', 50, 'Sheet1', makeGetter(grid))).not.toBeNull()
    })
  }
})

describe('snapshot / restore handles new kinds', () => {
  it('round-trips a color-scale rule', () => {
    const cf = createCondFormatEngine()
    cf.addRule({
      range: { r0: 0, c0: 0, r1: 5, c1: 0 },
      kind:  'color-scale',
      scale: { variant: '3color', minColor: '#fff', midColor: '#ff0', maxColor: '#000', midPercent: 0.5 },
    })
    const snap = cf.snapshot()
    const cf2 = createCondFormatEngine()
    cf2.restore(snap)
    const rules = cf2.getRules('Sheet1')
    expect(rules).toHaveLength(1)
    expect(rules[0].kind).toBe('color-scale')
    expect(rules[0].scale.variant).toBe('3color')
  })
})
