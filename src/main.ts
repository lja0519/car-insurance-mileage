import {
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  type Plugin,
} from 'chart.js'
import rawJson from '../data/raw_discounts.json'
import { amountAt, buildSeries, maxDiscount, pointRows, rankAt, unionKm } from './lib/normalize'
import type { Insurer, Lookup, RawData, VerificationStatus } from './lib/types'

Chart.register(LineController, LineElement, PointElement, LinearScale, Legend)

const raw = rawJson as RawData
const insurers = raw.insurers
const UNION = unionKm(insurers)
const MATRIX_STEP = 500
const PRESETS = [1000, 2500, 3000, 4500, 5000, 7000, 9000, 11000, 12000, 15000]
const COLORS = ['#2a6df4', '#e8590c', '#2f9e44', '#c2255c', '#7048e8', '#0c8599', '#a87c00', '#5c5f66', '#d6336c']
const SLIDER_MAX = Math.max(UNION[UNION.length - 1] ?? 0, PRESETS[PRESETS.length - 1]) + 2000

const STATUS_LABEL: Record<VerificationStatus, string> = {
  verified: '공식 확인',
  secondary: '부분 확인',
  unverified: '미확인',
  not_offered: '해당없음',
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T
const fmtKm = (n: number) => `${n.toLocaleString('ko-KR')}km`
const fmtWon = (n: number) => `${n.toLocaleString('ko-KR')}원`
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const basisDate = (ins: Insurer) => {
  const t = ins.primary
  if (!t) return '미확인'
  if (t.valid_from) return `${t.valid_from}~${t.valid_to ?? ''}`
  return t.valid_to ? `~${t.valid_to} (시작일 미기재)` : '미기재'
}
const colorOf = (ins: Insurer) => COLORS[insurers.indexOf(ins) % COLORS.length]

function describe(ins: Insurer, l: Lookup): { rate: string; band: string; kind: string } {
  if (l.rate !== null && l.band)
    return {
      rate: `${l.rate}%`,
      band: l.band.label,
      kind: l.kind === 'boundary' ? '표 경계값 (직접 기재)' : '구간 적용 (계산)',
    }
  const last = ins.primary?.bands.at(-1)
  switch (l.reason) {
    case 'beyond_max':
      return { rate: '할인 없음', band: `최대 ${fmtKm(last!.distance_max_km)} 초과 → 특약 할인 대상 아님`, kind: '-' }
    case 'boundary_unclear':
      return { rate: '경계 불명확', band: `후보 ${l.candidates!.map((c) => `${c}%`).join(' / ')}`, kind: '약관 확인 필요' }
    case 'not_covered':
      return { rate: '표에 없음', band: '공식 표에 이 거리가 없음', kind: '-' }
    default:
      return { rate: ins.status === 'not_offered' ? '해당없음' : '미확인', band: '-', kind: '-' }
  }
}

function sourceLink(ins: Insurer, l: Lookup): string {
  const src = (l.band && ins.sources.find((s) => s.id === l.band!.source_id)) ?? ins.sources[0]
  if (!src) return '<span class="na">없음</span>'
  return `<a href="${esc(src.url)}" target="_blank" rel="noopener" title="${esc(src.title)}">${esc(src.title)}</a>`
}

const badge = (s: VerificationStatus) => `<span class="badge ${s}">${STATUS_LABEL[s]}</span>`

// ---------- chart ----------
let selectedKm = 5000
let hoverKm: number | null = null

const markerPlugin: Plugin<'line'> = {
  id: 'kmMarker',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart
    const draw = (km: number, color: string, dash: number[]) => {
      const x = scales.x.getPixelForValue(km)
      if (x < chartArea.left || x > chartArea.right) return
      ctx.save()
      ctx.strokeStyle = color
      ctx.setLineDash(dash)
      ctx.beginPath()
      ctx.moveTo(x, chartArea.top)
      ctx.lineTo(x, chartArea.bottom)
      ctx.stroke()
      ctx.restore()
    }
    draw(selectedKm, getComputedStyle(document.documentElement).getPropertyValue('--accent'), [])
    if (hoverKm !== null) draw(hoverKm, '#888', [4, 4])
  },
}

const textColor = () => getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()

