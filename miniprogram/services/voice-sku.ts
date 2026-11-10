import type { AiItem } from './ai'
import { stripSpokenMarks } from './voice-router'

/** 与云端 extract-order 相同：同尾号多前缀时 LT > QS > LP > QC > YC > Y */
const PREFIX_PRIORITY = ['LT', 'QS', 'LP', 'QC', 'YC', 'Y']

const UNIT_RE = /^(件|个|条|双|份|套)/
const QTY_HEAD_RE = /^([0-9]{1,3}|[一二两三四五六七八九十百零〇两]+)/

const DIGIT_VAR: Record<string, string[]> = {
  '0': ['零', '〇', '0'],
  '1': ['幺', '壹', '一', '1'],
  '2': ['两', '贰', '二', '2'],
  '3': ['叁', '三', '3'],
  '4': ['肆', '四', '4'],
  '5': ['伍', '五', '5'],
  '6': ['陆', '六', '6'],
  '7': ['柒', '七', '7'],
  '8': ['捌', '八', '8'],
  '9': ['玖', '九', '9'],
}

const LETTER_CN: Record<string, string[]> = {
  A: ['诶', '欸', '哎'],
  B: ['比', '必', '哔'],
  C: ['西', '希'],
  Y: ['歪'],
}

const FILLER_RE =
  /帮我|给我|我要|麻烦|谢谢|那个|一下|开单|货号是|货号|商品|再来|来点|加上|以及|还有|和|跟|与|要/g

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

export type VoiceSkuAlias = { spoken: string; code: string }

export type VoiceSkuAmbiguous = {
  spoken: string
  codes: string[]
  qty: number
  color?: string
  size?: string
  qtySpoken?: boolean
}

export type VoiceSkuResult = {
  items: AiItem[]
  leftover: boolean
  aliases: VoiceSkuAlias[]
  ambiguous: VoiceSkuAmbiguous[]
  missed: string[]
}

type CatalogRec = {
  canonical: string
  upper: string
  digits: string
}

type QtyHit = {
  qty: number
  end: number
  explicit: boolean
}

