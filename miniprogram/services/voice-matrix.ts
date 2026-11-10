/** 语音色码 / 一手。只认这一款自己的颜色和尺码，不猜、不另开选择器。 */

import type { Product } from './team'
import { resolveHand } from './product-sku'
import { stripSpokenMarks } from './voice-router'

export type VoiceMatrixLine = {
  code: string
  color: string
  size: string
  qty: number
}

export type VoiceMatrixAsk = {
  kind: 'color' | 'size' | 'hand'
  message: string
  choices: string[]
}

export type VoiceMatrixResult = {
  used: boolean
  lines: VoiceMatrixLine[]
  ask: VoiceMatrixAsk | null
}

const CN: Record<string, number> = {
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

function compact(text: string): string {
  return String(text || '').replace(/[\s,，。．.、;；:：!！?？]/g, '')
}

function parseLeadingCount(s: string): { n: number; len: number } | null {
  const digits = s.match(/^(\d{1,3})/)
  if (digits) {
    const n = Number(digits[1])
    if (n >= 0 && n <= 999) return { n, len: digits[1].length }
  }
  const ten = s.match(/^([一二三四五六七八九两])?十([一二三四五六七八九])?/)
  if (ten && (ten[1] || ten[2] || s.startsWith('十'))) {
    const tens = ten[1] ? CN[ten[1]] : 1
    const ones = ten[2] ? CN[ten[2]] : 0
    if (tens >= 1 && tens <= 9) return { n: tens * 10 + ones, len: ten[0].length }
  }
  const one = s.slice(0, 1)
  if (CN[one] != null) return { n: CN[one], len: 1 }
  return null
}

function colorAliases(colors: string[]): Array<{ spoken: string; color: string }> {
  const rows: Array<{ spoken: string; color: string }> = []
  for (const raw of colors) {
    const color = raw.trim()
    if (!color) continue
    rows.push({ spoken: color, color })
    if (color.endsWith('色') && color.length > 1) {
      rows.push({ spoken: color.slice(0, -1), color })
    } else if (!color.endsWith('色')) {
      rows.push({ spoken: `${color}色`, color })
    }
  }
  rows.sort((a, b) => b.spoken.length - a.spoken.length)
  return rows
}

function matchColor(
  slice: string,
  colors: string[],
): { color: string; len: number; ambiguous: string[] } | null {
  const hits: Array<{ color: string; len: number }> = []
  for (const alias of colorAliases(colors)) {
    if (slice.startsWith(alias.spoken)) hits.push({ color: alias.color, len: alias.spoken.length })
  }
  if (!hits.length) return null
  const best = hits[0].len
  const top = hits.filter((hit) => hit.len === best)
  const uniq = [...new Set(top.map((hit) => hit.color))]
  if (uniq.length > 1) return { color: '', len: best, ambiguous: uniq.slice(0, 2) }
  return { color: uniq[0], len: best, ambiguous: [] }
}

function matchSize(slice: string, sizes: string[]): { size: string; len: number } | null {
  const list = sizes.slice().sort((a, b) => b.length - a.length)
  const lower = slice.toLowerCase()
  for (const raw of list) {
    const size = raw.trim()
    if (!size) continue
    if (lower.startsWith(size.toLowerCase())) return { size, len: size.length }
  }
  return null
}

const SPOKEN_DIGIT: Record<string, string[]> = {
  '0': ['0', '零', '〇'],
  '1': ['1', '一', '幺', '壹'],
  '2': ['2', '二', '两', '贰'],
  '3': ['3', '三', '叁'],
  '4': ['4', '四', '肆'],
  '5': ['5', '五', '伍'],
  '6': ['6', '六', '陆'],
  '7': ['7', '七', '柒'],
  '8': ['8', '八', '捌'],
  '9': ['9', '九', '玖'],
}

function matchSpokenCode(text: string, i: number, code: string): number {
  const raw = String(code || '').trim()
  if (!raw || i >= text.length) return -1
  const lit = raw.toLowerCase()
  if (text.toLowerCase().startsWith(lit, i)) return i + lit.length
  let p = i
  let k = 0
  const up = raw.toUpperCase()
  while (k < up.length && /[A-Z]/.test(up.charAt(k))) {
    if (p >= text.length || text.charAt(p).toUpperCase() !== up.charAt(k)) return -1
    p += 1
    k += 1
  }
  if (k >= up.length) return p > i ? p : -1
  while (k < up.length) {
    const ways = SPOKEN_DIGIT[up.charAt(k)]
    if (!ways) return -1
    const way = ways.find((item) => text.startsWith(item, p))
    if (!way) return -1
    p += way.length
    k += 1
  }
  return p > i ? p : -1
}

function findCodes(text: string, products: Product[]) {
  const list = products
    .map((product) => ({ product, code: String(product.code || '').trim() }))
    .filter((row) => row.code.length >= 2)
    .sort((a, b) => b.code.length - a.code.length)
  const hits: Array<{ code: string; index: number; len: number; product: Product }> = []
  let i = 0
  while (i < text.length) {
    let found: (typeof hits)[number] | null = null
    for (const row of list) {
      const end = matchSpokenCode(text, i, row.code)
      if (end > i) {
        found = { code: row.code, index: i, len: end - i, product: row.product }
        break
      }
    }
    if (found) {
      hits.push(found)
      i += found.len
    } else {
      i += 1
    }
  }
  return hits
}

function expandHand(product: Product, color: string, times: number): VoiceMatrixLine[] | 'nohand' {
  const sizes = (product.sizes || []).slice(0, 8)
  const hand = resolveHand(sizes, product.hand)
  if (!hand.some((qty) => qty > 0)) return 'nohand'
  const lines: VoiceMatrixLine[] = []
  sizes.forEach((size, index) => {
    const qty = hand[index] * times
    if (qty > 0) lines.push({ code: product.code, color, size, qty })
  })
  return lines
}

function mergeLines(rows: VoiceMatrixLine[]): VoiceMatrixLine[] {
  const out: VoiceMatrixLine[] = []
  for (const row of rows) {
    const hit = out.find((item) => item.code === row.code && item.color === row.color && item.size === row.size)
    if (hit) hit.qty += row.qty
    else out.push({ ...row })
  }
  return out
}

function askOf(kind: VoiceMatrixAsk['kind'], message: string, choices: string[]): VoiceMatrixAsk {
  return { kind, message, choices: choices.slice(0, 6) }
}

const BILL_DIGIT: Record<string, string> = {
  '0': '0', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  零: '0', 〇: '0', 一: '1', 幺: '1', 壹: '1', 二: '2', 贰: '2', 三: '3', 叁: '3',
  四: '4', 肆: '4', 五: '5', 伍: '5', 六: '6', 陆: '6', 七: '7', 柒: '7', 八: '8', 捌: '8', 九: '9', 玖: '9',
}

function lookupProduct(products: Product[], code: string): Product | null {
  const want = code.trim().toUpperCase()
  if (!want) return null
  return products.find((item) => String(item.code || '').trim().toUpperCase() === want) || null
}

function tailProducts(token: string, products: Product[]): Product[] {
  const coreMatch = token.toUpperCase().match(/(\d+)$/)
  const core = coreMatch ? coreMatch[1] : ''
  if (!core) return []
  const stripped = core.replace(/^0+/, '')
  const keys = new Set<string>([core])
  if (stripped.length >= 2 && stripped !== core) keys.add(stripped)
  const out: Product[] = []
  const seen = new Set<string>()
  for (const product of products) {
    const code = String(product.code || '').trim()
    const upper = code.toUpperCase()
    if (!code || seen.has(upper)) continue
    const tailMatch = upper.match(/(\d+)$/)
    const tail = tailMatch ? tailMatch[1] : ''
    if (!tail) continue
    const bare = tail.replace(/^0+/, '')
    if (!keys.has(tail) && !(bare.length >= 2 && keys.has(bare))) continue
    seen.add(upper)
    out.push(product)
  }
  return out
}

/** 货号后面的数字逐位换成阿拉伯数字。十、百、两这类中文数目不往货号上接。 */
function readBillCode(
  text: string,
  products: Product[],
  splitQty: boolean,
): { code: string; end: number; product: Product | null; qty: number | null } | null {
  let i = text.indexOf('货号')
  const colorAt = text.indexOf('颜色')
  const limit = colorAt >= 0 ? colorAt : text.length
  i = i >= 0 ? i + 2 : 0
  while (i < limit && '的是为'.includes(text.charAt(i))) i += 1
  while (i < limit && !/[A-Za-z0-9]/.test(text.charAt(i)) && !BILL_DIGIT[text.charAt(i)]) i += 1
  if (i >= limit) return null
  let token = ''
  let sawArab = false
  let sawCn = false
  while (i < text.length) {
    const ch = text.charAt(i)
    if (!sawArab && !sawCn && /[A-Za-z]/.test(ch)) {
      token += ch.toUpperCase()
      i += 1
      continue
    }
    if (/[0-9]/.test(ch)) {
      if (sawCn) break
      sawArab = true
      token += ch
      i += 1
      continue
    }
    const digit = BILL_DIGIT[ch]
    if (digit && !sawArab) {
      sawCn = true
      token += digit
      i += 1
      continue
    }
    break
  }
  if (token.length < 2 || !/\d/.test(token)) return null
  let code = token
  let product = lookupProduct(products, token)
  let qty: number | null = null
  if (!product && splitQty) {
    for (let qlen = 1; qlen <= 3 && qlen < token.length; qlen++) {
      const head = token.slice(0, token.length - qlen)
      if (head.length < 2) continue
      const n = Number(token.slice(token.length - qlen))
      if (!n) continue
      const hit = lookupProduct(products, head)
      if (!hit) continue
      product = hit
      code = String(hit.code || '').trim()
      qty = n
      break
    }
  } else if (product) {
    code = String(product.code || '').trim()
  }
  if (!product) {
    const tails = tailProducts(token, products)
    if (tails.length === 1) {
      product = tails[0]
      code = String(product.code || '').trim()
    }
  }
  return { code, end: i, product, qty }
}

function labelColor(spoken: string, product: Product | null): string {
  const text = spoken.trim()
  if (!text) return ''
  if (product) {
    const hit = matchColor(text, product.colors || [])
    if (hit && !hit.ambiguous.length && hit.color) return hit.color
  }
  return text.length > 12 ? text.slice(0, 12) : text
}

function labelSize(rest: string, product: Product | null): string {
  if (product) {
    const hit = matchSize(rest, product.sizes || [])
    if (hit) return hit.size
  }
  const matched = rest.match(/^([0-9]{1,2}X{0,2}L|[A-Za-z]{1,8}|[\u4e00-\u9fa5]{1,6})/)
  return matched ? matched[1] : ''
}

/** 「货号…颜色…尺码…」或「颜色…1手」。对不上本店货号时不写入听到的数字。 */
function parseLabeledBill(text: string, products: Product[]): VoiceMatrixResult | null {
  const hasColorWord = text.includes('颜色')
  const hasSizeWord = text.includes('尺码')
  const hasCodeWord = text.includes('货号')
  if (!hasColorWord && !hasSizeWord && !hasCodeWord) return null
  const colorWord = text.indexOf('颜色')
  const handMatch = colorWord >= 0 ? text.slice(colorWord).match(/(\d{1,3})手/) : null
  const wantsHand = hasColorWord && !!handMatch
  const wantsSize = hasSizeWord
  if (hasColorWord && !wantsSize && !wantsHand) return null
  if (!wantsHand && !wantsSize && !hasCodeWord) return null
  const read = readBillCode(text, products, !wantsHand)
  if (!read || !read.product) return null
  if (!wantsHand && !wantsSize) {
    if (read.product) return null
    const rest = text.slice(read.end)
    if (/[\u4e00-\u9fa5A-Za-z]/.test(rest)) return null
    return { used: true, lines: [{ code: read.code, color: '', size: '', qty: read.qty || 1 }], ask: null }
  }
  let rest = text.slice(read.end).replace(/^[的是为]+/, '')
  const leadQty = rest.match(/^(\d{1,3})(?=颜色|尺码|件|个|条|双|份|套)/)
  let qty = read.qty || 1
  if (leadQty && read.qty == null && !wantsHand) {
    qty = Number(leadQty[1]) || qty
    rest = rest.slice(leadQty[0].length)
  }
  let color = ''
  const colorAt = rest.indexOf('颜色')
  if (colorAt >= 0) {
    const body = rest.slice(colorAt + 2)
    let cut = body.length
    const sizeAt = body.indexOf('尺码')
    if (sizeAt >= 0 && sizeAt < cut) cut = sizeAt
    const handAt = body.match(/\d{1,3}手/)
    if (handAt && handAt.index != null && handAt.index < cut) cut = handAt.index
    color = labelColor(body.slice(0, cut).replace(/^[的]+|[的]+$/g, ''), read.product)
    rest = body.slice(cut)
  }
  if (wantsHand) {
    const times = Number(handMatch?.[1] || 1) || 1
    const product = read.product
    const colors = (product?.colors || []).filter(Boolean)
    const sizes = product?.sizes || []
    if (product && colors.length && sizes.length) {
      if (!color && colors.length > 1) {
        return { used: true, lines: [], ask: askOf('color', `${product.code} 哪个颜色？`, colors.slice(0, 12)) }
      }
      const expanded = expandHand(product, color || colors[0], times)
      if (expanded === 'nohand') {
        return { used: true, lines: [], ask: askOf('hand', '这款还没有一手配比', []) }
      }
      return { used: true, lines: mergeLines(expanded), ask: null }
    }
    return { used: true, lines: [{ code: read.code, color, size: '', qty: times }], ask: null }
  }
  rest = rest.replace(/^尺码/, '').replace(/^[的是为]+/, '')
  const size = labelSize(rest, read.product)
  if (!size && !color) {
    if (read.product) return null
    return { used: true, lines: [{ code: read.code, color: '', size: '', qty }], ask: null }
  }
  if (size && read.qty == null && !leadQty) {
    const after = matchSize(rest, [size])
    const tail = after ? rest.slice(after.len) : rest
    const trailing = tail.match(/^(\d{1,3})/)
    if (trailing && Number(trailing[1]) > 0) qty = Number(trailing[1])
  }
  const colors = (read.product?.colors || []).filter(Boolean)
  if (!color && colors.length > 1) {
    return { used: true, lines: [], ask: askOf('color', `${read.code} 哪个颜色？`, colors.slice(0, 12)) }
  }
  if (!color && colors.length) color = colors[0]
  return { used: true, lines: [{ code: read.code, color, size, qty }], ask: null }
}

function llmPieces(quantity: number): number {
  if (!quantity) return 1
  const n = Math.round(quantity)
  return n === 0 ? 1 : Math.abs(n)
}

/** 选中货号后，颜色和尺码对得上这款才留下。说出的件数不改成 1。 */
export function settleSpokenSku(
  code: string,
  product: Product | null | undefined,
  color: string,
  size: string,
  qty: number,
  qtySpoken: boolean,
): VoiceMatrixLine {
  let useColor = ''
  let useSize = ''
  if (product && color.trim()) {
    const hit = matchColor(color.trim(), product.colors || [])
    if (hit && !hit.ambiguous.length && hit.color) useColor = hit.color
  }
  if (product && size.trim()) {
    const hit = matchSize(size.trim(), product.sizes || [])
    if (hit) useSize = hit.size
  }
  const pieces = qtySpoken && qty > 0 ? Math.abs(Math.round(qty)) : llmPieces(qty)
  return { code, color: useColor, size: useSize, qty: pieces }
}

/** 大模型返回了哪几项就生成哪几项。手数按该货号的一手配比展开；库里没有的货号仍写入。 */
export function linesFromLlmItems(
  items: Array<{ code?: string; quantity?: number; color?: string; size?: string; hands?: number }>,
  products: Product[],
): VoiceMatrixLine[] {
  const lines: VoiceMatrixLine[] = []
  for (const item of items || []) {
    const code = stripSpokenMarks(String(item.code || '')).trim()
    if (!code) continue
    const product = lookupProduct(products, code)
    const color = String(item.color || '').trim() ? labelColor(String(item.color || '').trim(), product) : ''
    const size = String(item.size || '').trim() ? labelSize(String(item.size || '').trim(), product) : ''
    const hands = Number(item.hands) || 0
    if (hands > 0 && !size && product && (product.sizes || []).length) {
      const expanded = expandHand(product, color, hands)
      if (expanded !== 'nohand' && expanded.length) {
        lines.push(...expanded)
        continue
      }
    }
    const qty = hands > 0 && Math.abs(Number(item.quantity) || 0) <= 1 ? hands : llmPieces(Number(item.quantity) || 0)
    lines.push({ code, color, size, qty })
  }
  return mergeLines(lines)
}

function withAsk(lines: VoiceMatrixLine[], ask: VoiceMatrixAsk): VoiceMatrixResult {
  return { used: true, lines: mergeLines(lines), ask }
}

function finishQty(
  rest: string,
  product: Product,
  color: string,
  size: string,
  colors: string[],
  sizes: string[],
  spanCount: number,
  nextAnswer: (ask: VoiceMatrixAsk) => string,
): { rest: string; lines: VoiceMatrixLine[]; moved: boolean; ask: VoiceMatrixAsk | null } {
  let useColor = color
  let useSize = size
  let step = takeQty(rest, product, useColor, useSize, colors, sizes)
  let hops = 0
  while (step.ask && hops++ < 4) {
    const ask = step.ask
    if (spanCount > 1 && !useColor && !useSize && ask.kind !== 'hand') {
      const count = parseLeadingCount(rest)
      const unit = count && rest.length > count.len ? rest.charAt(count.len) : ''
      if (count && unit && '件个条双份套'.includes(unit)) {
        return {
          rest: rest.slice(count.len + 1),
          lines: [{
            code: product.code,
            color: '',
            size: '',
            qty: count.n > 0 ? count.n : 1,
          }],
          moved: true,
          ask: null,
        }
      }
    }
    const answer = nextAnswer(ask)
    if (!answer) return { rest, lines: [], moved: true, ask }
    if (ask.kind === 'color') useColor = answer
    else if (ask.kind === 'size') useSize = answer
    else return { rest, lines: [], moved: true, ask }
    step = takeQty(rest, product, useColor, useSize, colors, sizes)
  }
  return step
}

/** 问到一半时，前面已经确定的行留在 lines 里。answers 按提问顺序消掉已经选过的颜色或尺码。 */
export function parseVoiceMatrix(
  text: string,
  products: Product[],
  prefer = '',
  answers: string[] = [],
): VoiceMatrixResult {
  let compactText = compact(text)
  const labeled = parseLabeledBill(compactText, products)
  if (labeled) return labeled
  compactText = compactText.replace(/货号|颜色|尺码/g, '')
  const spans = findCodes(compactText, products)
  if (!spans.length) return { used: false, lines: [], ask: null }
  const lines: VoiceMatrixLine[] = []
  let used = false
  const queue = (answers.length ? answers : prefer.trim() ? [prefer.trim()] : [])
    .map((item) => item.trim())
    .filter(Boolean)
  let cursor = 0
  const nextAnswer = (ask: VoiceMatrixAsk) => {
    if (cursor >= queue.length) return ''
    const answer = queue[cursor]
    if (!ask.choices.includes(answer)) return ''
    cursor += 1
    return answer
  }

  for (let index = 0; index < spans.length; index++) {
    const span = spans[index]
    const end = index + 1 < spans.length ? spans[index + 1].index : compactText.length
    let rest = compactText.slice(span.index + span.len, end)
    const product = span.product
    const colors = (product.colors || []).map((item) => item.trim()).filter(Boolean).slice(0, 12)
    const sizes = (product.sizes || []).map((item) => item.trim()).filter(Boolean).slice(0, 8)
    const sku = !!(product.hasSku && colors.length && sizes.length)
    if (!sku || !rest) continue
    let guard = 0
    while (rest && guard++ < 12) {
      rest = rest.replace(/^[的要来和跟与]+/, '')
      if (!rest) break
      const colorHit = matchColor(rest, colors)
      if (colorHit && colorHit.ambiguous.length) {
        const pending = askOf('color', `${colorHit.ambiguous.join(' 还是 ')}？`, colorHit.ambiguous)
        const answer = nextAnswer(pending)
        if (!answer) return withAsk(lines, pending)
        rest = rest.slice(colorHit.len)
        used = true
        const step = finishQty(rest, product, answer, '', colors, sizes, spans.length, nextAnswer)
        if (step.ask) return withAsk(lines, step.ask)
        if (!step.moved) break
        lines.push(...step.lines)
        rest = step.rest
        continue
      }
      let color = ''
      if (colorHit && colorHit.color) {
        color = colorHit.color
        rest = rest.slice(colorHit.len)
        used = true
      }
      const sizeHit = matchSize(rest, sizes)
      let size = ''
      if (sizeHit) {
        size = sizeHit.size
        rest = rest.slice(sizeHit.len)
        used = true
      }
      const step = finishQty(rest, product, color, size, colors, sizes, spans.length, nextAnswer)
      if (step.ask) return withAsk(lines, step.ask)
      if (!step.moved) break
      used = true
      lines.push(...step.lines)
      rest = step.rest
    }
  }

  if (!used) return { used: false, lines: [], ask: null }
  return { used: true, lines: mergeLines(lines), ask: null }
}

function takeQty(
  rest: string,
  product: Product,
  color: string,
  size: string,
  colors: string[],
  sizes: string[],
): { rest: string; lines: VoiceMatrixLine[]; moved: boolean; ask: VoiceMatrixAsk | null } {
  const count = parseLeadingCount(rest)
  if (!count) return { rest, lines: [], moved: false, ask: null }
  const unit = rest.slice(count.len, count.len + 1)
  if (unit === '手') {
    if (!color && colors.length > 1) {
      return {
        rest,
        lines: [],
        moved: true,
        ask: askOf('color', `${product.code} 哪个颜色？`, colors),
      }
    }
    const useColor = color || colors[0] || ''
    const expanded = expandHand(product, useColor, count.n > 0 ? count.n : 1)
    if (expanded === 'nohand') {
      return {
        rest,
        lines: [],
        moved: true,
        ask: askOf('hand', '这款还没有一手配比', []),
      }
    }
    return { rest: rest.slice(count.len + 1), lines: expanded, moved: true, ask: null }
  }
  if (/[件个条双份套]/.test(unit)) {
    const qty = count.n > 0 ? count.n : 1
    if (!color && colors.length > 1) {
      return {
        rest,
        lines: [],
        moved: true,
        ask: askOf('color', `${product.code} 哪个颜色？`, colors),
      }
    }
    if (!size && sizes.length > 1) {
      return {
        rest,
        lines: [],
        moved: true,
        ask: askOf('size', `${color || product.code} 哪个尺码？`, sizes),
      }
    }
    return {
      rest: rest.slice(count.len + 1),
      lines: [{
        code: product.code,
        color: color || colors[0] || '',
        size: size || sizes[0] || '',
        qty,
      }],
      moved: true,
      ask: null,
    }
  }
  return { rest, lines: [], moved: false, ask: null }
}

const BILL_SIZES = ['XXXL', 'XXL', 'XXS', '6XL', '5XL', '4XL', '3XL', '2XL', 'XL', 'XS', 'L', 'M', 'S', 'F']
const BILL_COLORS = [
  '藏青色', '咖啡色', '军绿色', '酒红色', '卡其色', '杏色', '驼色', '花色', '条纹',
  '黑色', '白色', '红色', '蓝色', '绿色', '黄色', '灰色', '粉色', '紫色', '棕色', '橙色', '米色',
  '藏青', '咖啡', '军绿', '酒红', '卡其', '黑', '白', '红', '蓝', '绿', '黄', '灰', '粉', '紫', '棕', '橙', '米', '花',
]

function billSizeToken(token: string): boolean {
  return /^(XXXL|XXL|XXS|XS|[2-9]XL|XL|L|M|S|F)$/i.test(token)
}

function normalizeSkuBill(text: string): string {
  return String(text || '')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/\r/g, '\n')
    .replace(/[×✕✖＊*]/g, '×')
    .replace(/([A-Za-z0-9])\s*[xX]\s*(?=\d)/g, '$1×')
}