const chart = new Chart($<HTMLCanvasElement>('#chart'), {
  type: 'line',
  data: {
    datasets: insurers.map((ins) => ({
      label: ins.primary ? ins.name : `${ins.name} (${STATUS_LABEL[ins.status]})`,
      data: buildSeries(ins).map((p) => ({ x: p.x, y: p.y })),
      borderColor: colorOf(ins),
      backgroundColor: colorOf(ins),
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 0,
      spanGaps: false,
      tension: 0,
    })),
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    parsing: false,
    interaction: { mode: 'nearest', intersect: false },
    scales: {
      x: {
        type: 'linear',
        min: 0,
        max: SLIDER_MAX,
        title: { display: true, text: '연간 주행거리 (km)', color: textColor() },
        ticks: { color: textColor(), callback: (v) => Number(v).toLocaleString('ko-KR') },
        grid: { color: 'rgba(128,128,128,0.15)' },
      },
      y: {
        type: 'linear',
        min: 0,
        beginAtZero: true,
        title: { display: true, text: '마일리지 특약 할인율 (%)', color: textColor() },
        ticks: { color: textColor(), callback: (v) => `${v}%` },
        grid: { color: 'rgba(128,128,128,0.15)' },
      },
    },
    plugins: {
      legend: { position: 'bottom', labels: { color: textColor(), boxWidth: 12, usePointStyle: false } },
    },
  },
  plugins: [markerPlugin],
})

// 커스텀 툴팁: 커서 위치 km 에서 표시 중인 보험사의 실제 적용 할인율과 구간을 보여준다.
const tip = document.createElement('div')
Object.assign(tip.style, {
  position: 'absolute', pointerEvents: 'none', display: 'none', zIndex: '5',
  background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px',
  padding: '8px 10px', fontSize: '12px', boxShadow: '0 4px 16px rgba(0,0,0,.15)', whiteSpace: 'nowrap',
})
$('.chart-wrap').appendChild(tip)

const kmFromEvent = (e: MouseEvent | PointerEvent) => {
  const rect = chart.canvas.getBoundingClientRect()
  const px = e.clientX - rect.left
  const { left, right } = chart.chartArea
  if (px < left || px > right) return null
  return Math.max(0, Math.round(chart.scales.x.getValueForPixel(px)! / 10) * 10)
}

chart.canvas.addEventListener('mousemove', (e) => {
  hoverKm = kmFromEvent(e)
  if (hoverKm === null) {
    tip.style.display = 'none'
    chart.draw()
    return
  }
  const rows = rankAt(
    insurers.filter((_, i) => chart.isDatasetVisible(i)),
    hoverKm,
  ).map(({ insurer, lookup }) => {
    const d = describe(insurer, lookup)
    return `<div><span class="swatch" style="background:${colorOf(insurer)}"></span><b>${esc(insurer.name)}</b> ${esc(d.rate)} <span class="na">· ${esc(d.band)}</span></div>`
  })
  tip.innerHTML = `<div style="margin-bottom:4px"><b>${fmtKm(hoverKm)}</b> <span class="na">(클릭하면 선택)</span></div>${rows.join('')}`
  tip.style.display = 'block'
  const wrap = $('.chart-wrap').getBoundingClientRect()
  const x = e.clientX - wrap.left
  tip.style.left = `${Math.min(x + 14, wrap.width - tip.offsetWidth - 4)}px`
  tip.style.top = `${Math.max(4, e.clientY - wrap.top - tip.offsetHeight / 2)}px`
  chart.draw()
})
chart.canvas.addEventListener('mouseleave', () => {
  hoverKm = null
  tip.style.display = 'none'
  chart.draw()
})
chart.canvas.addEventListener('click', (e) => {
  const km = kmFromEvent(e)
  if (km !== null) select(km)
})

// ---------- controls ----------
const kmInput = $<HTMLInputElement>('#km')
const premiumInput = $<HTMLInputElement>('#premium')
let premium: number | null = null
const slider = $<HTMLInputElement>('#slider')
slider.max = String(SLIDER_MAX)

$('#presets').innerHTML = PRESETS.map((k) => `<button data-km="${k}">${fmtKm(k)}</button>`).join('')
$('#union').innerHTML = UNION.map((k) => `<button data-km="${k}">${k.toLocaleString('ko-KR')}</button>`).join('')
for (const id of ['#presets', '#union'])
  $(id).addEventListener('click', (e) => {
    const km = (e.target as HTMLElement).dataset.km
    if (km) select(Number(km))
  })