function compactVoice(text: string): string {
  const marked = String(text || '').replace(
    /([0-9A-Za-z])\s*[，,、]\s*(?=[0-9一二两三四五六七八九十])/g,
    '$1|',
  )
  return marked
    .replace(FILLER_RE, '')
    .replace(/[\s,，、.。;；:：'"“”‘’()（）\[\]【】]/g, '')
    .trim()
}

function cnToInt(raw: string): number {
  const s = String(raw || '').trim()
  if (!s) return 0
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  if (s === '百') return 100
  if (s.startsWith('十')) return 10 + (CN_DIGIT[s.slice(1)] || 0)
  const hundred = s.match(/^([一二三四五六七八九两])百([零〇]([一二三四五六七八九]))?(十([一二三四五六七八九])?)?$/)
  if (hundred) {
    let n = (CN_DIGIT[hundred[1]] || 0) * 100
    if (hundred[3]) n += CN_DIGIT[hundred[3]] || 0
    if (hundred[0].includes('十')) n += 10 + (CN_DIGIT[hundred[5]] || 0)
    return n
  }
  const tens = s.match(/^([一二三四五六七八九两])十([一二三四五六七八九])?$/)
  if (tens) return (CN_DIGIT[tens[1]] || 0) * 10 + (CN_DIGIT[tens[2]] || 0)
  if (s.length === 1 && CN_DIGIT[s] != null) return CN_DIGIT[s]
  let acc = 0
  for (const ch of s) {
    if (CN_DIGIT[ch] == null) return 0
    acc = acc * 10 + CN_DIGIT[ch]
  }
  return acc
}

function matchDigitAt(s: string, i: number, d: string): number {
  const vars = DIGIT_VAR[d] || [d]
  for (const v of vars) {
    if (s.startsWith(v, i)) return i + v.length
  }
  return -1
}

function parseCnIntAt(s: string, i: number): { value: number; end: number } | null {
  const slice = s.slice(i)
  const patterns = [
    /^([一二三四五六七八九两])百[零〇]([一二三四五六七八九])/,
    /^([一二三四五六七八九两])百十([一二三四五六七八九])?/,
    /^([一二三四五六七八九两])百/,
    /^([一二三四五六七八九两])十([一二三四五六七八九])?/,
    /^十([一二三四五六七八九])/,
    /^十/,
    /^[一二两三四五六七八九幺零〇]/,
  ]
  for (const re of patterns) {
    const m = slice.match(re)
    if (!m) continue
    const value = cnToInt(m[0])
    if (value <= 0 && m[0] !== '零' && m[0] !== '〇') continue
    return { value, end: i + m[0].length }
  }
  return null
}

function consumeDigits(s: string, i: number, digits: string): number {
  let p = i
  let ok = true
  for (const d of digits) {
    const n = matchDigitAt(s, p, d)
    if (n < 0) {
      ok = false
      break
    }
    p = n
  }
  if (ok) return p
  const want = Number(digits)
  if (!Number.isFinite(want) || want < 0) return -1
  const cn = parseCnIntAt(s, i)
  if (cn && cn.value === want) return cn.end
  return -1
}

function consumeCode(s: string, i: number, rec: CatalogRec): number {
  const up = rec.upper
  let p = i
  let k = 0
  while (k < up.length && /[A-Z]/.test(up[k])) {
    const ch = up[k]
    const cur = s[p]
    if (!cur) return -1
    if (cur.toUpperCase() === ch) {
      p += 1
      k += 1
      continue
    }
    if (k === 0) {
      const alts = LETTER_CN[ch] || []
      const hit = alts.find((w) => s.startsWith(w, p))
      if (hit) {
        p += hit.length
        k += 1
        continue
      }
    }
    return -1
  }
  const digits = up.slice(k)
  if (!digits) return p > i ? p : -1
  const end = consumeDigits(s, p, digits)
  return end > p ? end : -1
}

function parseQtyToken(s: string, i: number): QtyHit | null {
  if (i >= s.length) return null
  const slice = s.slice(i)
  const num = slice.match(QTY_HEAD_RE)
  const afterNum = num ? slice.slice(num[0].length) : slice
  const unit = afterNum.match(UNIT_RE)
  if (num && unit) {
    const qty = cnToInt(num[1])
    if (qty > 0 && qty < 1000) {
      return { qty, end: i + num[0].length + unit[0].length, explicit: true }
    }
  }
  if (!num && unit) {
    return { qty: 1, end: i + unit[0].length, explicit: false }
  }
  return null
}

function buildCatalog(codes: string[]): CatalogRec[] {
  const seen = new Set<string>()
  const out: CatalogRec[] = []
  for (const raw of codes || []) {
    const canonical = String(raw || '').trim()
    if (!canonical) continue
    const upper = canonical.toUpperCase()
    if (seen.has(upper)) continue
    seen.add(upper)
    const m = upper.match(/(\d+)$/)
    out.push({
      canonical,
      upper,
      digits: m ? m[1] : '',
    })
  }
  out.sort((a, b) => b.upper.length - a.upper.length)
  return out
}

function coreMap(recs: CatalogRec[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const rec of recs) {
    if (!rec.digits) continue
    const keys = [rec.digits]
    const stripped = rec.digits.replace(/^0+/, '')
    if (stripped && stripped !== rec.digits && stripped.length >= 2) keys.push(stripped)
    for (const k of keys) {
      const arr = map.get(k) || []
      arr.push(rec.canonical)
      map.set(k, arr)
    }
  }
  return map
}

type Hit = { code: string; end: number; len: number; core?: boolean }

function prefixRank(code: string): number {
  const u = String(code || '').toUpperCase()
  const i = PREFIX_PRIORITY.findIndex((p) => u.startsWith(p))
  return i >= 0 ? i : PREFIX_PRIORITY.length
}

function candidatesAt(s: string, i: number, recs: CatalogRec[], byCore: Map<string, string[]>): Hit[] {
  const hits: Hit[] = []
  const seenEnd = new Set<string>()
  for (const rec of recs) {
    const end = consumeCode(s, i, rec)
    if (end <= i) continue
    const key = `${rec.canonical}@${end}`
    if (seenEnd.has(key)) continue
    seenEnd.add(key)
    hits.push({ code: rec.canonical, end, len: end - i })
  }
  const rest = s.slice(i)
  const digitRun = rest.match(/^(\d{2,10})/)
  if (digitRun) {
    const run = digitRun[1]
    const heads = [run]
    if (/^(件|个|条|双|份|套)/.test(rest.slice(run.length))) {
      for (let qlen = 1; qlen <= 2 && qlen < run.length; qlen++) {
        const head = run.slice(0, -qlen)
        const qty = Number(run.slice(-qlen))
        if (head.length >= 2 && qty > 0 && qty < 100) heads.push(head)
      }
    }
    for (const digits of heads) {
      const end = i + digits.length
      const cands = Array.from(new Set(byCore.get(digits) || []))
      for (const code of cands) {
        const key = `${code}@${end}`
        if (seenEnd.has(key)) continue
        seenEnd.add(key)
        hits.push({ code, end, len: end - i, core: true })
      }
    }
  }
  const cnRun = rest.match(/^[零〇一二两三四五六七八九十百幺]{1,8}/)
  if (cnRun) {
    const n = cnToInt(cnRun[0])
    const digits = n > 0 ? String(n) : ''
    if (digits) {
      const end = i + cnRun[0].length
      const q = parseQtyToken(s, end)
      if (!(q && !q.explicit)) {
        const cands = Array.from(new Set(byCore.get(digits) || []))
        for (const code of cands) {
          const key = `${code}@${end}`
          if (seenEnd.has(key)) continue
          seenEnd.add(key)
          hits.push({ code, end, len: end - i, core: true })
        }
      }
    }
  }
  if (!recs.length) {
    const m = rest.match(/^([A-Za-z]{1,4}\d{2,6}|\d{3,6})/)
    if (m) hits.push({ code: m[1].toUpperCase(), end: i + m[0].length, len: m[0].length })
  }
  return hits
}

function scoreHit(s: string, hit: Hit): number {
  const q = parseQtyToken(s, hit.end)
  if (q && q.explicit) return 200 + hit.len
  if (q && !q.explicit) return 40 + hit.len
  const next = s[hit.end]
  if (!next || /[A-Za-z]/.test(next)) return 90 + hit.len
  return 60 + hit.len
}

function rankedHitsAt(s: string, i: number, recs: CatalogRec[], byCore: Map<string, string[]>): Hit[] {
  const hits = candidatesAt(s, i, recs, byCore)
  if (!hits.length) return []
  hits.sort(
    (a, b) =>
      scoreHit(s, b) - scoreHit(s, a) || prefixRank(a.code) - prefixRank(b.code) || b.len - a.len,
  )
  const top = hits[0]
  if (/^[年月日号]/.test(s.slice(top.end))) return []
  return hits
}

function bestHitAt(s: string, i: number, recs: CatalogRec[], byCore: Map<string, string[]>): Hit | null {
  return rankedHitsAt(s, i, recs, byCore)[0] || null
}

function uniqueCodesNear(s: string, hits: Hit[]): string[] {
  if (!hits.length) return []
  const topScore = scoreHit(s, hits[0])
  const out: string[] = []
  const seen = new Set<string>()
  for (const h of hits) {
    if (topScore - scoreHit(s, h) > 20) continue
    const k = h.code.toUpperCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(h.code)
  }
  return out
}

function isBareCoreSpan(span: string): boolean {
  return /^(\d+|[零〇一二两三四五六七八九十百幺]+)$/.test(String(span || ''))
}

function looksLikeCode(frag: string): boolean {
  const s = compactVoice(frag)
  return /[A-Za-z]{1,4}\d{2,}|\d{3,}/.test(s)
}

function noteMiss(run: string, missed: string[]) {
  const token = run.match(/([A-Za-z]{1,4}\d{2,}|\d{3,})/)
  const upper = token && token[1] ? token[1].toUpperCase() : ''
  if (!upper || missed.indexOf(upper) >= 0) return
  missed.push(upper)
}

/** 听到的货号和本店某一条完全一样，或数字尾号对得上，都算已经有这款。 */
export function catalogCoversSpokenCode(spoken: string, catalogCodes: string[]): boolean {
  const token = stripSpokenMarks(spoken).trim().toUpperCase()
  if (!token) return false
  const coreMatch = token.match(/(\d+)$/)
  const core = coreMatch ? coreMatch[1] : ''
  const stripped = core.replace(/^0+/, '')
  for (const raw of catalogCodes) {
    const code = String(raw || '').trim().toUpperCase()
    if (!code) continue
    if (code === token) return true
    if (!core) continue
    const tailMatch = code.match(/(\d+)$/)
    const tail = tailMatch ? tailMatch[1] : ''
    if (!tail) continue
    if (tail === core) return true
    const bare = tail.replace(/^0+/, '')
    if (stripped.length >= 2 && bare && bare === stripped) return true
  }
  return false
}

function readSkuTail(s: string, i: number): {
  color: string
  size: string
  qty: number
  qtySpoken: boolean
  end: number
} {
  let p = i
  while (p < s.length && '的是为'.includes(s.charAt(p))) p += 1
  if (s.startsWith('颜色', p)) p += 2
  const ahead = parseQtyToken(s, p)
  if (ahead && ahead.explicit) {
    return { color: '', size: '', qty: ahead.qty, qtySpoken: true, end: ahead.end }
  }
  let color = ''
  const colorMatch = s.slice(p).match(/^([\u4e00-\u9fa5]{1,4}色|[\u4e00-\u9fa5]{1,2})(?=[A-Za-z0-9]|件|个|条|双|份|套|尺码|$)/)
  if (colorMatch && !/^[零〇一二两三四五六七八九十百]+$/.test(colorMatch[1])) {
    color = colorMatch[1]
    p += color.length
  }
  if (s.startsWith('尺码', p)) p += 2
  let size = ''
  const sizeMatch = s.slice(p).match(/^(XXL|XL|XS|XXS|[23]XL|[SML]|均码)/i)
  if (sizeMatch) {
    const raw = sizeMatch[1]
    size = /[A-Za-z]/.test(raw) ? raw.toUpperCase() : raw
    p += sizeMatch[0].length
  }
  const qty = parseQtyToken(s, p)
  if (qty && qty.explicit) {
    return { color, size, qty: qty.qty, qtySpoken: true, end: qty.end }
  }
  return { color, size, qty: 0, qtySpoken: false, end: p }
}

function mergeItems(rows: AiItem[]): AiItem[] {
  const merged: Record<string, number> = {}
  const colors: Record<string, string> = {}
  const sizes: Record<string, string> = {}
  const order: string[] = []
  for (const it of rows) {
    const code = stripSpokenMarks(String(it.code || '')).trim()
    if (!code) continue
    let qty = Number(it.quantity)
    if (!Number.isFinite(qty) || qty === 0) qty = 1
    if (merged[code] == null) {
      merged[code] = qty
      order.push(code)
    } else {
      merged[code] += qty
    }
    if (it.color) colors[code] = it.color
    if (it.size) sizes[code] = it.size
  }
  return order.map((code) => ({
    code,
    quantity: merged[code],
    ...(colors[code] ? { color: colors[code] } : {}),
    ...(sizes[code] ? { size: sizes[code] } : {}),
  }))
}

/**
 * 识别结果后处理：长数字紧挨量词时，按本店货号把末尾 1 到 2 位拆成件数。
 * 没有货号可对时，只拆至少 5 位且末尾是 1 的串，避免把 8471件 拆成 847。
 */
export function unglueSpokenQty(text: string, catalogCodes: string[]): string {
  const recs = buildCatalog(catalogCodes)
  const exact = new Set(recs.map((rec) => rec.upper))
  const byCore = coreMap(recs)
  return String(text || '').replace(/(\d{3,10})([件个条双份套])/g, (all, digits: string, unit: string) => {
    const choices: Array<{ head: string; qty: number; score: number }> = []
    const fullHit = exact.has(digits) || (byCore.get(digits) || []).length > 0
    for (let qlen = 1; qlen <= 2 && qlen < digits.length; qlen += 1) {
      const head = digits.slice(0, -qlen)
      const qty = Number(digits.slice(-qlen))
      if (head.length < 2 || qty < 1 || qty > 99) continue
      const stripped = head.replace(/^0+/, '')
      const keys = stripped && stripped !== head ? [head, stripped] : [head]
      const known = keys.some((key) => exact.has(key) || (byCore.get(key) || []).length > 0)
      if (known) {
        choices.push({ head, qty, score: 400 + head.length })
        continue
      }
      if (!fullHit && qlen === 1 && qty === 1 && head.length >= 4) {
        choices.push({ head, qty, score: 100 + head.length })
      }
    }
    if (!choices.length) return all
    choices.sort((a, b) => b.score - a.score)
    const best = choices[0]
    return `${best.head} ${best.qty}${unit}`
  })
}

/**
 * 语音连读开单：按本店货号库从左到右切开「货号+件数」。
 * 不依赖 LLM，专门处理 A01两件B02三件 / A零一A零二 / 135两件045 等。
 */
export function extractVoiceSkuItems(text: string, catalogCodes: string[]): VoiceSkuResult {
  const recs = buildCatalog(catalogCodes)
  const byCore = coreMap(recs)
  const s = compactVoice(text)
  if (!s) return { items: [], leftover: false, aliases: [], ambiguous: [], missed: [] }

  const items: AiItem[] = []
  const aliases: VoiceSkuAlias[] = []
  const ambiguous: VoiceSkuAmbiguous[] = []
  const missed: string[] = []
  let i = 0
  let pending: QtyHit | null = null
  let leftover = false
  let skipRun = ''

  while (i < s.length) {
    const aheadQty = parseQtyToken(s, i)
    const gluedDigitQty = i > 0 && /[0-9]/.test(s[i - 1]) && /[0-9]/.test(s[i])
    if (aheadQty && aheadQty.explicit && !gluedDigitQty) {
      const after = bestHitAt(s, aheadQty.end, recs, byCore)
      if (after) {
        pending = aheadQty
        i = aheadQty.end
        skipRun = ''
        continue
      }
    }

    const ranked = rankedHitsAt(s, i, recs, byCore)
    const hit = ranked[0]
    if (!hit) {
      if (s[i] !== '|') skipRun += s[i]
      i += 1
      continue
    }
    if (looksLikeCode(skipRun)) {
      leftover = true
      noteMiss(skipRun, missed)
    }
    skipRun = ''

    let qty = pending && pending.qty > 0 ? pending.qty : 0
    let qtySpoken = !!(pending && pending.explicit && pending.qty > 0)
    pending = null
    let end = hit.end
    while (s[end] === '|') end += 1
    const tail = readSkuTail(s, end)
    end = tail.end
    if (!qtySpoken && tail.qtySpoken) {
      qty = tail.qty
      qtySpoken = true
    }
    if (!qtySpoken && !qty) qty = 1

    const spoken = s.slice(i, hit.end)
    const close = uniqueCodesNear(s, ranked)
    if (isBareCoreSpan(spoken) && close.length > 1) {
      ambiguous.push({
        spoken,
        codes: close.slice(0, 4),
        qty,
        color: tail.color,
        size: tail.size,
        qtySpoken,
      })
      i = end
      continue
    }
    items.push({
      code: hit.code,
      quantity: qty,
      ...(tail.color ? { color: tail.color } : {}),
      ...(tail.size ? { size: tail.size } : {}),
    })
    if (spoken && spoken !== hit.code && spoken.toUpperCase() !== hit.code.toUpperCase()) {
      aliases.push({ spoken, code: hit.code })
    }
    i = end
  }
  if (looksLikeCode(skipRun)) {
    leftover = true
    noteMiss(skipRun, missed)
  }
  return { items: mergeItems(items), leftover, aliases, ambiguous, missed }
}

/** 模型只拆原话。每一款再走本店商品库：对上一个就用，多个留下选择，一个都没有记在 missed。 */
export function settleModelVoiceItems(rows: AiItem[], catalogCodes: string[]) {
  const items: AiItem[] = []
  const ambiguous: VoiceSkuAmbiguous[] = []
  const missed: string[] = []
  const hands: AiItem[] = []
  for (const row of rows || []) {
    const code = stripSpokenMarks(String(row.code || '')).trim()
    if (!code) continue
    const qty = !Number(row.quantity) ? 1 : Math.abs(Number(row.quantity))
    const n = Number.isInteger(qty) ? String(qty) : String(qty)
    const color = String(row.color || '').trim()
    const size = String(row.size || '').trim()
    const local = extractVoiceSkuItems(`${code}|${color}${size}${n}件`, catalogCodes)
    const handCount = Number(row.hands) || 0
    if (handCount > 0 && local.items.length === 1 && !(local.ambiguous || []).length) {
      const hit = local.items[0]
      hands.push({
        code: hit.code,
        quantity: qty,
        ...(hit.color || color ? { color: hit.color || color } : {}),
        ...(hit.size || size ? { size: hit.size || size } : {}),
        hands: handCount,
      })
      continue
    }
    if (!local.items.length && !(local.ambiguous || []).length) {
      const heard = code.toUpperCase()
      if (missed.indexOf(heard) < 0) missed.push(heard)
      continue
    }
    items.push(...local.items)
    ambiguous.push(...(local.ambiguous || []))
    for (const miss of local.missed || []) {
      if (missed.indexOf(miss) < 0) missed.push(miss)
    }
  }
  return { items, ambiguous, missed, hands }
}

export function mergeVoiceSkuItems(localItems: AiItem[], llmItems: AiItem[]): AiItem[] {
  const local = mergeItems(localItems || [])
  const have = new Set(local.map((it) => it.code.toUpperCase()))
  const extra: AiItem[] = []
  for (const it of llmItems || []) {
    const code = stripSpokenMarks(String(it.code || '')).trim()
    if (!code || have.has(code.toUpperCase())) continue
    extra.push({
      code,
      quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
      ...(it.color ? { color: it.color } : {}),
      ...(it.size ? { size: it.size } : {}),
      ...(it.hands ? { hands: it.hands } : {}),
    })
  }
  return local.concat(extra)
}

/** 这句话里有货号或件数，适合整句交给大模型，不再用本地切开结果。 */
export function voiceNeedsSkuLlm(text: string): boolean {
  const s = String(text || '').replace(/\s+/g, '')
  if (!s) return false
  if (s.indexOf('货号') >= 0) return true
  if (/[A-Za-z]{1,6}\d{2,}/.test(s)) return true
  if (/\d{2,}/.test(s)) return true
  return /[零〇一二三四五六七八九幺两]{2,}/.test(s) && /[件个条双套份]/.test(s)
}

/** 给云端 LLM 的语音提示：原文 + 本地已切开的货号，要求只回 JSON 命令。 */
export function formatVoiceExtractHint(text: string, local: VoiceSkuResult): string {
  const raw = String(text || '').trim().replace(/\|/g, '，')
  const lines = (local.items || []).map((it) => `${it.code} ${it.quantity}件`)
  const parts = [
    '这是语音开单转写。请理解语义，只输出 JSON 命令，不要解释。',
    '服装货号多是字母加数字。84711件、7312件这类连读，先对商品库：能对上较短货号时，末尾1到2位是件数。库里有8471时，84711件是货号8471、件数1，不要把84711整段当成货号。字母前缀如LT、QS要保留。原文里的逗号、顿号是说话停顿，停顿前是货号，停顿后是件数，例如「077，1件」是货号077、件数1，不要粘成0771。items 里有哪几项就填哪几项，没听到的留空，不要编。code 是货号，不在商品库也照实填写。quantity 只填件数。color 是颜色，size 是尺码，hands 是手数不是件数。只说了货号就只填 code 和 quantity。说了颜色和尺码就再填 color、size。说了几手就填 hands，按这一款的一手配比分配，不要把手数写进 quantity。',
    'JSON：{"intent":"billing|stats|statement|customer|clearAll","customerName":"","from":"","to":"","unpaidOnly":false,"items":[{"code":"货号","quantity":1,"color":"","size":"","hands":0}],"actions":[]}',
    'intent：开单填货=billing；点了客户名的对账或欠款=statement；账单统计、订单统计和销量=stats；只点名客户=customer。没有点名客户的统计不要填 customerName。',
    '只有说出客户、用户或代理，紧跟着的才是客户名，填 customerName，actions 含 {"type":"setCustomer","name":"姓名"}。没说这几个字就不要填客户，按货号开单，不要返回不存在该客户。名单里没有也要返回这个姓名，不要改去打开代理列表。没带姓名的创建用户、创建客户、增加用户、增加客户、新增客户、新建客户、添加用户 = openPage，page=customerNew。编辑用户、编辑客户、修改用户、修改客户 = openPage，page=customers。客户名加历史价格 = openPage，page=customerPrices，code 填客户名，不要选进开单。',
    '先看这句话要做的事，不要拿整句去对客户名。说货号就填货号。说客户、用户或代理再跟姓名，才填客户。当前客户的历史价格 = openPage，page=customerPrices，code 填 @current，表示开单台上已经选中的客户，不要搜索「当前客户」。最近一个月账单统计、近一个月订单统计 = openPage，page=analytics，from 和 to 填最近30天的 YYYY-MM-DD，customerName 留空，打开账单统计首页，不要编客户，也不要当成对账单。',
    '清空、清除、清掉、清空一下、帮我清空、删除、删除全部、删除数据 = 清空当前开单台已填的全部数据。此时 intent 必须是 clearAll，actions 必须含 {"type":"clearAll"}，items 必须是 []。说「删除第N行」才是删一行。',
    '开退单、退单、打印退单、退单模式 = returnMode，只进入退单模式，不打印。开销售单 = saleMode，回到销售单。没说退单时默认是销售单。卡退单不是口令。退单打印 = returnPrint。请打印、打印、打印单子、单子打印、开单打印、货号打印 = print，句子里不能出现「退单」。',
    '说出今天、昨天、前天、明天、几月几号、某年某月某日，或选择时间、选择日期后再说日期 = 当前开单的日期栏。date 和 from 填 YYYY-MM-DD，actions 含 {"type":"setDate","date":"YYYY-MM-DD"}。只要这句话里有一个具体日期就要带上。从几月几日到几月几日这种范围不要填 setDate。',
    '其他 actions 的 type 仅允许 print,returnPrint,returnMode,saleMode,clearAll,save,saveAs,stockIn,stockOut,restore,openDeliver,dropLast,lastOrder,navigate,openPage,search,setPaid,setPicked,setShipped,changeLastQty,clearRow,deleteRow,setCustomer,setDate,openStatement,openProduct,fillProduct,saveProduct,addStock,importData,exportData,addCategory,openHelp。',
    '规定说法不要改写成开单：打开某客户几号的对账单=openStatement，from 和 to 都写这一天。添加产品=openProduct。添加货号并说价格或批发价=fillProduct，price 是售价，零售价或建议价是 retail，直接保存商品则 save 为 true。单独说直接保存商品=saveProduct。增加某货号库存=addStock。导入数据=importData，导出数据=exportData。增加分类=addCategory。增加客户并选中=setCustomer。怎么设置某功能=openHelp 且只填 page；怎么操作、教程、帮助=openHelp 且只填 lesson；只说帮助=openHelp。',
    '打开某个功能优先 openPage 或 navigate，不要改写成开单。page 只能是 stock,printSettings,printer,printTemplate,analytics,returns,customers,customerNew,customerPrices,recycle,team,teamData,cloudPrinter,subscription,shop,tracking,orderLookup,statementLookup,agentApply,category,supplyStyles,supplyFabric,supplyTrim,supplyFactory,supplySupplier,supplyCost,supplyAgents,supplySales,supplyMap。tab 只能是 home,products,orders,supply,mine。',
    '供应链：打开供应链 = navigate tab=supply。打开款式=supplyStyles，面料商/发面料=supplyFabric，辅料商/发辅料=supplyTrim，加工厂=supplyFactory，供应商=supplySupplier，成衣成本/算成本=supplyCost，代理=supplyAgents，销售统计/看销售=supplySales，供应链地图=supplyMap。看某货号成本或销售时 openPage 再带 code。云同步=subscription，店铺设置=shop，扫快递=tracking，回收站=recycle，团队=team，团队数据=teamData，云打印=cloudPrinter，退包=returns，打印模板=printTemplate，代理申请=agentApply。支付设置、支付宝、微信二维码、收款码、修改模板、调节打印模板也是 openPage，page=printTemplate。链接蓝牙、连接打印机、打印机连不上、打印不了、蓝牙、Wi-Fi 打印机是 openPage，page=printSettings。请打印、打印单子仍是 print。',
    `【语音原文】${raw}`,
  ]
  if (lines.length) {
    parts.push('【本地已按商品库切开，请核对并只补遗漏】')
    parts.push(lines.join('\n'))
  }
  return parts.join('\n')
}
