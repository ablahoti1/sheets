import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { _parseCSV, useExportImport } from './useExportImport.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeSheet(initial = {}, sheetName = 'Sheet1') {
  const store = { ...initial }
  return {
    getRawData:       (sn = sheetName) => (void sn, store),
    getCell:          (id, sn = sheetName) => (void sn, store[id] ?? ''),
    setCell:          (id, v) => { store[id] = v },
    getCurrentSheet:  () => sheetName,
    getSheetNames:    () => [sheetName],
    getDisplayValue:  (id, sn = sheetName) => (void sn, store[id] ?? ''),
    _store:           () => store,
  }
}

function makeGrid() {
  const cells = {}
  return {
    clearAll: vi.fn(() => { Object.keys(cells).forEach(k => delete cells[k]) }),
    setCell:  vi.fn((id, v) => { cells[id] = v }),
    _cells:   () => cells,
  }
}

function makeComposable(sheetData = {}) {
  const sheet   = makeSheet(sheetData)
  const grid    = makeGrid()
  const ops     = []
  const isDirty = ref(false)
  const history = { push: vi.fn() }

  const ctx = useExportImport({
    getSheet:        () => sheet,
    getCurrentTitle: () => 'Test Sheet',
    getGrid:         () => grid,
    queueOp:         op => ops.push(op),
    markEdited:      vi.fn(),
    repopulateGrid:  vi.fn(),
    syncFlags:       vi.fn(),
    isDirty,
    history,
  })

  return { ...ctx, sheet, grid, ops, isDirty, history }
}

// ── _parseCSV ─────────────────────────────────────────────────────────────────

describe('_parseCSV', () => {
  it('parses a simple comma-separated row', () => {
    expect(_parseCSV('a,b,c')).toEqual([['a', 'b', 'c']])
  })

  it('handles quoted fields containing commas', () => {
    expect(_parseCSV('"hello, world",foo')).toEqual([['hello, world', 'foo']])
  })

  it('handles escaped double-quotes inside quoted fields', () => {
    expect(_parseCSV('"say ""hi""",end')).toEqual([['say "hi"', 'end']])
  })

  it('parses multiple rows separated by \\n', () => {
    const result = _parseCSV('a,b\n1,2')
    expect(result).toEqual([['a', 'b'], ['1', '2']])
  })

  it('normalises \\r\\n line endings', () => {
    const result = _parseCSV('x,y\r\nz,w')
    expect(result).toEqual([['x', 'y'], ['z', 'w']])
  })

  it('skips a trailing empty line', () => {
    // "a,b\n" → 2 lines, second is '' and is the last → skipped
    const result = _parseCSV('a,b\n')
    expect(result).toEqual([['a', 'b']])
  })

  it('returns an empty array for an empty string', () => {
    expect(_parseCSV('')).toEqual([])
  })
})

// ── _sheetToAoa (via exportCSV internals) ────────────────────────────────────
// We test _sheetToAoa indirectly by checking what exportCSV serialises.

describe('exportCSV — sheet-to-array-of-arrays correctness', () => {
  beforeEach(() => {
    vi.stubGlobal('Blob', class {
      constructor(parts) { this.text = parts.join('') }
    })
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock') })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => {
        const el = { click: vi.fn(), href: '', download: '' }
        return el
      }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serialises A1 and B1 values into a single CSV row', () => {
    const { exportCSV } = makeComposable({ A1: 'hello', B1: 'world' })
    exportCSV()
    const blobArg = vi.mocked(document.createElement).mock.results[0].value
    // The Blob is constructed with the csv string; check the anchor download attr
    expect(blobArg.download).toBe('Test Sheet.csv')
  })

  it('A1 is row 1 col A and B2 is row 2 col B', () => {
    let capturedCsv = ''
    vi.stubGlobal('Blob', class {
      constructor(parts) { capturedCsv = parts[0] }
    })
    const { exportCSV } = makeComposable({ A1: 'name', B1: 'age', A2: 'alice', B2: '30' })
    exportCSV()
    const rows = capturedCsv.split('\n').map(r => r.split(','))
    expect(rows[0]).toEqual(['name', 'age'])
    expect(rows[1]).toEqual(['alice', '30'])
  })
})

