import { describe, expect, it } from 'vitest'
import { amountAt, buildSeries, maxDiscount, pointRows, rankAt, rateAt, unionKm } from '../src/lib/normalize'
import type { Band, DiscountTable, Insurer } from '../src/lib/types'

const band = (min: number, max: number, rate: number, maxInc: boolean | null = true): Band => ({
  distance_min_km: min,
  min_inclusive: min === 0 ? true : maxInc === null ? null : !maxInc,
  distance_max_km: max,
  max_inclusive: maxInc,
  discount_rate_percent: rate,
  label: `${min}~${max}`,
  source_id: 's1',
})

const table = (id: string, bands: Band[]): DiscountTable => ({
  insurer: id,
  insurer_id: id,
  channel: 'direct',
  vehicle_type: '개인용 승용차',
  valid_from: '2026-01-01',
  valid_to: null,
  discount_method: '후할인',
  verified_at: '2026-10-25',
  bands,
})

const insurer = (id: string, bands: Band[] | null): Insurer => ({
  id,
  name: id,
  status: bands ? 'verified' : 'unverified',
  odometer_photo: '',
  notes: [],
  sources: [],
  primary: bands ? table(id, bands) : null,
  others: [],
})

// "이하" 상한 규칙: (0,2000] 45%, (2000,4000] 38%, (4000,6000] 30%
const A = insurer('A', [band(0, 2000, 45), band(2000, 4000, 38), band(4000, 6000, 30)])
// "미만" 상한 규칙: [0,3000) 40%, [3000,5000) 20%
const B = insurer('B', [band(0, 3000, 40, false), band(3000, 5000, 20, false)])
const U = insurer('U', null)

describe('unionKm', () => {
  it('merges every band boundary, dedupes and sorts ascending', () => {
    expect(unionKm([A, B, U])).toEqual([0, 2000, 3000, 4000, 5000, 6000])
  })
})

describe('rateAt', () => {
  it('applies the band that contains the distance', () => {
    expect(rateAt(A, 2500)).toMatchObject({ rate: 38, reason: 'ok', kind: 'in_band' })
  })

  it('respects "이하" upper bound at the boundary', () => {
    expect(rateAt(A, 2000)).toMatchObject({ rate: 45, kind: 'boundary' })
  })

  it('respects "미만" upper bound at the boundary', () => {
    expect(rateAt(B, 3000)).toMatchObject({ rate: 20, kind: 'boundary' })
  })

  it('returns null (not 0) beyond the max discount distance', () => {
    expect(rateAt(A, 6001)).toMatchObject({ rate: null, reason: 'beyond_max' })
    expect(rateAt(B, 5000)).toMatchObject({ rate: null, reason: 'beyond_max' })
  })

  it('returns null for insurers without a verified table', () => {
    expect(rateAt(U, 1000)).toMatchObject({ rate: null, reason: 'unverified' })
  })

  it('flags unclear boundaries instead of guessing', () => {
    const C = insurer('C', [band(0, 1000, 30, null), band(1000, 2000, 20, null)])
    const r = rateAt(C, 1000)
    expect(r.rate).toBeNull()
    expect(r.reason).toBe('boundary_unclear')
    expect(r.candidates).toEqual([30, 20])
    expect(rateAt(C, 500)).toMatchObject({ rate: 30, reason: 'ok' })
  })

  it('returns null when a distance falls in a gap between bands', () => {
    const D = insurer('D', [band(0, 1000, 30), band(2000, 3000, 10)])
    expect(rateAt(D, 1500)).toMatchObject({ rate: null, reason: 'not_covered' })
  })
})

describe('rankAt', () => {
  it('sorts by rate desc and puts null rates last', () => {
    expect(rankAt([U, B, A], 2500).map((r) => r.insurer.id)).toEqual(['B', 'A', 'U'])
  })
})

describe('maxDiscount', () => {
  it('returns the highest rate and its band', () => {
    expect(maxDiscount(A)).toMatchObject({ rate: 45, band: { distance_max_km: 2000 } })
    expect(maxDiscount(U)).toBeNull()
  })
})

describe('buildSeries', () => {
  it('draws flat segments per band with vertical steps, never interpolating', () => {
    const pts = buildSeries(A)
    expect(pts.map((p) => [p.x, p.y])).toEqual([
      [0, 45], [2000, 45],
      [2000, 38], [4000, 38],
      [4000, 30], [6000, 30],
    ])
  })

  it('breaks the line (null) across gaps between bands', () => {
    const D = insurer('D', [band(0, 1000, 30), band(2000, 3000, 10)])
    expect(buildSeries(D).map((p) => [p.x, p.y])).toEqual([
      [0, 30], [1000, 30], [1000, null],
      [2000, 10], [3000, 10],
    ])
  })

  it('is empty for unverified insurers', () => {
    expect(buildSeries(U)).toEqual([])
  })

  it('agrees with rateAt at every band midpoint', () => {
    for (const ins of [A, B]) {
      const pts = buildSeries(ins)
      for (let i = 0; i + 1 < pts.length; i++) {
        const [p, q] = [pts[i], pts[i + 1]]
        if (p.y === null || q.y === null || p.x === q.x) continue
        expect(rateAt(ins, (p.x + q.x) / 2).rate).toBe(p.y)
      }
    }
  })
})

describe('amountAt', () => {
  it('rounds the discount to the won like the Excel ROUND formula', () => {
    expect(amountAt(1_000_000, rateAt(A, 2500))).toEqual({ discount: 380_000, after: 620_000 })
    expect(amountAt(745_000, rateAt(A, 2500))).toEqual({ discount: 283_100, after: 461_900 })
    expect(amountAt(1_234_567, rateAt(A, 5000))).toEqual({ discount: 370_370, after: 864_197 })
  })

  it('gives zero discount beyond the max distance (no discount is a confirmed fact)', () => {
    expect(amountAt(1_000_000, rateAt(A, 7000))).toEqual({ discount: 0, after: 1_000_000 })
  })

  it('returns null amounts when the rate is unknown, never 0', () => {
    expect(amountAt(1_000_000, rateAt(U, 1000))).toBeNull()
    const C = insurer('C', [band(0, 1000, 30, null), band(1000, 2000, 20, null)])
    expect(amountAt(1_000_000, rateAt(C, 1000))).toBeNull()
  })

  it('returns null without a valid premium', () => {
    expect(amountAt(null, rateAt(A, 2500))).toBeNull()
    expect(amountAt(-1, rateAt(A, 2500))).toBeNull()
  })
})

describe('pointRows', () => {
  it('lists every step from step to one step past the last boundary, plus every union boundary', () => {
    expect(pointRows([A, B], 1500).map((r) => r.km)).toEqual([1500, 2000, 3000, 4000, 4500, 5000, 6000, 7500])
  })

  it('gives each insurer its rate at exactly that distance, without interpolation', () => {
    const rows = pointRows([A, B, U], 1000)
    const at = (km: number) => rows.find((r) => r.km === km)!.lookups
    expect(at(2000).map((l) => l.rate)).toEqual([45, 40, null])
    expect(at(3000).map((l) => l.rate)).toEqual([38, 20, null])
    expect(at(7000).map((l) => l.reason)).toEqual(['beyond_max', 'beyond_max', 'unverified'])
  })

  it('marks the best rate in each row', () => {
    const rows = pointRows([A, B, U], 1000)
    expect(rows[0].best).toBe(45)
    expect(rows.at(-1)!.best).toBeNull()
  })

  it('is empty when no insurer has a table', () => {
    expect(pointRows([U], 500)).toEqual([])
  })
})