kmInput.addEventListener('input', () => {
  const v = Number(kmInput.value)
  if (kmInput.value !== '' && Number.isFinite(v) && v >= 0) select(v, 'input')
})
slider.addEventListener('input', () => select(Number(slider.value), 'slider'))
premiumInput.addEventListener('input', () => {
  const digits = premiumInput.value.replace(/[^0-9]/g, '')
  premium = digits === '' ? null : Number(digits)
  premiumInput.value = premium === null ? '' : premium.toLocaleString('ko-KR')
  renderTable()
})

function select(km: number, from?: 'input' | 'slider') {
  selectedKm = km
  if (from !== 'input') kmInput.value = String(km)
  if (from !== 'slider') slider.value = String(Math.min(km, SLIDER_MAX))
  for (const b of document.querySelectorAll<HTMLButtonElement>('.presets button, .union button'))
    b.classList.toggle('active', Number(b.dataset.km) === km)
  renderTable()
  chart.draw()
}

// ---------- 주행거리별 할인율 표 ----------
const MATRIX = pointRows(insurers, MATRIX_STEP)
let matrixView: 'rate' | 'after' = 'rate'

$('#matrix-hint').textContent =
  `${MATRIX_STEP.toLocaleString('ko-KR')}km 간격 지점과 모든 구간 경계값의 할인율입니다. 공식 표의 'N km 이하' 규칙대로 ` +
  '경계값에는 그 아래 구간 할인율이 적용됩니다. 행마다 가장 유리한 값을 강조했고, 행을 누르면 그 거리로 이동합니다. ' +
  '최대−최소는 할인율이 있는 보험사끼리의 차이(%p)이며, 할인 없음·미확인은 0%로 보지 않고 제외합니다.'
$('#matrix thead').innerHTML =
  `<tr><th>주행거리</th><th class="num spread" title="할인율이 있는 보험사 중 최대-최소. 할인 없음·미확인은 제외">최대−최소</th>${insurers.map((ins) => `<th class="num"><span class="swatch" style="background:${colorOf(ins)}"></span>${esc(ins.name)}</th>`).join('')}</tr>`
$('#matrix tbody').addEventListener('click', (e) => {
  const km = (e.target as HTMLElement).closest('tr')?.dataset.km
  if (km) select(Number(km))
})
$('#matrix-view').addEventListener('click', (e) => {
  const view = (e.target as HTMLElement).dataset.view as typeof matrixView | undefined
  if (!view || (view === 'after' && premium === null)) return
  matrixView = view
  renderMatrix()
})

function renderMatrix() {
  if (premium === null) matrixView = 'rate'
  for (const b of document.querySelectorAll<HTMLButtonElement>('#matrix-view button')) {
    b.classList.toggle('active', b.dataset.view === matrixView)
    if (b.dataset.view === 'after') {
      b.disabled = premium === null
      b.title = premium === null ? '할인 전 보험료를 입력하면 볼 수 있습니다' : ''
    }
  }
  $('#matrix tbody').innerHTML = MATRIX.map((row) => {
    const cells = row.lookups.map((l, i) => {
      const isBest = l.rate !== null && l.rate === row.best
      if (l.rate === null) return `<td class="num na">${esc(describe(insurers[i], l).rate)}</td>`
      const text = matrixView === 'after' ? fmtWon(amountAt(premium, l)!.after) : `${l.rate}%`
      return `<td class="num${isBest ? ' best' : ''}">${text}</td>`
    })
    const sel = row.km === selectedKm ? ' class="selected"' : ''
    const spread = row.spread === null ? '<span class="na">-</span>' : `${row.spread}%p`
    return `<tr data-km="${row.km}"${sel}><th scope="row">${fmtKm(row.km)}</th><td class="num spread">${spread}</td>${cells.join('')}</tr>`
  }).join('')
}

