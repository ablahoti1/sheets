import { describe, it, expect } from 'vitest'
import { computePivot, computePivotModel, pivotDrillDown } from './pivot.js'

// getRangeValues stub — pivot only cares about the 2D array (row 0 = headers).
const ranged = (data) => () => data

describe('computePivot / computePivotModel', () => {
  const data = [
    ['territory', 'name'],
    ['India', 'a'],
    ['India', 'b'],
    ['Africa', 'c'],
  ]
  const config = { sourceSheet: 'S', sourceRange: 'A1:B4', rows: ['territory'], cols: [], values: [{ field: 'name', agg: 'count' }] }

  it('renders a COUNT pivot, rows sorted, with a grand total', () => {
    expect(computePivot(config, ranged(data))).toEqual([
      ['territory', 'COUNT(name)'],
      ['Africa', 1],
      ['India', 2],
      ['Grand Total', 3],
    ])
  })

  it('computePivot is a thin wrapper over the model table', () => {
    const model = computePivotModel(config, ranged(data))
    expect(model.table).toEqual(computePivot(config, ranged(data)))
    expect(model.rowKeyList).toEqual(['Africa', 'India'])
    expect(model.hasColFields).toBe(false)
  })

  it('returns null/[] when there is nothing to pivot', () => {
    expect(computePivotModel({ sourceRange: '', rows: [], cols: [], values: [] }, ranged(data))).toBeNull()
    expect(computePivot({ sourceRange: '', rows: [], cols: [], values: [] }, ranged(data))).toEqual([])
  })
})

describe('pivotDrillDown — no column fields', () => {
  const data = [
    ['territory', 'name'],
    ['India', 'a'],
    ['India', 'b'],
    ['Africa', 'c'],
  ]
  const config = { sourceSheet: 'S', sourceRange: 'A1:B4', rows: ['territory'], cols: [], values: [{ field: 'name', agg: 'count' }] }
  const model = computePivotModel(config, ranged(data))

  it('drills a value cell to its group rows', () => {
    // (1,1) = Africa count
    expect(pivotDrillDown(model, 1, 1)).toEqual({ headers: ['territory', 'name'], rows: [['Africa', 'c']] })
    // (2,1) = India count → both India rows
    expect(pivotDrillDown(model, 2, 1).rows).toEqual([['India', 'a'], ['India', 'b']])
  })

  it('drills a row-label cell to the whole group', () => {
    expect(pivotDrillDown(model, 2, 0).rows).toEqual([['India', 'a'], ['India', 'b']])
  })

  it('drills the grand-total row to every source row', () => {
    expect(pivotDrillDown(model, 3, 1).rows).toHaveLength(3)
  })

  it('returns null for the header row', () => {
    expect(pivotDrillDown(model, 0, 1)).toBeNull()
  })

  it('returns null past the last row', () => {
    expect(pivotDrillDown(model, 99, 1)).toBeNull()
  })
})

describe('pivotDrillDown — with column fields', () => {
  const data = [
    ['region', 'year', 'sales'],
    ['North', '2022', 10],
    ['North', '2023', 20],
    ['South', '2022', 5],
  ]
  const config = { sourceSheet: 'S', sourceRange: 'A1:C4', rows: ['region'], cols: ['year'], values: [{ field: 'sales', agg: 'sum' }] }
  const model = computePivotModel(config, ranged(data))

  it('drills a row × column intersection', () => {
    // header: [region, 2022, 2023, Grand Total]; row 1 = North
    expect(pivotDrillDown(model, 1, 1).rows).toEqual([['North', '2022', 10]])   // North/2022
    expect(pivotDrillDown(model, 1, 2).rows).toEqual([['North', '2023', 20]])   // North/2023
  })

  it('drills a row-total cell to all columns of that row', () => {
    expect(pivotDrillDown(model, 1, 3).rows).toEqual([['North', '2022', 10], ['North', '2023', 20]])
  })

  it('drills the grand total to every row', () => {
    const last = model.table.length - 1
    expect(pivotDrillDown(model, last, 3).rows).toHaveLength(3)
  })
})