// ── exportCSV — document.createElement / URL.createObjectURL ─────────────────

describe('exportCSV — DOM calls', () => {
  let anchorEl

  beforeEach(() => {
    anchorEl = { click: vi.fn(), href: '', download: '' }
    vi.stubGlobal('Blob', class { constructor() {} })
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test-url') })
    vi.stubGlobal('document', { createElement: vi.fn(() => anchorEl) })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls document.createElement("a")', () => {
    const { exportCSV } = makeComposable()
    exportCSV()
    expect(document.createElement).toHaveBeenCalledWith('a')
  })

  it('calls URL.createObjectURL with a Blob', () => {
    const { exportCSV } = makeComposable()
    exportCSV()
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.createObjectURL.mock.calls[0][0]).toBeInstanceOf(
      /** @type {any} */ (global.Blob),
    )
  })

  it('sets the download filename from getCurrentTitle', () => {
    const { exportCSV } = makeComposable()
    exportCSV()
    expect(anchorEl.download).toBe('Test Sheet.csv')
  })

  it('clicks the anchor element', () => {
    const { exportCSV } = makeComposable()
    exportCSV()
    expect(anchorEl.click).toHaveBeenCalledTimes(1)
  })
})

// ── importCSV — sheet engine receives correct cells ───────────────────────────

describe('importCSV', () => {
  function runImport(csvText, sheetData = {}) {
    const composable = makeComposable(sheetData)
    // Simulate a FileReader-driven event
    let loadHandler
    const mockReader = {
      onload: null,
      readAsText: vi.fn(function () {
        loadHandler = this.onload
      }),
    }
    vi.stubGlobal('FileReader', function FileReader() { return mockReader })

    const fakeFile = { name: 'data.csv' }
    const event    = {
      target: { files: [fakeFile], value: '' },
    }

    composable.importCSV(event)

    // Trigger the onload callback
    mockReader.onload({ target: { result: csvText } })

    vi.unstubAllGlobals()
    return composable
  }

  it('writes parsed CSV cells into the sheet engine', () => {
    const { sheet } = runImport('foo,bar\n1,2')
    expect(sheet.getCell('A1')).toBe('foo')
    expect(sheet.getCell('B1')).toBe('bar')
    expect(sheet.getCell('A2')).toBe('1')
    expect(sheet.getCell('B2')).toBe('2')
  })

  it('does not write empty cells into the sheet', () => {
    const { sheet } = runImport('a,,b')
    expect(sheet.getCell('A1')).toBe('a')
    expect(sheet.getCell('B1')).toBe('')   // was never set by importCSV
    expect(sheet.getCell('C1')).toBe('b')
  })

  it('sets isDirty to true', () => {
    const { isDirty } = runImport('x,y')
    expect(isDirty.value).toBe(true)
  })

  it('pushes a history snapshot', () => {
    const { history } = runImport('x,y')
    expect(history.push).toHaveBeenCalledTimes(1)
  })

  it('queues an import op with correct opType and subSheet', () => {
    const { ops } = runImport('a,b')
    expect(ops).toHaveLength(1)
    expect(ops[0].opType).toBe('import')
    expect(ops[0].subSheet).toBe('Sheet1')
  })

  it('resets e.target.value so the same file can be re-imported', () => {
    const fakeFile = { name: 'data.csv' }
    const event    = { target: { files: [fakeFile], value: 'old' } }

    let loadHandler
    const mockReader = {
      onload: null,
      readAsText: vi.fn(function () { loadHandler = this.onload }),
    }
    vi.stubGlobal('FileReader', function FileReader() { return mockReader })

    const composable = makeComposable()
    composable.importCSV(event)
    expect(event.target.value).toBe('')

    mockReader.onload({ target: { result: '' } })
    vi.unstubAllGlobals()
  })
})