function renderTable() {
  $('#table-title').textContent = `${fmtKm(selectedKm)} 기준 보험사 순위`
  const ranked = rankAt(insurers, selectedKm)
  const best = premium === null ? null : ranked[0]
  const bestAmt = best ? amountAt(premium, best.lookup) : null
  $('#amount-summary').textContent =
    premium === null
      ? '할인 전 보험료를 입력하면 보험사별 할인액과 할인 후 금액이 계산됩니다.'
      : `${bestAmt && bestAmt.discount > 0 ? `가장 많이 할인: ${best!.insurer.name} ${fmtWon(bestAmt.discount)} (할인 후 ${fmtWon(bestAmt.after)}). ` : ''}` +
        '입력 보험료 전체에 할인율을 곱한 값이며, 실제로는 할인 적용 대상 보험료(긴급출동 등 제외)에만 적용되어 더 적을 수 있습니다.'
  let rank = 0
  let prevRate: number | null = null
  $('#compare tbody').innerHTML = ranked
    .map(({ insurer, lookup }, i) => {
      if (lookup.rate !== null && lookup.rate !== prevRate) rank = i + 1
      prevRate = lookup.rate
      const d = describe(insurer, lookup)
      const amt = amountAt(premium, lookup)
      const won = (n: number | undefined) => (amt ? fmtWon(n!) : '<span class="na">-</span>')
      return `<tr>
        <td class="num">${lookup.rate === null ? '-' : rank}</td>
        <td><span class="swatch" style="background:${colorOf(insurer)}"></span>${esc(insurer.name)}</td>
        <td class="num">${fmtKm(selectedKm)}</td>
        <td class="num rate ${lookup.rate === null ? 'na' : ''}">${esc(d.rate)}</td>
        <td class="num">${won(amt?.discount)}</td>
        <td class="num rate">${won(amt?.after)}</td>
        <td>${esc(d.band)}</td>
        <td>${esc(d.kind)}</td>
        <td>${esc(basisDate(insurer))}</td>
        <td>${badge(insurer.status)}</td>
        <td>${sourceLink(insurer, lookup)}</td>
      </tr>`
    })
    .join('')
  renderMatrix()
}

function renderSummary() {
  $('#basis').textContent = `${raw.meta.comparison_basis} · 자료 수집일 ${raw.meta.collected_at}`
  $('#notice').textContent =
    `참고용 자료입니다. 할인율은 ${raw.meta.collected_at}에 각 보험사 다이렉트 공식 페이지에서 수집한 값으로, 보험사가 수시로 바꾸므로 ` +
    '가입 전 반드시 해당 보험사에서 다시 확인하세요. 할인액은 입력한 보험료 전체 기준의 추정치이며 보험 가입 권유가 아닙니다.'
  $('#summary tbody').innerHTML = insurers
    .map((ins) => {
      const m = maxDiscount(ins)
      const last = ins.primary?.bands.at(-1)
      return `<tr>
        <td><span class="swatch" style="background:${colorOf(ins)}"></span>${esc(ins.name)}</td>
        <td class="num rate">${m ? `${m.rate}%` : '<span class="na">-</span>'}</td>
        <td>${m ? esc(m.band.label) : '-'}</td>
        <td class="num">${last ? fmtKm(last.distance_max_km) : '-'}</td>
        <td class="wrap">${esc(ins.primary?.discount_method ?? '-')}</td>
        <td class="wrap">${esc(ins.odometer_photo || '-')}</td>
        <td>${esc(ins.primary?.channel ?? '-')}</td>
        <td>${esc(basisDate(ins))}</td>
        <td>${badge(ins.status)}</td>
      </tr>`
    })
    .join('')

  const blocks = insurers
    .filter((ins) => ins.notes.length || ins.others.length || ins.sources.length)
    .map((ins) => {
      const others = ins.others.map(
        (t) =>
          `<li><b>${esc(t.vehicle_type)} · ${esc(t.channel)}</b>: ${t.bands
            .map((b) => `${esc(b.label)} ${b.discount_rate_percent}%`)
            .join(', ')}</li>`,
      )
      const notes = ins.notes.map((n) => `<li>${esc(n)}</li>`)
      const srcs = ins.sources.map(
        (s) => `<li>[${esc(s.type)}] <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> (확인 ${esc(s.accessed_at)})</li>`,
      )
      return `<h3>${esc(ins.name)} ${badge(ins.status)}</h3><ul>${[...others, ...notes, ...srcs].join('')}</ul>`
    })
  $('#notes').innerHTML =
    `<ul>${raw.meta.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` + blocks.join('')
}

renderSummary()
select(selectedKm)
