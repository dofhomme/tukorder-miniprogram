/**
 * 第一类：货号、客户、功能都从本机缓存里找。
 * 先精确。客户名再按读音对，前后鼻音、平翘舌和 n/l 算同一个音。
 * 读音对不上时，才按一个字的差别匹配。只能有一个结果，多个都不猜。
 */
import { voiceSyllable } from './voice-pinyin'
import { stripSpokenMarks } from './voice-router'

type CustomerLike = string | { name?: string | null }

export type VoiceCacheInput = {
  codes?: string[]
  customers?: CustomerLike[]
  phrases?: string[]
}

type Span = { start: number; end: number; text: string }

const UNIT_AFTER = /[件个条双份套]/

function editWithin(a: string, b: string, max: number): number {
  const n = a.length
  const m = b.length
  if (Math.abs(n - m) > max) return max + 1
  let prev: number[] = []
  for (let j = 0; j <= m; j++) prev.push(j)
  for (let i = 1; i <= n; i++) {
    const cur = [i]
    let rowMin = i
    const ac = a.charCodeAt(i - 1)
    for (let j = 1; j <= m; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[m]
}

function foldSyllable(py: string): string {
  let s = py.toLowerCase()
  if (s.startsWith('zh')) s = `z${s.slice(2)}`
  else if (s.startsWith('ch')) s = `c${s.slice(2)}`
  else if (s.startsWith('sh')) s = `s${s.slice(2)}`
  if (s.startsWith('n')) s = `l${s.slice(1)}`
  if (s.endsWith('iang')) s = `${s.slice(0, -4)}ian`
  else if (s.endsWith('uang')) s = `${s.slice(0, -4)}uan`
  else if (s.endsWith('ang')) s = `${s.slice(0, -3)}an`
  else if (s.endsWith('eng')) s = `${s.slice(0, -3)}en`
  else if (s.endsWith('ing')) s = `${s.slice(0, -3)}in`
  return s
}

/** 字面不同，但每个字的读音相同。完全一样不算。 */
function sameSound(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false
  let differ = false
  for (let i = 0; i < a.length; i++) {
    if (a.charAt(i) === b.charAt(i)) continue
    const pa = voiceSyllable(a.charAt(i))
    const pb = voiceSyllable(b.charAt(i))
    if (!pa || !pb || foldSyllable(pa) !== foldSyllable(pb)) return false
    differ = true
  }
  return differ
}

function compactMap(text: string): { s: string; map: number[] } {
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

function overlaps(spans: Span[], start: number, end: number): boolean {
  return spans.some((span) => start < span.end && end > span.start)
}

function customerNames(customers: CustomerLike[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of customers || []) {
    const name = (typeof row === 'string' ? row : String((row && row.name) || '')).trim()
    if (name.length < 2 || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  out.sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
  return out
}

function foldTail(raw: string): { prefix: string; folded: string } | null {
  const s = String(raw || '').toUpperCase()
  const m = s.match(/^([A-Z]{0,6})([0-9OIL]{2,8})$/)
  if (!m) return null
  const tail = m[2].replace(/O/g, '0').replace(/[IL]/g, '1')
  const folded = m[1] + tail
  if (folded.length < 4) return null
  return { prefix: m[1], folded }
}

function codeSpans(text: string, codes: string[]): Span[] {
  const exact = new Set<string>()
  const buckets = new Map<string, string[]>()
  const canonical = new Map<string, string>()
  for (const raw of codes || []) {
    const rec = foldTail(String(raw || '').trim())
    if (!rec || exact.has(rec.folded)) continue
    exact.add(rec.folded)
    canonical.set(rec.folded, String(raw).trim())
    const key = `${rec.prefix}:${rec.folded.length}`
    const arr = buckets.get(key) || []
    arr.push(rec.folded)
    buckets.set(key, arr)
  }
  const spans: Span[] = []
  const re = /[A-Za-z]{0,6}[0-9OoIl]{2,8}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const token = m[0]
    if (token.length < 4) continue
    const rec = foldTail(token)
    if (!rec) continue
    const start = m.index
    const end = start + token.length
    if (exact.has(rec.folded)) continue
    const next = text.charAt(end)
    if (UNIT_AFTER.test(next)) {
      let glued = false
      for (let q = 1; q <= 2 && q < rec.folded.length; q++) {
        if (exact.has(rec.folded.slice(0, -q))) glued = true
      }
      if (glued) continue
    }
    const near: string[] = []
    for (let len = rec.folded.length - 1; len <= rec.folded.length + 1; len++) {
      const arr = buckets.get(`${rec.prefix}:${len}`) || []
      for (const code of arr) {
        if (editWithin(rec.folded, code, 1) <= 1) near.push(code)
      }
    }
    const uniq = [...new Set(near)]
    if (uniq.length !== 1) continue
    const hit = canonical.get(uniq[0]) || uniq[0]
    if (hit.toUpperCase() === token.toUpperCase()) continue
    spans.push({ start, end, text: hit })
  }
  return spans
}

const LOCKED_TALK = [
  '当前客户',
  '这个客户',
  '现在的客户',
  '现在客户',
  '本单客户',
  '当前的客户',
  '历史价格',
  '对账单',
  '最近一个月',
  '近一个月',
  '账单统计',
  '订单统计',
]

/** 只有句子是在点名，才拿近字去对客户。统计、账单、货号这类功能句不对客户名。 */
function mentionsPerson(compact: string): boolean {
  const body = compact.replace(/当前客户|这个客户|现在的客户|现在客户|本单客户|当前的客户/g, '')
  if (/客户|用户|代理|历史价格|对账单|上一单|最近一单/.test(body)) return true
  if (/历史价格|对账单|上一单|最近一单/.test(compact)) return true
  if (
    compact.length <= 12 &&
    !/打印|保存|清空|清除|统计|对账|账单|订单|货号|库存|退单|供应链|入库|出库/.test(compact)
  ) {
    return true
  }
  return false
}

function customerSpans(compact: string, map: number[], names: string[], taken: Span[]): Span[] {
  if (!mentionsPerson(compact)) return []
  const spans: Span[] = []
  const occupied: Array<[number, number]> = []
  for (const phrase of LOCKED_TALK) {
    let at = compact.indexOf(phrase)
    while (at >= 0) {
      occupied.push([at, at + phrase.length])
      at = compact.indexOf(phrase, at + phrase.length)
    }
  }
  for (const name of names) {
    let at = compact.indexOf(name)
    while (at >= 0) {
      occupied.push([at, at + name.length])
      at = compact.indexOf(name, at + name.length)
    }
  }
  const hits: Array<{ at: number; len: number; name: string; sound: boolean }> = []
  for (const name of names) {
    if (name.length < 2 || name.length > 12) continue
    const soundFound: Array<{ at: number; len: number }> = []
    const editFound: Array<{ at: number; len: number }> = []
    const minLen = Math.max(2, name.length - 1)
    const maxLen = name.length + 1
    for (let len = minLen; len <= maxLen; len++) {
      for (let i = 0; i + len <= compact.length; i++) {
        if (occupied.some(([a, b]) => i < b && i + len > a)) continue
        const window = compact.slice(i, i + len)
        if (/^[0-9零〇一二三四五六七八九十两]+$/.test(window)) continue
        const prevNum = i > 0 && /[0-9零〇一二三四五六七八九十两]/.test(compact.charAt(i - 1))
        const nextNum = i + len < compact.length && /[0-9零〇一二三四五六七八九十两]/.test(compact.charAt(i + len))
        const cue = compact.slice(0, i)
        const afterCue = /(?:选择客户|选中客户|选客户|添加客户|增加客户|新增客户|新建客户|选择用户|选用户|添加用户|增加用户|选择代理|选中代理|选代理|客户|用户|代理)$/.test(cue)
        if ((prevNum || nextNum) && !afterCue) continue
        const same = len === name.length && sameSound(window, name)
        if (same) {
          soundFound.push({ at: i, len })
          continue
        }
        if (name.length === 2 && (len !== 2 || window.charAt(0) !== name.charAt(0))) continue
        if (editWithin(window, name, 1) !== 1) continue
        editFound.push({ at: i, len })
      }
    }
    const found = soundFound.length ? soundFound : editFound
    if (found.length !== 1) continue
    hits.push({ at: found[0].at, len: found[0].len, name, sound: soundFound.length > 0 })
  }
  const used: Array<[number, number]> = []
  hits.sort((a, b) => b.name.length - a.name.length)
  for (const hit of hits) {
    if (used.some(([a, b]) => hit.at < b && hit.at + hit.len > a)) continue
    const overlap = hits.filter((other) => other.at < hit.at + hit.len && other.at + other.len > hit.at)
    const soundOverlap = overlap.filter((other) => other.sound)
    const rivals = soundOverlap.length ? soundOverlap : overlap
    if (rivals.length !== 1 || rivals[0].name !== hit.name) continue
    const start = map[hit.at]
    const end = map[hit.at + hit.len - 1] + 1
    if (overlaps(taken, start, end) || overlaps(spans, start, end)) continue
    used.push([hit.at, hit.at + hit.len])
    spans.push({ start, end, text: hit.name })
  }
  return spans
}

function phraseBuckets(phrases: string[]): Map<string, string[]> {
  const buckets = new Map<string, string[]>()
  const seen = new Set<string>()
  for (const raw of phrases || []) {
    const phrase = String(raw || '').replace(/\s+/g, '').replace(/[。，、,.!！？?]/g, '')
    if (phrase.length < 4 || phrase.length > 16 || seen.has(phrase)) continue
    seen.add(phrase)
    const keys = [phrase.charAt(0), phrase.charAt(1)]
    for (const key of keys) {
      if (!key) continue
      const arr = buckets.get(key) || []
      arr.push(phrase)
      buckets.set(key, arr)
    }
  }
  return buckets
}

function isWordChar(ch: string): boolean {
  return /[\u4e00-\u9fa5A-Za-z0-9]/.test(ch)
}

/** 改动的字紧挨着还没对上的字时，不把半个词对成另一个功能。 */
function edgeStuck(compact: string, at: number, len: number, phrase: string): boolean {
  const prev = at > 0 ? compact.charAt(at - 1) : ''
  const next = at + len < compact.length ? compact.charAt(at + len) : ''
  if (phrase.length === len) {
    let diff = -1
    for (let i = 0; i < len; i++) {
      if (compact.charAt(at + i) !== phrase.charAt(i)) {
        if (diff >= 0) return false
        diff = i
      }
    }
    if (diff === 0 && isWordChar(prev)) return true
    if (diff === len - 1 && isWordChar(next)) return true
    return false
  }
  return isWordChar(prev) || isWordChar(next)
}

function functionSpans(compact: string, map: number[], phrases: string[], taken: Span[]): Span[] {
  const buckets = phraseBuckets(phrases)
  if (!buckets.size || compact.length < 4) return []
  const hits: Array<{ at: number; len: number; phrase: string; dist: number }> = []
  for (let len = 4; len <= Math.min(16, compact.length); len++) {
    for (let i = 0; i + len <= compact.length; i++) {
      const window = compact.slice(i, i + len)
      const pool = new Set<string>()
      for (const key of [window.charAt(0), window.charAt(1)]) {
        for (const phrase of buckets.get(key) || []) pool.add(phrase)
      }
      let best: { phrase: string; dist: number } | null = null
      let ties = 0
      for (const phrase of pool) {
        if (Math.abs(phrase.length - len) > 1) continue
        const dist = editWithin(window, phrase, 1)
        if (dist > 1 || dist === 0) continue
        if (edgeStuck(compact, i, len, phrase)) continue
        if (!best || dist < best.dist || (dist === best.dist && phrase.length > best.phrase.length)) {
          if (best && dist === best.dist && phrase.length === best.phrase.length) ties += 1
          else ties = 1
          best = { phrase, dist }
        } else if (best && dist === best.dist) {
          ties += 1
        }
      }
      if (!best || ties !== 1) continue
      hits.push({ at: i, len, phrase: best.phrase, dist: best.dist })
    }
  }
  hits.sort((a, b) => a.dist - b.dist || b.len - a.len || a.at - b.at)
  const spans: Span[] = []
  const used: Array<[number, number]> = []
  for (const hit of hits) {
    if (used.some(([a, b]) => hit.at < b && hit.at + hit.len > a)) continue
    const start = map[hit.at]
    const end = map[hit.at + hit.len - 1] + 1
    if (overlaps(taken, start, end)) continue
    used.push([hit.at, hit.at + hit.len])
    spans.push({ start, end, text: hit.phrase })
  }
  return spans
}

function applySpans(text: string, spans: Span[]): string {
  const rows = spans
    .filter((span) => span.end > span.start && text.slice(span.start, span.end) !== span.text)
    .sort((a, b) => b.start - a.start)
  let out = text
  for (const span of rows) out = out.slice(0, span.start) + span.text + out.slice(span.end)
  return out
}

/** 用本机货号、客户、功能说法改写近音近形。精确命中和有两个候选的都不改。 */
export function rewriteVoiceFromCache(text: string, input: VoiceCacheInput): string {
  const raw = String(text || '')
  if (!raw.trim()) return raw
  const codes = codeSpans(raw, input.codes || [])
  const { s, map } = compactMap(raw)
  const names = customerNames(input.customers)
  const customers = customerSpans(s, map, names, codes)
  const functions = functionSpans(s, map, input.phrases || [], codes.concat(customers))
  return applySpans(raw, codes.concat(customers, functions))
}

/** 整句去掉口头语后只剩缓存里的一个客户名时，直接选中，不再送去理解。 */
export function cachedCustomerOnly(text: string, customers: CustomerLike[] | undefined): string {
  const names = customerNames(customers)
  if (!names.length) return ''
  const compact = String(text || '')
    .replace(/\s+/g, '')
    .replace(/[。，、,.!！？?]/g, '')
    .replace(/^(?:请|帮我|给我|麻烦|那个)+/, '')
    .replace(/(?:吧|啊|呀|一下)+$/g, '')
  for (const name of names) {
    if (
      compact === name ||
      compact === `客户${name}` ||
      compact === `用户${name}` ||
      compact === `选择${name}` ||
      compact === `选中${name}` ||
      compact === `选择客户${name}` ||
      compact === `代理${name}` ||
      compact === `选择代理${name}`
    ) {
      return name
    }
  }
  return ''
}

/** 点名时先对本地客户。完全一样用原名；读音相同且只有一个时用那个。读音对不上，才接受只差一个字的唯一客户。多个时把名字放进 names，交给界面选择。 */
export function matchSpokenCustomer(
  heard: string,
  customers: CustomerLike[] | undefined,
): { name: string; ambiguous: boolean; names: string[] } {
  const none = { name: '', ambiguous: false, names: [] as string[] }
  const raw = stripSpokenMarks(String(heard || '')).trim()
  if (raw.length < 2 || raw.length > 12) return none
  const names = customerNames(customers)
  const plain = (name: string) => stripSpokenMarks(name).trim()
  for (const name of names) {
    if (name === raw || plain(name) === raw) return { name, ambiguous: false, names: [] }
  }
  if (/^[0-9零〇一二三四五六七八九十两]+$/.test(raw)) return none
  const sound: string[] = []
  const near: string[] = []
  for (const name of names) {
    const folded = plain(name)
    if (sameSound(raw, folded)) {
      sound.push(name)
      continue
    }
    if (Math.abs(folded.length - raw.length) > 1) continue
    if (folded.length === 2 && (raw.length !== 2 || raw.charAt(0) !== folded.charAt(0))) continue
    if (editWithin(raw, folded, 1) === 1) near.push(name)
  }
  if (sound.length === 1) return { name: sound[0], ambiguous: false, names: sound }
  if (sound.length > 1) return { name: '', ambiguous: true, names: sound }
  if (near.length === 1) return { name: near[0], ambiguous: false, names: near }
  return { name: '', ambiguous: near.length > 1, names: near }
}
