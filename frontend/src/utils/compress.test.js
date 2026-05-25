import { describe, it, expect } from 'vitest'
import { encodeForUpload, isCompressionSupported } from './compress.js'

// Round-trip helper that mirrors what the server does via storage.py.
async function decode(envelopeJson) {
  const env = JSON.parse(envelopeJson)
  if (env._z !== 'gzip') return envelopeJson
  const bytes  = Uint8Array.from(atob(env.data), c => c.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}

describe('encodeForUpload', () => {
  it('returns the input unchanged when the payload is small', async () => {
    const tiny = JSON.stringify({ A1: 'hello' })
    expect(await encodeForUpload(tiny)).toBe(tiny)
  })

  it('wraps large payloads in the gzip envelope', async () => {
    const big = JSON.stringify({ cells: 'X'.repeat(200_000) })
    const out = await encodeForUpload(big)
    expect(out).not.toBe(big)
    const env = JSON.parse(out)
    expect(env._z).toBe('gzip')
    expect(typeof env.data).toBe('string')
  })

  it('round-trips a large payload back to identical bytes', async () => {
    const cells = {}
    for (let i = 0; i < 2000; i++) cells[`A${i}`] = 'X'.repeat(100)
    const big = JSON.stringify(cells)
    const out = await encodeForUpload(big)
    expect(await decode(out)).toBe(big)
  })

  it('preserves unicode through the envelope', async () => {
    const original = JSON.stringify({ A1: 'héllo 🌍 寿司'.repeat(5000) })
    const out      = await encodeForUpload(original)
    expect(await decode(out)).toBe(original)
  })

  it('shrinks repetitive payloads by at least 5×', async () => {
    const big = JSON.stringify({ cells: 'X'.repeat(500_000) })
    const out = await encodeForUpload(big)
    expect(out.length).toBeLessThan(big.length / 5)
  })

  it('passes through empty / falsy inputs', async () => {
    expect(await encodeForUpload('')).toBe('')
    expect(await encodeForUpload(null)).toBe(null)
  })
})

describe('isCompressionSupported', () => {
  it('reports CompressionStream availability', () => {
    expect(isCompressionSupported()).toBe(typeof CompressionStream !== 'undefined')
  })
})