function sizeThenQty(text: string): boolean {
  const lower = text.toLowerCase()
  for (const size of BILL_SIZES) {
    if (!lower.startsWith(size.toLowerCase())) continue
    const rest = text.slice(size.length).replace(/^\s+/, '')
    if (/^[×xX*＊]\s*\d/.test(rest) || /^\d{1,3}[件个条双份套]/.test(rest)) return true
  }
  return false
}

function readTimesQty(text: string, index: number): { n: number; end: number } | null {
  let p = index
  while (p < text.length && /\s/.test(text.charAt(p))) p += 1
  if (p >= text.length) return null
  const mark = text.charAt(p)
  let body = ''
  if ('×xX*＊'.includes(mark)) {
    p += 1
    while (p < text.length && /\s/.test(text.charAt(p))) p += 1
    const digits = text.slice(p).match(/^(\d{1,4})/)
    if (!digits) return null
    body = digits[1]
  } else {
    const piece = text.slice(p).match(/^(\d{1,4})[件个条双份套]/)
    if (!piece) return null
    body = piece[1]
    p += 1
  }
  let end = p + body.length
  while (body.length > 1 && sizeThenQty(body.slice(-1) + text.slice(end))) {
    body = body.slice(0, -1)
    end -= 1
  }
  const n = Number(body)
  if (!n) return null
  return { n, end }
}

