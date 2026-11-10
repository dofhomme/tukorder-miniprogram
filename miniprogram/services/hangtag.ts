import { defaultHandQty, normalizeHand, resolveHand } from './product-sku'

/** 吊牌 / 色卡 OCR 文字 → 商品编辑预填。不写库。 */
export interface HangtagDraft {
  code: string
  colors: string[]
  sizes: string[]
  hand: number[]
  price: string
  retail: string
}

const COLOR_WORD =
  /卡其|藏青|军绿|酒红|杏色|焦糖|咖啡|米黄|浅灰|深灰|黑色|白色|红色|蓝色|黄色|绿色|灰色|粉色|紫色|橙色|棕色|青色|米色|咖色|黑|白|红|蓝|黄|绿|灰|粉|紫|橙|棕|青|米|咖/g

const SIZE_TOKEN = /XXL|XL|XXS|XS|S|M|L|均码/gi

function money(raw: string): string {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 999999) return ''
  return String(Math.round(n * 100) / 100)
}

function stemColor(name: string): string {
  const s = name.trim()
  if (s.length > 1 && s.endsWith('色')) return s.slice(0, -1)
  return s
}

function pushColor(out: string[], name: string) {
  const n = stemColor(name)
  if (!n || n.length > 6 || out.includes(n) || out.length >= 12) return
  out.push(n)
}

function colorsFrom(raw: string): string[] {
  const out: string[] = []
  const parts = raw.split(/[\s,，、/|]+/).map((s) => s.trim()).filter(Boolean)
  for (const part of parts) {
    const words = part.match(COLOR_WORD) || []
    if (words.length) words.forEach((w) => pushColor(out, w))
    else if (/^[\u4e00-\u9fa5]{1,4}$/.test(part)) pushColor(out, part)
  }
  return out
}

function sizesFrom(raw: string): string[] {
  const out: string[] = []
  const re = new RegExp(SIZE_TOKEN.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const token = m[0].toUpperCase() === '均码' ? '均码' : m[0].toUpperCase()
    if (!out.includes(token) && out.length < 8) out.push(token)
  }
  return out
}

function ratioFrom(raw: string): number[] {
  const mapped = raw
    .replace(/两/g, '2')
    .replace(/一/g, '1')
    .replace(/二/g, '2')
    .replace(/三/g, '3')
    .replace(/四/g, '4')
    .replace(/五/g, '5')
    .replace(/六/g, '6')
    .replace(/七/g, '7')
    .replace(/八/g, '8')
    .replace(/九/g, '9')
    .replace(/十/g, '10')
  const nums = mapped.match(/\d+/g) || []
  return nums
    .map((n) => Math.max(0, Math.min(20, parseInt(n, 10) || 0)))
    .slice(0, 8)
}

function alignHand(sizes: string[], ratio: number[]): number[] {
  if (!sizes.length) return []
  if (!ratio.length) return resolveHand(sizes, [])
  const raw = sizes.map((size, i) =>
    i < ratio.length ? ratio[i] : defaultHandQty(size),
  )
  return normalizeHand(sizes, raw)
}

export function parseHangtagText(text: string): HangtagDraft {
  const src = String(text || '').replace(/\r/g, '')
  const codeMatch = src.match(
    /(?:货号|款号|型号|货品编号)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9._-]{1,24})/,
  )
  const colorLine = src.match(/(?:颜色|色号|色卡)\s*[:：]\s*([^\n]{1,80})/)
  const sizeLine = src.match(/(?:尺码|尺寸|码数)\s*[:：]\s*([^\n]{1,60})/)
  const ratioLine = src.match(
    /(?:配比|一手|比例)\s*[:：]?\s*([0-9一二两三四五六七八九十:：/、，,\s]{3,40})/,
  )
  const priceLine = src.match(
    /(?:批发价|拿货价|单价|价格)\s*[:：]?\s*(\d+(?:\.\d{1,2})?)/,
  )
  const retailLine = src.match(
    /(?:零售价|吊牌价|建议零售)\s*[:：]?\s*(\d+(?:\.\d{1,2})?)/,
  )
  let colors = colorLine ? colorsFrom(colorLine[1]) : []
  if (!colors.length) {
    const loose = colorsFrom(src)
    if (loose.length >= 2) colors = loose
  }
  let sizes = sizeLine ? sizesFrom(sizeLine[1]) : []
  if (!sizes.length) {
    const line = src
      .split('\n')
      .map((row) => row.trim())
      .find((row) => sizesFrom(row).length >= 2 && row.length <= 40)
    if (line) sizes = sizesFrom(line)
  }
  return {
    code: codeMatch ? codeMatch[1] : '',
    colors,
    sizes,
    hand: alignHand(sizes, ratioLine ? ratioFrom(ratioLine[1]) : []),
    price: priceLine ? money(priceLine[1]) : '',
    retail: retailLine ? money(retailLine[1]) : '',
  }
}

export function hangtagHasMatrix(draft: HangtagDraft): boolean {
  return draft.colors.length > 0 && draft.sizes.length > 0
}
