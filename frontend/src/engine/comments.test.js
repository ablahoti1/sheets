import { describe, it, expect, beforeEach } from 'vitest'
import { createCommentsEngine } from './comments.js'

describe('CommentsEngine', () => {
  let c

  beforeEach(() => { c = createCommentsEngine() })

  it('stores and retrieves a comment', () => {
    c.set('A1', 'hello', 'Sheet1')
    expect(c.get('A1', 'Sheet1')).toBe('hello')
  })

  it('returns null for missing comment', () => {
    expect(c.get('Z99', 'Sheet1')).toBeNull()
  })

  it('hasComment returns true/false correctly', () => {
    c.set('B2', 'note', 'Sheet1')
    expect(c.hasComment('B2', 'Sheet1')).toBe(true)
    expect(c.hasComment('C3', 'Sheet1')).toBe(false)
  })

  it('clear removes a comment', () => {
    c.set('A1', 'x', 'Sheet1')
    c.clear('A1', 'Sheet1')
    expect(c.get('A1', 'Sheet1')).toBeNull()
  })

  it('set with empty string removes comment', () => {
    c.set('A1', 'x', 'Sheet1')
    c.set('A1', '', 'Sheet1')
    expect(c.get('A1', 'Sheet1')).toBeNull()
  })

  it('getAll returns all comments for a sheet', () => {
    c.set('A1', 'a', 'Sheet1')
    c.set('B2', 'b', 'Sheet1')
    expect(Object.keys(c.getAll('Sheet1'))).toHaveLength(2)
  })

  it('insertRow shifts comments down', () => {
    c.set('A2', 'note', 'Sheet1')
    c.insertRow(1, 'Sheet1')
    expect(c.get('A3', 'Sheet1')).toBe('note')
    expect(c.get('A2', 'Sheet1')).toBeNull()
  })

  it('deleteRow removes comment on deleted row and shifts up', () => {
    c.set('A1', 'first', 'Sheet1')
    c.set('A2', 'second', 'Sheet1')
    c.deleteRow(0, 'Sheet1')
    expect(c.get('A1', 'Sheet1')).toBe('second')
    expect(c.get('A2', 'Sheet1')).toBeNull()
  })

  it('snapshot and restore round-trips', () => {
    c.set('A1', 'test', 'Sheet1')
    const snap = c.snapshot()
    const c2 = createCommentsEngine()
    c2.restore(snap)
    expect(c2.get('A1', 'Sheet1')).toBe('test')
  })
})