function readBillSize(
  text: string,
  index: number,
  product: Product | null,
): { size: string; end: number } | null {
  const slice = text.slice(index)
  if (product) {
    const hit = matchSize(slice, product.sizes || [])
    if (hit && readTimesQty(text, index + hit.len)) return { size: hit.size, end: index + hit.len }
  }
  const lower = slice.toLowerCase()
  for (const size of BILL_SIZES) {
    if (!lower.startsWith(size.toLowerCase())) continue
    const end = index + size.length
    if (readTimesQty(text, end)) return { size, end }
  }
  return null
}

function readBillColor(
  text: string,
  index: number,
  product: Product | null,
): { color: string; end: number } | null {
  if (readBillSize(text, index, product)) return null
  const slice = text.slice(index)
  if (product) {
    const hit = matchColor(slice, product.colors || [])
    if (hit && !hit.ambiguous.length && hit.color) return { color: hit.color, end: index + hit.len }
  }
  for (const word of BILL_COLORS) {
    if (!slice.startsWith(word)) continue
    return { color: product ? labelColor(word, product) : word, end: index + word.length }
  }
  return null
}

function readBillSkuCode(
  text: string,
  index: number,
  products: Product[],
): { code: string; end: number; product: Product | null } | null {
  const list = products
    .map((product) => ({ product, code: String(product.code || '').trim() }))
    .filter((row) => row.code.length >= 2)
    .sort((a, b) => b.code.length - a.code.length)
  for (const row of list) {
    const end = matchSpokenCode(text, index, row.code)
    if (end <= index) continue
    const token = text.slice(index, end)
    if (billSizeToken(token) && readTimesQty(text, end)) continue
    return { code: String(row.product.code || '').trim(), end, product: row.product }
  }
  const matched = text.slice(index).match(/^[A-Za-z]{1,10}\d{2,10}[A-Za-z0-9]*|^\d{3,10}/)
  if (!matched || billSizeToken(matched[0])) return null
  const product = lookupProduct(products, matched[0])
  return {
    code: product ? String(product.code || '').trim() : matched[0].toUpperCase(),
    end: index + matched[0].length,
    product,
  }
}

