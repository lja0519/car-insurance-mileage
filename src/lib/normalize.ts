import type { Band, Insurer, Lookup } from './types'

export interface SeriesPoint {
  x: number
  y: number | null
  band: Band | null
}

const bandsOf = (ins: Insurer): Band[] =>
  ins.primary ? [...ins.primary.bands].sort((a, b) => a.distance_min_km - b.distance_min_km) : []

/** 모든 보험사(비교 기준 표)의 구간 경계값 합집합. 중복 제거 + 오름차순. */
export function unionKm(insurers: Insurer[]): number[] {
  const set = new Set<number>()
  for (const ins of insurers)
    for (const b of bandsOf(ins)) {
      set.add(b.distance_min_km)
      set.add(b.distance_max_km)
    }
  return [...set].sort((a, b) => a - b)
}

/**
 * km 에서 실제 적용되는 할인율. 보간하지 않고, 확인되지 않은 경우 0 이 아니라 null 을 돌려준다.
 */
export function rateAt(ins: Insurer, km: number): Lookup {
  const bands = bandsOf(ins)
  if (bands.length === 0) return { rate: null, reason: 'unverified', band: null, kind: null }

  const inside = bands.find((b) => km > b.distance_min_km && km < b.distance_max_km)
  if (inside) return { rate: inside.discount_rate_percent, reason: 'ok', band: inside, kind: 'in_band' }

  // 경계값: 해당 값을 상한 또는 하한으로 갖는 구간들의 포함 규칙을 따른다.
  const touching = bands.filter((b) => b.distance_max_km === km || b.distance_min_km === km)
  if (touching.length > 0) {
    const flags = touching.map((b) => (b.distance_max_km === km ? b.max_inclusive : b.min_inclusive))
    if (flags.some((f) => f === null))
      return {
        rate: null,
        reason: 'boundary_unclear',
        band: null,
        kind: 'boundary',
        candidates: touching.map((b) => b.discount_rate_percent),
      }
    const hit = touching.find((_, i) => flags[i])
    if (hit) return { rate: hit.discount_rate_percent, reason: 'ok', band: hit, kind: 'boundary' }
  }

  const last = bands[bands.length - 1]
  if (km >= last.distance_max_km) return { rate: null, reason: 'beyond_max', band: null, kind: null }
  return { rate: null, reason: 'not_covered', band: null, kind: null }
}

/** 할인율 내림차순. 할인율이 없는 보험사는 맨 뒤 (0% 로 취급해 섞지 않는다). */
export function rankAt(insurers: Insurer[], km: number): { insurer: Insurer; lookup: Lookup }[] {
  return insurers
    .map((insurer) => ({ insurer, lookup: rateAt(insurer, km) }))
    .sort((a, b) => {
      if (a.lookup.rate === null && b.lookup.rate === null) return 0
      if (a.lookup.rate === null) return 1
      if (b.lookup.rate === null) return -1
      return b.lookup.rate - a.lookup.rate
    })
}

export function maxDiscount(ins: Insurer): { rate: number; band: Band } | null {
  const bands = bandsOf(ins)
  if (bands.length === 0) return null
  const best = bands.reduce((m, b) => (b.discount_rate_percent > m.discount_rate_percent ? b : m))
  return { rate: best.discount_rate_percent, band: best }
}

/**
 * 계단형 그래프 점. 구간마다 수평선을 긋고 인접 구간은 같은 x 에서 수직으로 잇는다.
 * 구간 사이 공백은 null 로 끊어 선이 이어지지 않게 한다.
 */
export function buildSeries(ins: Insurer): SeriesPoint[] {
  const pts: SeriesPoint[] = []
  let prev: Band | null = null
  for (const b of bandsOf(ins)) {
    if (prev && prev.distance_max_km !== b.distance_min_km)
      pts.push({ x: prev.distance_max_km, y: null, band: null })
    pts.push({ x: b.distance_min_km, y: b.discount_rate_percent, band: b })
    pts.push({ x: b.distance_max_km, y: b.discount_rate_percent, band: b })
    prev = b
  }
  return pts
}

/**
 * 보험료에 할인율을 적용한 금액. 엑셀 계산기와 같게 원 단위 반올림한다.
 * 최대 거리 초과는 '할인 없음'이 확정된 경우라 0원, 할인율을 모르는 경우는 null.
 */
export function amountAt(premium: number | null, l: Lookup): { discount: number; after: number } | null {
  if (premium === null || !Number.isFinite(premium) || premium < 0) return null
  if (l.reason === 'beyond_max') return { discount: 0, after: premium }
  if (l.rate === null) return null
  const discount = Math.round((premium * l.rate) / 100)
  return { discount, after: premium - discount }
}

export interface PointRow {
  km: number
  /** insurers 와 같은 순서 */
  lookups: Lookup[]
  best: number | null
}

/**
 * 주행거리 지점별 할인율 표. step 간격 지점과 Union KM 경계값을 모두 행으로 만들고,
 * 마지막 경계값 바로 다음 step 까지 포함해 할인이 끝나는 지점도 보이게 한다.
 */
export function pointRows(insurers: Insurer[], step: number): PointRow[] {
  const union = unionKm(insurers)
  if (union.length === 0) return []
  const last = union[union.length - 1]
  const kms = new Set(union.filter((k) => k > 0))
  for (let k = step; k <= last + step; k += step) kms.add(k)
  return [...kms]
    .sort((a, b) => a - b)
    .map((km) => {
      const lookups = insurers.map((ins) => rateAt(ins, km))
      const rates = lookups.flatMap((l) => (l.rate === null ? [] : [l.rate]))
      return { km, lookups, best: rates.length ? Math.max(...rates) : null }
    })
}
