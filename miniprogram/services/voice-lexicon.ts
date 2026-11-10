/**
 * 开单说法词表。上千条短语放在这份数据里，不写进规则代码。
 * 识别后在本机按整句包含做精确匹配，命中就执行已有的开单动作。
 */

const KEY = 'tuk_voice_lexicon_v1'
const MAX_ITEMS = 5000

export type VoiceLexiconItem = {
  phrase: string
  action: Record<string, unknown>
}

let items: VoiceLexiconItem[] = []
let ready = false

export function normalizeVoicePhrase(text: string): string {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[。，、,.!！？?]/g, '')
}

/** 换成当前词表。后写的同句覆盖先写的。过短、过长、没有动作的丢掉。 */
export function setVoiceLexicon(list: VoiceLexiconItem[] | null | undefined): void {
  const map = new Map<string, Record<string, unknown>>()
  const rows = Array.isArray(list) ? list : []
  for (const row of rows) {
    if (map.size >= MAX_ITEMS) break
    const phrase = normalizeVoicePhrase(row && row.phrase)
    const action = row && row.action
    if (phrase.length < 2 || phrase.length > 32) continue
    if (!action || typeof action !== 'object' || Array.isArray(action)) continue
    const type = String(action.type || action.action || '').trim()
    if (!type) continue
    map.set(phrase, action)
  }
  items = [...map.entries()]
    .map(([phrase, action]) => ({ phrase, action }))
    .sort((a, b) => b.phrase.length - a.phrase.length || (a.phrase < b.phrase ? -1 : 1))
  ready = true
}

export function voiceLexiconItems(): VoiceLexiconItem[] {
  return items
}

function readStored(): VoiceLexiconItem[] {
  try {
    const wxAny = (globalThis as { wx?: { getStorageSync?: (k: string) => unknown } }).wx
    const raw = wxAny && wxAny.getStorageSync ? wxAny.getStorageSync(KEY) : null
    if (Array.isArray(raw)) return raw as VoiceLexiconItem[]
    if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)) {
      return (raw as { items: VoiceLexiconItem[] }).items
    }
    if (typeof raw === 'string' && raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return parsed as VoiceLexiconItem[]
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)) {
        return (parsed as { items: VoiceLexiconItem[] }).items
      }
    }
  } catch (_) {}
  return []
}

/** 开机或第一次识别时读本地词表。已经设置过就不再用旧缓存覆盖。 */
export function loadVoiceLexicon(): void {
  if (ready) return
  setVoiceLexicon(readStored())
}

export function saveVoiceLexicon(list: VoiceLexiconItem[]): void {
  setVoiceLexicon(list)
  try {
    const wxAny = (globalThis as { wx?: { setStorageSync?: (k: string, v: unknown) => void } }).wx
    if (wxAny && wxAny.setStorageSync) wxAny.setStorageSync(KEY, voiceLexiconItems())
  } catch (_) {}
}

function compactPhrase(text: string): { s: string; map: number[] } {
  let s = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (/\s|[。，、,.!！？?]/.test(ch)) continue
    map.push(i)
    s += ch
  }
  return { s, map }
}

/** 在这句话里找词表。位置越靠前越优先，同一位置用更长的说法。下标按原句。 */
export function matchVoiceLexicon(
  text: string,
): { index: number; len: number; action: Record<string, unknown> } | null {
  loadVoiceLexicon()
  const { s, map } = compactPhrase(String(text || ''))
  if (!s || !items.length) return null
  let best: { index: number; len: number; action: Record<string, unknown> } | null = null
  for (const item of items) {
    const at = s.indexOf(item.phrase)
    if (at < 0) continue
    const index = map[at]
    const len = map[at + item.phrase.length - 1] - index + 1
    if (!best || index < best.index || (index === best.index && len > best.len)) {
      best = { index, len, action: item.action }
    }
  }
  return best
}

export function voiceLexiconHas(text: string): boolean {
  return matchVoiceLexicon(text) != null
}
