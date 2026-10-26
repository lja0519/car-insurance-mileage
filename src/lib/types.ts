// 원본 데이터 스키마. data/raw_discounts.json 과 1:1 대응한다.

export type VerificationStatus =
  | 'verified' // 공식 자료에서 표를 직접 확인
  | 'secondary' // 부분 확인: 공식 예시표·보조 자료로만 확인되어 실제 견적 확인 필요
  | 'unverified' // 할인율표를 확인하지 못함
  | 'not_offered' // 해당 채널/상품에서 마일리지 특약을 판매하지 않음

export type SourceType = 'official' | 'official-pdf' | 'secondary-news' | 'secondary-other'

export interface Source {
  id: string
  url: string
  type: SourceType
  title: string
  quote?: string
  accessed_at: string
}

export interface Band {
  distance_min_km: number
  /** null = 약관상 하한 포함 여부를 확인하지 못함 */
  min_inclusive: boolean | null
  distance_max_km: number
  /** null = 약관상 상한 포함 여부를 확인하지 못함 */
  max_inclusive: boolean | null
  discount_rate_percent: number
  label: string
  source_id: string
}

export interface DiscountTable {
  insurer: string
  insurer_id: string
  channel: string
  vehicle_type: string
  valid_from: string | null
  valid_to: string | null
  discount_method: string
  verified_at: string
  bands: Band[]
}

export interface Insurer {
  id: string
  name: string
  status: VerificationStatus
  odometer_photo: string
  notes: string[]
  sources: Source[]
  /** 비교 기준 표 (일반 개인용 승용차) */
  primary: DiscountTable | null
  /** 전기차·채널별 등 별도 표. 비교 그래프에는 쓰지 않는다. */
  others: DiscountTable[]
}

export interface RawData {
  meta: {
    title: string
    comparison_basis: string
    collected_at: string
    notes: string[]
  }
  insurers: Insurer[]
}

export type LookupReason =
  | 'ok'
  | 'unverified' // 보험사 표 자체가 없음
  | 'beyond_max' // 할인 최대 주행거리 초과 → 할인 대상 아님 (0% 로 보지 않는다)
  | 'not_covered' // 표에 해당 거리가 정의되지 않음 (구간 사이 공백 등)
  | 'boundary_unclear' // 경계값인데 약관상 포함 여부가 불명확

export interface Lookup {
  rate: number | null
  reason: LookupReason
  band: Band | null
  /** 'boundary' = 입력 거리가 공식 표의 경계값 그 자체, 'in_band' = 구간 규칙으로 산출 */
  kind: 'boundary' | 'in_band' | null
  /** boundary_unclear 일 때 후보 할인율 */
  candidates?: number[]
}
