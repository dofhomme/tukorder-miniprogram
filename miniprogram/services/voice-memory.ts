import type { AiItem } from './ai'

const ALIAS_KEY = 'tuk_voice_alias_v1'

export type VoiceSlot = {
  lastItems: AiItem[]
  lastCustomer: string
}

let _slot: VoiceSlot = { lastItems: [], lastCustomer: '' }

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  幺: 1,
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

export function getVoiceSlot(): VoiceSlot {
  return {
    lastItems: _slot.lastItems.map((it) => ({ ...it })),
    lastCustomer: _slot.lastCustomer,
  }
}

export function clearVoiceSlot() {
  _slot = { lastItems: [], lastCustomer: '' }
}

export function rememberVoiceFill(items: AiItem[], customerName?: string) {
  const list = (items || [])
    .map((it) => ({
      code: String(it.code || '').trim(),
      quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
    }))
    .filter((it) => it.code)
  if (list.length) _slot.lastItems = list
  const n = String(customerName || '').trim()
  if (n) _slot.lastCustomer = n
}

export function cartToVoiceItems(
  items?: Array<{ productCode?: string; productName?: string; quantity?: number }>,
): AiItem[] {
  return (items || [])
    .map((it) => ({
      code: String(it.productCode || it.productName || '').trim(),
      quantity: Math.abs(Number(it.quantity) || 0) || 1,
    }))
    .filter((it) => it.code)
}

export function pickLastOrder<
  T extends {
    customerName?: string | null
    isReturn?: boolean
    createdAt?: string | null
    items?: Array<{ productCode?: string; productName?: string; quantity?: number }>
  },
>(orders: T[], customer?: string): T | null {
  const name = String(customer || '').trim()
  const list = (orders || []).filter((o) => !o.isReturn)
  const matched = name
    ? list.filter((o) => {
        const n = String(o.customerName || '').trim()
        return n === name || (n && (n.includes(name) || name.includes(n)))
      })
    : list
  matched.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  return matched.find((o) => cartToVoiceItems(o.items).length) || matched[0] || null
}

function loadAliases(): Record<string, string> {
  try {
    const raw = wx.getStorageSync(ALIAS_KEY)
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const spoken = String(k || '').replace(/\s+/g, '')
        const code = String(v || '').trim()
        if (spoken.length >= 2 && code) out[spoken] = code
      }
      return out
    }
  } catch (_) {}
  return {}
}

function isDigitAlias(raw: string): boolean {
  const s = String(raw || '').replace(/\s+/g, '')
  return /^[0-9]+$/.test(s) || /^[零〇一二两三四五六七八九十百幺]+$/.test(s)
}

export function rememberSpokenAlias(spoken: string, code: string) {
  const k = String(spoken || '').replace(/\s+/g, '')
  const c = String(code || '').trim()
  // 听成的数字不能记成口癖。记下 77→077 之后，再说 777 也会被改成 077。
  if (isDigitAlias(k)) return
  if (k.length < 2 || !c || k === c || k.toUpperCase() === c.toUpperCase()) return
  try {
    const map = loadAliases()
    map[k] = c
    wx.setStorageSync(ALIAS_KEY, map)
  } catch (_) {}
}

export function rememberSpokenAliases(pairs: Array<{ spoken: string; code: string }>) {
  for (const p of pairs || []) rememberSpokenAlias(p.spoken, p.code)
}

/** 把店铺口癖替换成货号，再交给目录匹配。 */
export function applySpokenAliases(text: string): string {
  let s = String(text || '')
  const map = loadAliases()
  const keys = Object.keys(map).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    const code = map[k]
    if (!code || !k || isDigitAlias(k)) continue
    if (s.includes(k)) s = s.split(k).join(code)
  }
  return s
}

export type SessionUtterance = {
  leftover: string
  injectItems: AiItem[]
  error?: string
  confirm?: boolean
  cancel?: boolean
}

export function utteranceConfirmed(text: string): boolean {
  return /确认|就这样|确定|对的|没错|填入/.test(String(text || ''))
}

/** 「再来两件 / 同样的」用上一笔货号，不打网。老规矩走上一单缓存。 */
export function consumeSessionUtterance(text: string): SessionUtterance {
  let s = String(text || '').replace(/\s+/g, '')
  if (!s) return { leftover: '', injectItems: [] }

  if (/^(确认|就这样|确定|对的|没错|填入)$/.test(s)) {
    return { leftover: '', injectItems: [], confirm: true }
  }
  if (/^(不要|取消|算了|不用了)$/.test(s)) {
    return { leftover: '', injectItems: [], cancel: true }
  }

  if (/^(同样的|再来一次|再来一份)$/.test(s)) {
    if (!_slot.lastItems.length) return { leftover: s, injectItems: [], error: '没有上一笔货号，请先说货号' }
    return {
      leftover: '',
      injectItems: _slot.lastItems.map((it) => ({ ...it })),
    }
  }

  const again = s.match(/(同样的|刚才的|刚刚的)?再来((?:[0-9]+|[一二两三四五六七八九十]+)件)?/)
  if (!again) return { leftover: String(text || '').trim(), injectItems: [] }
  if (!_slot.lastItems.length) {
    return { leftover: String(text || '').trim(), injectItems: [], error: '没有上一笔货号，请先说货号' }
  }
  const last = _slot.lastItems[_slot.lastItems.length - 1]
  let qty = last.quantity > 0 ? last.quantity : 1
  const qtyRaw = String(again[2] || '').replace(/件$/, '')
  if (qtyRaw) {
    const n = cnToInt(qtyRaw)
    if (n > 0) qty = n
  }
  s = s.replace(again[0], '')
  return {
    leftover: s,
    injectItems: [{ code: last.code, quantity: qty }],
  }
}
