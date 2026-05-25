// Perf-budget smoke tests.
//
// Goal: catch O(n²) regressions in hot paths, not benchmark them. We set
// generous time budgets — CI runners vary wildly — but tight enough that an
// accidental quadratic blow-up still trips. If a budget here starts flaking,
// don't widen it without first confirming the change is actually a perf
// regression (use git bisect on the failing test).
//
// Why budgets, not benchmarks: benchmarks need a controlled environment;
// these tests run on whatever GitHub Actions gives us. We measure
// "completes within N ms" rather than absolute throughput.

import { describe, it, expect } from 'vitest'
import { createSheet }                    from './sheet.js'
import { createCondFormatEngine }          from './cond-format.js'
import { detectPattern, applyPattern }     from './smart-fill.js'
import { cellId }                          from '../utils/cells.js'

// Generous budgets. The actual numbers on a 2024 MacBook are ~5–20% of these,
// so even a 3–5× slowdown on a CI runner still has plenty of headroom; only
// algorithmic regressions (O(n) → O(n²) etc.) will exceed them.
const BUDGETS = {
  bulkWrite10k:        2000,   // ms
  bulkRead10k:          500,
  formulaChain1000:    1500,
  condFormatStats5k:   1500,
  smartFillDetect100:   500,
}

function timed(fn) {
  const t0 = performance.now()
  fn()
  return performance.now() - t0
}

describe('perf budget: sheet engine', () => {
  it(`writes 10k cells under ${BUDGETS.bulkWrite10k}ms`, () => {
    const sheet = createSheet()
    const ms = timed(() => {
      for (let r = 0; r < 100; r++) {
        for (let c = 0; c < 100; c++) {
          sheet.setCell(cellId(r, c), String(r * 100 + c))
        }
      }
    })
    expect(ms).toBeLessThan(BUDGETS.bulkWrite10k)
  })

  it(`reads 10k cells under ${BUDGETS.bulkRead10k}ms`, () => {
    const sheet = createSheet()
    for (let r = 0; r < 100; r++) {
      for (let c = 0; c < 100; c++) sheet.setCell(cellId(r, c), String(r * 100 + c))
    }
    const ms = timed(() => {
      let sum = 0
      for (let r = 0; r < 100; r++) {
        for (let c = 0; c < 100; c++) {
          sum += Number(sheet.getCell(cellId(r, c))) || 0
        }
      }
      expect(sum).toBeGreaterThan(0)
    })
    expect(ms).toBeLessThan(BUDGETS.bulkRead10k)
  })

  it(`evaluates 1000 independent SUM formulas under ${BUDGETS.formulaChain1000}ms`, () => {
    // 1000 independent =SUM(A1:A100) cells, each over a 100-cell range. A
    // naive recompute-everything-on-read would scale O(n²) here; the lookup
    // path should be linear in the number of formulas read.
    const sheet = createSheet()
    for (let r = 1; r <= 100; r++) sheet.setCell(`A${r}`, String(r))
    for (let r = 1; r <= 1000; r++) sheet.setCell(`B${r}`, '=SUM(A1:A100)')
    const ms = timed(() => {
      for (let r = 1; r <= 1000; r++) {
        expect(sheet.getCellValue(`B${r}`)).toBe(5050)
      }
    })
    expect(ms).toBeLessThan(BUDGETS.formulaChain1000)
  })
})

describe('perf budget: conditional formatting', () => {
  it(`computes range stats over 5k cells under ${BUDGETS.condFormatStats5k}ms`, () => {
    const sheet = createSheet()
    for (let r = 0; r < 50; r++) {
      for (let c = 0; c < 100; c++) sheet.setCell(cellId(r, c), String(r * 100 + c))
    }
    const cf = createCondFormatEngine()
    cf.addRule({
      range: { r0: 0, c0: 0, r1: 49, c1: 99 },
      kind:  'color-scale',
      scale: { variant: '2color', minColor: '#ffffff', maxColor: '#0E7490' },
    }, 'Sheet1')

    // First call pays the O(n) range scan; subsequent calls hit the cache.
    // We measure the whole grid's worth of lookups — if the cache regressed
    // to per-cell scans, this would blow the budget.
    const ms = timed(() => {
      for (let r = 0; r < 50; r++) {
        for (let c = 0; c < 100; c++) {
          cf.getFormatOverride(cellId(r, c), sheet.getCell(cellId(r, c)), 'Sheet1',
            id => sheet.getCell(id))
        }
      }
    })
    expect(ms).toBeLessThan(BUDGETS.condFormatStats5k)
  })
})

describe('perf budget: smart fill', () => {
  it(`detects + applies a pattern over 100 examples under ${BUDGETS.smartFillDetect100}ms`, () => {
    // 100 examples: take the local part of an email. Exact-match detector,
    // so target casing must match source casing.
    const examples = []
    for (let i = 0; i < 100; i++) {
      examples.push({
        target:  `User${i}`,
        sources: [`User${i}@example.com`],
      })
    }
    let pattern, applied
    const ms = timed(() => {
      pattern = detectPattern(examples)
      applied = applyPattern(pattern, [`User999@example.com`])
    })
    expect(pattern).toBeTruthy()
    expect(applied).toBe('User999')
    expect(ms).toBeLessThan(BUDGETS.smartFillDetect100)
  })
})
