// usePersistence retry semantics — the load-bearing contract that
// covers the "single network blip dropping the save permanently" bug
// we just shipped a fix for. Anything that touches _persist, the
// transient/permanent classifier, or saveError lifecycle should
// stay green here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// `usePersistence` calls into `./utils/api.js` and `./utils/compress.js`
// via relative imports — mock them at the module path the composable
// imports them from. Vitest's vi.mock is hoisted, so this works even
// though the import statement appears below.
vi.mock('../../utils/api.js', () => ({
  call: vi.fn(),
}))
vi.mock('../../utils/compress.js', () => ({
  encodeForUpload: vi.fn(async (s) => s),
}))

import { call } from '../../utils/api.js'
import { usePersistence } from './usePersistence.js'

// Minimal engine doubles — just enough surface that usePersistence
// can snapshot through them without crashing. The save body itself
// is the thing under test; engine fidelity isn't.
const stubEngine = (name) => ({
  snapshot: () => ({ _: name }),
  restore:  () => {},
})
const _ref = (v) => ({ value: v })

function setup() {
  // The save path packs the sheet straight from live cell data
  // (getAllRaw + getCurrentSheet) instead of snapshot()'s deepClone.
  const sheet      = { ...stubEngine('sheet'), getAllRaw: () => ({ Sheet1: {} }), getCurrentSheet: () => 'Sheet1' }
  const formats    = stubEngine('formats')
  const merge      = stubEngine('merge')
  const comments   = stubEngine('comments')
  const validation = stubEngine('validation')
  const condFormat = stubEngine('condFormat')
  const sortFilter = stubEngine('sortFilter')
  const pivot      = stubEngine('pivot')
  const charts     = stubEngine('charts')
  const namedRanges = stubEngine('namedRanges')
  const currentTitle = _ref('Untitled')
  const p = usePersistence({
    sheet, formats, merge, comments, validation, condFormat,
    sortFilter, pivot, charts, namedRanges,
    getViewState:   () => null,
    applyViewState: () => {},
    currentTitle,
    emit: () => {},
  })
  return { ...p, currentTitle }
}

// Fast retries — backoffMs is hardcoded in _persist to [0, 1000, 2500],
// so the 3-retry path takes ~3.5 s of wall time. Use vitest fake timers
// to fast-forward through it.
beforeEach(() => {
  vi.useFakeTimers()
  call.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('usePersistence._persist (saveExisting)', () => {
  it('returns the saved doc name on a clean first attempt', async () => {
    call.mockResolvedValueOnce({ name: 'sheet-001', head_seq: 5 })
    const { saveExisting, saveError } = setup()
    const out = await saveExisting('sheet-001', 'My Sheet')
    expect(out).toBe('sheet-001')
    expect(call).toHaveBeenCalledTimes(1)
    expect(saveError.value).toBe('')
  })

  it('retries a transient network error and succeeds on the second try', async () => {
    // First attempt: no status → network error → transient
    const netErr = Object.assign(new Error('Failed to fetch'), { status: undefined })
    call.mockRejectedValueOnce(netErr)
    call.mockResolvedValueOnce({ name: 'sheet-001' })

    const { saveExisting, saveError } = setup()
    const promise = saveExisting('sheet-001', 'x')
    // First attempt runs synchronously through the await; second attempt
    // is gated by setTimeout(1000) — advance timers to release it.
    await vi.advanceTimersByTimeAsync(1100)
    const out = await promise

    expect(out).toBe('sheet-001')
    expect(call).toHaveBeenCalledTimes(2)
    expect(saveError.value).toBe('')
  })

  it('retries 5xx as transient and gives up after the configured attempts', async () => {
    const serverErr = Object.assign(new Error('boom'), { status: 503 })
    call.mockRejectedValue(serverErr)

    const { saveExisting, saveError } = setup()
    const promise = saveExisting('sheet-001', 'x')
    // Drain the full backoff schedule (0 + 1000 + 2500 ≈ 3500 ms).
    await vi.advanceTimersByTimeAsync(4000)
    const out = await promise

    expect(out).toBeNull()
    expect(call).toHaveBeenCalledTimes(3)   // initial + 2 retries
    expect(saveError.value).toMatch(/boom/)
  })

  it('treats 4xx as permanent and fails fast (no retries)', async () => {
    const permErr = Object.assign(new Error('Not permitted'), {
      status: 403, excType: 'PermissionError',
    })
    call.mockRejectedValue(permErr)

    const { saveExisting, saveError } = setup()
    const promise = saveExisting('sheet-001', 'x')
    await vi.advanceTimersByTimeAsync(4000)
    const out = await promise

    expect(out).toBeNull()
    expect(call).toHaveBeenCalledTimes(1)   // no retries
    expect(saveError.value).toMatch(/Not permitted/)
  })

  it('retries 429 (rate-limited) as transient', async () => {
    const rate = Object.assign(new Error('slow down'), { status: 429 })
    call.mockRejectedValueOnce(rate)
    call.mockResolvedValueOnce({ name: 'sheet-001' })

    const { saveExisting } = setup()
    const promise = saveExisting('sheet-001', 'x')
    await vi.advanceTimersByTimeAsync(1100)
    await promise
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('does not retry on keepalive saves (page unmount path)', async () => {
    const netErr = Object.assign(new Error('fetch failed'), { status: undefined })
    call.mockRejectedValue(netErr)

    const { saveExisting } = setup()
    const promise = saveExisting('sheet-001', 'x', { keepalive: true })
    await vi.advanceTimersByTimeAsync(4000)
    await promise
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('a successful save clears a sticky saveError from a prior failure', async () => {
    const permErr = Object.assign(new Error('Validation'), {
      status: 400, excType: 'ValidationError',
    })
    call.mockRejectedValueOnce(permErr)

    const { saveExisting, saveError } = setup()
    await saveExisting('sheet-001', 'x')
    expect(saveError.value).toMatch(/Validation/)

    call.mockResolvedValueOnce({ name: 'sheet-001' })
    await saveExisting('sheet-001', 'x')
    expect(saveError.value).toBe('')
  })
})

describe('usePersistence.retrySave', () => {
  it('replays the most recent failed save args', async () => {
    const netErr = Object.assign(new Error('offline'), { status: undefined })
    call.mockRejectedValue(netErr)

    const { saveExisting, retrySave, saveError } = setup()
    const firstPromise = saveExisting('sheet-001', 'My Title')
    await vi.advanceTimersByTimeAsync(4000)
    await firstPromise
    expect(saveError.value).toMatch(/offline/)
    expect(call).toHaveBeenCalledTimes(3)   // initial attempt: 3 retries

    // Now the network is back. retrySave should re-fire with the same
    // args (sheet-001, My Title) and succeed.
    call.mockResolvedValueOnce({ name: 'sheet-001' })
    const retryPromise = retrySave()
    await vi.advanceTimersByTimeAsync(100)
    const out = await retryPromise

    expect(out).toBe('sheet-001')
    expect(saveError.value).toBe('')
    // Verify retry used the original args
    const lastArgs = call.mock.calls[call.mock.calls.length - 1][1]
    expect(lastArgs.title).toBe('My Title')
    expect(lastArgs.name).toBe('sheet-001')
  })

  it('returns null without calling the API when there is no pending save', async () => {
    const { retrySave } = setup()
    const out = await retrySave()
    expect(out).toBeNull()
    expect(call).not.toHaveBeenCalled()
  })
})
