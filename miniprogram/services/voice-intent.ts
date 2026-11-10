import type { AiItem } from './ai'
import { isClearAllIntent, spokenPersonName } from './voice-router'

export type VoiceIntent = 'billing' | 'stats' | 'statement' | 'customer' | 'clearAll'

export type VoiceCommand = {
  intent: VoiceIntent
  items: AiItem[]
  customerName: string
  range: string
  from?: string
  to?: string
  unpaidOnly: boolean
  transcript: string
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseVoiceRange(text: string): { range: string; from?: string; to?: string } {
  const raw = String(text || '')
  const now = new Date()
  if (/今天/.test(raw)) {
    const t = ymd(now)
    return { range: 'custom', from: t, to: t }
  }
  if (/昨天/.test(raw)) {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    const t = ymd(d)
    return { range: 'custom', from: t, to: t }
  }
  if (/这个月|本月/.test(raw)) return { range: 'month' }
  if (/近30|三十天|一个月/.test(raw)) return { range: '30d' }
  if (/这周|本周|近一周|近7|七天/.test(raw)) return { range: '7d' }

  const re =
    /(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]?\s*(?:到|至|-|~)\s*(?:(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月\s*)?(\d{1,2})\s*[号日]?/
  const m = raw.match(re)
  if (m) {
    const y1 = m[1] ? Number(m[1]) : now.getFullYear()
    const mo1 = Number(m[2])
    const d1 = Number(m[3])
    const y2 = m[4] ? Number(m[4]) : y1
    const mo2 = m[5] ? Number(m[5]) : mo1
    const d2 = Number(m[6])
    if (mo1 >= 1 && mo1 <= 12 && d1 >= 1 && d1 <= 31 && mo2 >= 1 && mo2 <= 12 && d2 >= 1 && d2 <= 31) {
      return {
        range: 'custom',
        from: `${y1}-${pad(mo1)}-${pad(d1)}`,
        to: `${y2}-${pad(mo2)}-${pad(d2)}`,
      }
    }
  }
  return { range: '7d' }
}

export function matchCustomerName(
  text: string,
  customers: Array<{ name?: string | null }>,
  hinted?: string,
): string {
  const hint = spokenPersonName(String(hinted || ''))
  const names = (customers || [])
    .map((c) => String(c.name || '').trim())
    .filter((n) => n.length >= 1)
  names.sort((a, b) => b.length - a.length)
  if (hint) {
    const exact = names.find((n) => n === hint)
    if (exact) return exact
    const hit = names.find((n) => hint.length >= 2 && hint.length <= n.length && n.includes(hint))
    if (hit) return hit
    return hint
  }
  return ''
}

export function inferVoiceIntent(text: string, items: AiItem[]): VoiceIntent {
  if (items.length) return 'billing'
  const raw = String(text || '')
  if (/清空|清除|清掉|删除|删掉/.test(raw)) return 'clearAll'
  if (/账单统计|订单统计/.test(raw) && !/对账单/.test(raw)) return 'stats'
  if (/对账|欠款|账单|结账|未付|未付款/.test(raw)) return 'statement'
  if (/统计|买了|购买|销量|记录|查一下|看看|明细/.test(raw)) return 'stats'
  return 'billing'
}

const CN_DIGIT: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

function cnToInt(raw: string): number {
  const s = String(raw || '').trim()
  if (!s) return 0
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  if (s.startsWith('十')) return 10 + (CN_DIGIT[s.slice(1)] || 0)
  const tens = s.match(/^([一二三四五六七八九两])十([一二三四五六七八九])?$/)
  if (tens) return (CN_DIGIT[tens[1]] || 0) * 10 + (CN_DIGIT[tens[2]] || 0)
  if (s.length === 1 && CN_DIGIT[s] != null) return CN_DIGIT[s]
  return 0
}

export type VoiceSheetAction = {
  action: 'clearAll' | 'clearRow' | 'deleteRow' | 'print' | 'returnPrint'
  row?: number
}

/** 开单页本地指令：清空 / 删行 / 打印 / 退单打印。不走抽货号。 */
export function parseVoiceSheetAction(text: string): VoiceSheetAction | null {
  const raw = String(text || '').replace(/\s+/g, '')
  if (!raw) return null
  if (
    /清空全部|清除全部|全部清空|全部清除|清除全部内容|清空所有|清除所有|全部删掉|删除全部|删掉全部|全部删除|删除数据|清空本子|清除本子|清掉全部|清掉所有/.test(
      raw,
    )
  ) {
    return { action: 'clearAll' }
  }
  const rowHit =
    raw.match(/(?:清空|清除|清掉|删除|删掉).{0,6}第(\d+|[一二两三四五六七八九十]+)行/) ||
    raw.match(/第(\d+|[一二两三四五六七八九十]+)行.{0,6}(?:清空|清除|清掉|删除|删掉)/)
  if (rowHit) {
    const row = cnToInt(rowHit[1])
    if (row < 1) return null
    if (/删除|删掉/.test(raw)) return { action: 'deleteRow', row }
    return { action: 'clearRow', row }
  }
  if (/清空|清除|清掉|删除|删掉|删除数据/.test(raw)) {
    return { action: 'clearAll' }
  }
  if (/退单/.test(raw) && /打印/.test(raw)) {
    return { action: 'returnPrint' }
  }
  if (
    /打印|出纸|打单/.test(raw) &&
    !/退单/.test(raw) &&
    !/打印设置|打印机/.test(raw)
  ) {
    return { action: 'print' }
  }
  return null
}

export function buildVoiceCommand(input: {
  transcript: string
  items?: AiItem[]
  intent?: string
  customerName?: string
  from?: string
  to?: string
  range?: string
  unpaidOnly?: boolean
  customers: Array<{ name?: string | null }>
}): VoiceCommand {
  const transcript = String(input.transcript || '').trim()
  const items = (input.items || []).map((it) => ({
    code: String(it.code || '').trim(),
    quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
    ...(it.color ? { color: String(it.color) } : {}),
    ...(it.size ? { size: String(it.size) } : {}),
    ...(it.hands ? { hands: Number(it.hands) } : {}),
  })).filter((it) => it.code)
  const parsed = parseVoiceRange(transcript)
  const from = String(input.from || parsed.from || '').trim()
  const to = String(input.to || parsed.to || '').trim()
  const range = String(input.range || parsed.range || '7d').trim() || '7d'
  const intentRaw = String(input.intent || '').trim()
  const inferred = inferVoiceIntent(transcript, items)
  const intent: VoiceIntent = items.length
    ? 'billing'
    : isClearAllIntent(intentRaw) || intentRaw === 'clearAll'
      ? 'clearAll'
      : intentRaw === 'billing' || intentRaw === 'stats' || intentRaw === 'statement' || intentRaw === 'customer'
        ? intentRaw
        : inferred
  const customerName = matchCustomerName(transcript, input.customers, input.customerName)
  const unpaidOnly = input.unpaidOnly === true || /欠款|未付/.test(transcript)
  return {
    intent,
    items,
    customerName,
    range: from && to ? 'custom' : range,
    from: from || undefined,
    to: to || undefined,
    unpaidOnly,
    transcript,
  }
}