function soleColor(product: Product | null): string {
  const colors = (product?.colors || []).map((item) => item.trim()).filter(Boolean)
  return colors.length === 1 ? colors[0] : ''
}

/** 开单文字里的「货号 颜色 尺码×件数」。多个货号各自展开成色码行，填表逻辑与语音相同。 */
export function parseWrittenSkuBill(text: string, products: Product[]): VoiceMatrixLine[] {
  const src = normalizeSkuBill(text)
  const lines: VoiceMatrixLine[] = []
  let i = 0
  while (i < src.length) {
    const start = i
    while (i < src.length && /[\s,，。、;；\n]/.test(src.charAt(i))) i += 1
    if (i >= src.length) break
    const code = readBillSkuCode(src, i, products)
    if (!code) {
      i = Math.max(start + 1, i + 1)
      continue
    }
    i = code.end
    let color = ''
    let guard = 0
    while (i < src.length && guard++ < 30) {
      while (i < src.length && /[\s,，、]/.test(src.charAt(i))) i += 1
      if (i >= src.length) break
      const sizeHit = readBillSize(src, i, code.product)
      if (sizeHit) {
        const qty = readTimesQty(src, sizeHit.end)
        if (!qty) break
        lines.push({
          code: code.code,
          color: color || soleColor(code.product),
          size: sizeHit.size,
          qty: qty.n,
        })
        i = qty.end
        continue
      }
      const colorHit = readBillColor(src, i, code.product)
      if (colorHit) {
        color = colorHit.color
        i = colorHit.end
        continue
      }
      break
    }
  }
  return mergeLines(lines)
}
