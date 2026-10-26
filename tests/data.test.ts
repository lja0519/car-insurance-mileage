import { describe, expect, it } from 'vitest'
import rawJson from '../data/raw_discounts.json'
import { buildSeries, pointRows, rateAt, unionKm } from '../src/lib/normalize'
import type { RawData } from '../src/lib/types'

const raw = rawJson as RawData
const PRESETS = [1000, 2500, 3000, 4500, 5000, 7000, 9000, 11000, 12000, 15000]

describe('raw_discounts.json', () => {
  it('covers all 9 insurers', () => {
    expect(raw.insurers.map((i) => i.name)).toEqual([
      '삼성화재', '한화손해보험', 'KB손해보험', 'DB손해보험', '흥국화재',
      '메리츠화재', '현대해상', '하나손해보험', 'AXA손해보험',
    ])
  })

  for (const ins of raw.insurers) {
    describe(ins.name, () => {
      it('has a comparison table only when verified from a source', () => {
        if (ins.primary) {
          expect(['verified', 'secondary']).toContain(ins.status)
          if (ins.status === 'verified') expect(ins.primary.valid_from ?? ins.primary.valid_to).toBeTruthy()
        } else expect(['unverified', 'not_offered']).toContain(ins.status)
      })

      it('traces every band to a listed source', () => {
        const ids = new Set(ins.sources.map((s) => s.id))
        for (const t of [ins.primary, ...ins.others].filter((t) => t !== null))
          for (const b of t.bands) expect(ids, `${t.vehicle_type} ${b.label}`).toContain(b.source_id)
      })

      it('has contiguous ascending bands with real (non-zero) rates', () => {
        for (const t of [ins.primary, ...ins.others].filter((t) => t !== null)) {
          t.bands.forEach((b, i) => {
            expect(b.distance_max_km).toBeGreaterThan(b.distance_min_km)
            expect(b.discount_rate_percent).toBeGreaterThan(0)
            expect(b.discount_rate_percent).toBeLessThan(100)
            if (i > 0) expect(b.distance_min_km).toBe(t.bands[i - 1].distance_max_km)
          })
        }
      })
    })
  }
})

describe('chart vs table consistency on real data', () => {
  const union = unionKm(raw.insurers)

  it('union KM is sorted and unique', () => {
    expect([...new Set(union)].sort((a, b) => a - b)).toEqual(union)
  })

  it('every insurer boundary is in union KM', () => {
    for (const ins of raw.insurers)
      for (const b of ins.primary?.bands ?? []) {
        expect(union).toContain(b.distance_min_km)
        expect(union).toContain(b.distance_max_km)
      }
  })

  it('chart segment value equals table lookup at union points and presets', () => {
    const probes = [...union, ...PRESETS, ...union.map((k) => k + 1), ...union.map((k) => k - 1).filter((k) => k > 0)]
    for (const ins of raw.insurers) {
      const pts = buildSeries(ins)
      for (const km of probes) {
        const l = rateAt(ins, km)
        // 그래프에서 km 을 덮는 수평 구간들. 경계에서는 두 구간이 닿으므로 그중 하나와 일치해야 한다.
        const covering: number[] = []
        for (let i = 0; i + 1 < pts.length; i++) {
          const [p, q] = [pts[i], pts[i + 1]]
          if (p.y !== null && p.y === q.y && p.x <= km && km <= q.x) covering.push(p.y)
        }
        if (l.rate === null) {
          if (l.reason !== 'boundary_unclear') expect(covering, `${ins.name} ${km}`).toEqual([])
        } else expect(covering, `${ins.name} ${km}`).toContain(l.rate)
      }
    }
  })
})

describe('distance table on real data', () => {
  it('includes every union boundary (except 0) as its own row', () => {
    const kms = pointRows(raw.insurers, 500).map((r) => r.km)
    for (const k of unionKm(raw.insurers).filter((k) => k > 0)) expect(kms).toContain(k)
  })

  it('row values equal the comparison table lookup at the same distance', () => {
    for (const row of pointRows(raw.insurers, 500))
      raw.insurers.forEach((ins, i) => expect(row.lookups[i].rate, `${ins.name} ${row.km}`).toBe(rateAt(ins, row.km).rate))
  })
})
