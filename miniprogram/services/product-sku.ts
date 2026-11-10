/** 商品级可选颜色×尺码 SKU。不开则仍是一货号一库存。 */

import type { CartItem, Product } from './team'

export interface ProductSkuCell {
  color: string
  size: string
  stock: number | null
  barcode?: string | null
}

const SKU_MARK = '_sku'

/** 新开颜色尺码时的默认尺码。一手默认每个尺码 1 件。 */
export const DEFAULT_HAND_SIZES = ['S', 'M', 'L', 'XL', 'XXL']

export function defaultHandQty(size: string): number {
  return String(size || '').trim() ? 1 : 0
}

/** 一手配比跟尺码对齐。没有配比的旧款读成空，不报错。 */
export function normalizeHand(sizes: string[], hand?: number[] | null): number[] {
  const count = Math.min(sizes.length, 8)
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const raw = hand && hand[i]
    const value = Math.round(Number(raw))
    out.push(Number.isFinite(value) ? Math.max(0, Math.min(20, value)) : 0)
  }
  return out
}

/** 没单独保存配比时，每个尺码默认 1 件。已保存的配比优先。 */
export function resolveHand(sizes: string[], hand?: number[] | null): number[] {
  const saved = normalizeHand(sizes, hand)
  if (saved.some((qty) => qty > 0)) return saved
  const list = sizes.slice(0, 8)
  if (list.length && list.every((size) => defaultHandQty(size) > 0)) {
    return list.map((size) => defaultHandQty(size))
  }
  return saved
}

export function realignHand(oldSizes: string[], oldHand: number[] | undefined, sizes: string[]): number[] {
  const prev = normalizeHand(oldSizes, oldHand)
  return normalizeHand(
    sizes,
    sizes.map((size) => {
      const index = oldSizes.indexOf(size)
      return index >= 0 ? prev[index] || 0 : defaultHandQty(size)
    }),
  )
}

export function skuSpec(color?: string, size?: string): string {
  const c = String(color || '').trim()
  const s = String(size || '').trim()
  if (c && s) return `${c} / ${s}`
  return c || s
}

/** 订单明细里的颜色尺码。字段空了就从规格「色 / 码」拆回来。 */
export function colorSizeFromItem(raw: {
  color?: string
  size?: string
  spec?: string
}): { color: string; size: string; spec: string } {
  let color = String(raw.color || '').trim()
  let size = String(raw.size || '').trim()
  const specIn = String(raw.spec || '').trim()
  if ((!color || !size) && /[/|｜]/.test(specIn)) {
    const parts = specIn.split(/\s*[/|｜]\s*/).map((s) => s.trim()).filter(Boolean)
    if (!color && parts.length) color = parts[0]
    if (!size && parts.length > 1) size = parts.slice(1).join(' / ')
  }
  return { color, size, spec: specIn || skuSpec(color, size) }
}

export function isSkuProduct(p?: Product | null): boolean {
  if (!p || !p.hasSku) return false
  return !!(p.colors && p.colors.length && p.sizes && p.sizes.length)
}

export function displayStock(p: Product): number | null {
  if (!isSkuProduct(p)) {
    return p.stock == null ? null : Number(p.stock)
  }
  let any = false
  let sum = 0
  for (const cell of p.skus || []) {
    if (cell.stock == null || cell.stock === undefined) continue
    const n = Number(cell.stock)
    if (!Number.isFinite(n)) continue
    any = true
    sum += n
  }
  if (any) return sum
  if (p.stock == null || p.stock === undefined) return null
  const total = Number(p.stock)
  return Number.isFinite(total) ? total : null
}

export function skuHint(p: Product): string {
  if (!isSkuProduct(p)) return ''
  return `${p.colors!.length}色 ${p.sizes!.length}码`
}

export function findSkuCell(p: Product, color: string, size: string): ProductSkuCell | null {
  const c = color.trim()
  const s = size.trim()
  return (p.skus || []).find((x) => x.color === c && x.size === s) || null
}

export function rebuildSkuMatrix(
  colors: string[],
  sizes: string[],
  prev: ProductSkuCell[] = [],
): ProductSkuCell[] {
  const map = new Map(prev.map((x) => [`${x.color}\0${x.size}`, x]))
  const out: ProductSkuCell[] = []
  for (const color of colors) {
    for (const size of sizes) {
      const old = map.get(`${color}\0${size}`)
      out.push({
        color,
        size,
        stock: old && old.stock != null && Number.isFinite(Number(old.stock)) ? Number(old.stock) : null,
        barcode: old?.barcode || null,
      })
    }
  }
  return out
}

function cleanTags(list?: string[] | null): string[] {
  return (list || []).map((item) => String(item || '').trim()).filter(Boolean)
}

/**
 * 关联货号是同一款。改其中一个，把价格、分类、颜色尺码和一手配比抄到其他货号。
 * 货号、品名（品名就是货号时）、库存、条码和图片仍各管各的。
 */
export function copyLinkedProductAttrs(prev: Product, src: Product): Product {
  const name = String(src.name || '').trim()
  const shareName = !!name && name !== String(src.code || '').trim()
  const colors = cleanTags(src.colors).slice(0, 12)
  const sizes = cleanTags(src.sizes).slice(0, 8)
  const hasSku = !!src.hasSku && colors.length > 0 && sizes.length > 0
  const next: Product = {
    ...prev,
    name: shareName ? name : prev.name,
    unit: String(src.unit || '').trim() || prev.unit,
    price: Number(src.price) || 0,
    cost: src.cost == null || src.cost === undefined ? null : Number(src.cost),
    category: String(src.category || '').trim() || null,
    countInStats: src.countInStats !== false,
    suggestedRetailPrice:
      src.suggestedRetailPrice != null && Number(src.suggestedRetailPrice) > 0
        ? Number(src.suggestedRetailPrice)
        : null,
    hasSku,
    colors: hasSku ? colors : [],
    sizes: hasSku ? sizes : [],
    hand: hasSku ? normalizeHand(sizes, src.hand) : [],
    skus: [],
  }
  if (!hasSku) return next
  const skus = rebuildSkuMatrix(colors, sizes, prev.skus || [])
  next.skus = skus
  next.stock = skus.some((cell) => cell.stock != null && Number.isFinite(Number(cell.stock)))
    ? displayStock(next)
    : prev.stock
  return next
}

function cellStockNum(cell: { stock?: number | null }): number | null {
  if (cell.stock == null) return null
  const n = Number(cell.stock)
  return Number.isFinite(n) ? n : null
}

function cellsHaveStock(p: Product): boolean {
  return (p.skus || []).some((cell) => cellStockNum(cell) != null)
}

/** 没指定颜色尺码时，按格子把变动摊进去，合计才会跟着变。 */
function spreadSkuDelta(p: Product, delta: number): Product {
  const colors = p.colors || []
  const sizes = p.sizes || []
  const skus = rebuildSkuMatrix(colors, sizes, p.skus || []).map((cell) => ({ ...cell }))
  const tracked = skus
    .map((cell, index) => ({ index, n: cellStockNum(cell) }))
    .filter((row) => row.n != null)
  if (!tracked.length) {
    const before = p.stock == null ? 0 : Number(p.stock)
    return { ...p, stock: before + delta }
  }
  if (delta > 0) {
    const row = tracked[0]
    skus[row.index] = { ...skus[row.index], stock: (row.n as number) + delta }
  } else {
    let left = -delta
    for (let k = 0; k < tracked.length && left > 0; k++) {
      const row = tracked[k]
      const before = row.n as number
      const last = k === tracked.length - 1
      const use = last ? left : Math.min(Math.max(before, 0), left)
      skus[row.index] = { ...skus[row.index], stock: before - use }
      left -= use
    }
  }
  const next: Product = { ...p, hasSku: true, colors, sizes, skus }
  next.stock = displayStock(next)
  return next
}

export function applySkuStock(
  p: Product,
  delta: number,
  color?: string,
  size?: string,
): Product {
  const c = String(color || '').trim()
  const s = String(size || '').trim()
  if (!isSkuProduct(p)) {
    const before = p.stock == null ? 0 : Number(p.stock)
    return { ...p, stock: before + delta }
  }
  if (!c || !s) {
    if (cellsHaveStock(p)) return spreadSkuDelta(p, delta)
    const before = p.stock == null ? 0 : Number(p.stock)
    return { ...p, stock: before + delta }
  }
  const colors = p.colors || []
  const sizes = p.sizes || []
  const skus = rebuildSkuMatrix(colors, sizes, p.skus || []).map((cell) => {
    if (cell.color !== c || cell.size !== s) return cell
    const before = cellStockNum(cell) ?? 0
    return { ...cell, stock: before + delta }
  })
  const next: Product = { ...p, hasSku: true, colors, sizes, skus }
  next.stock = displayStock(next)
  return next
}

function tracksStock(p: Product): boolean {
  if (p.stock != null && Number.isFinite(Number(p.stock))) return true
  return cellsHaveStock(p)
}

/** 按订单行调整库存。有颜色尺码就改对应格子，否则改总数。退单数量为负时加回。 */
export function applyItemsToCatalog(
  products: Product[],
  items: CartItem[],
  isReturn: boolean,
): Product[] {
  const map = new Map(products.map((p) => [p.code, { ...p }]))
  for (const it of items) {
    const code = String(it.productCode || '').trim()
    const p = map.get(code)
    if (!p || !tracksStock(p)) continue
    let qty = Number(it.quantity || 0)
    if (!qty) continue
    if (isReturn && qty > 0) qty = -Math.abs(qty)
    const delta = -qty
    const spec = colorSizeFromItem(it)
    map.set(code, applySkuStock(p, delta, spec.color, spec.size))
  }
  return Array.from(map.values())
}

function parseSkuRemark(raw: unknown): {
  sku?: Record<string, unknown>
  text: string
  suggestedRetailPrice?: number
} {
  const s = String(raw || '').trim()
  if (!s || s[0] !== '{') return { text: s }
  try {
    const o = JSON.parse(s) as Record<string, unknown>
    if (!o || typeof o !== 'object') return { text: s }
    const retail = o.suggestedRetailPrice
    const hasSku = !!o[SKU_MARK]
    if (!hasSku && retail == null && o.text == null) return { text: s }
    return {
      sku: hasSku ? (o[SKU_MARK] as Record<string, unknown>) : undefined,
      text: String(o.text || ''),
      suggestedRetailPrice:
        retail == null || retail === ''
          ? undefined
          : Number(retail),
    }
  } catch {
    return { text: s }
  }
}

export function hydrateProduct(p: Product): Product {
  const parsed = parseSkuRemark(p.remark)
  const blob = parsed.sku
  const retail =
    parsed.suggestedRetailPrice != null && Number.isFinite(parsed.suggestedRetailPrice)
      ? parsed.suggestedRetailPrice
      : p.suggestedRetailPrice
  if (!blob) {
    return {
      ...p,
      remark: parsed.text || p.remark || null,
      hasSku: !!p.hasSku,
      colors: p.colors || [],
      sizes: p.sizes || [],
      skus: p.skus || [],
      suggestedRetailPrice: retail,
    }
  }
  const colors = (Array.isArray(blob.colors) ? (blob.colors as unknown[]).map((x) => String(x || '').trim()).filter(Boolean) : []).slice(0, 12)
  const sizes = (Array.isArray(blob.sizes) ? (blob.sizes as unknown[]).map((x) => String(x || '').trim()).filter(Boolean) : []).slice(0, 8)
  const skus = Array.isArray(blob.skus)
    ? (blob.skus as ProductSkuCell[]).map((x) => ({
        color: String(x.color || '').trim(),
        size: String(x.size || '').trim(),
        stock: x.stock == null || x.stock === ('' as unknown) ? null : Number(x.stock),
        barcode: x.barcode || null,
      }))
    : rebuildSkuMatrix(colors, sizes, [])
  const next: Product = {
    ...p,
    remark: parsed.text || null,
    hasSku: blob.hasSku !== false && colors.length > 0 && sizes.length > 0,
    colors,
    sizes,
    hand: normalizeHand(sizes, Array.isArray(blob.hand) ? (blob.hand as number[]) : []),
    skus,
    suggestedRetailPrice: retail,
  }
  if (next.hasSku) next.stock = displayStock(next)
  return next
}

export function dehydrateProduct(p: Product): Product {
  const hasSku = !!p.hasSku && !!(p.colors && p.colors.length && p.sizes && p.sizes.length)
  const colors = hasSku ? (p.colors || []).map((x) => x.trim()).filter(Boolean).slice(0, 12) : []
  const sizes = hasSku ? (p.sizes || []).map((x) => x.trim()).filter(Boolean).slice(0, 8) : []
  const hand = hasSku ? normalizeHand(sizes, p.hand) : []
  const skus = hasSku ? rebuildSkuMatrix(colors, sizes, p.skus || []) : []
  const stock = hasSku ? displayStock({ ...p, hasSku, colors, sizes, skus }) : p.stock
  const text = String(p.remark || '').trim()
  const retail = p.suggestedRetailPrice
  const needJson = hasSku || (retail != null && Number(retail) > 0)
  let remark: string | null = text || null
  if (needJson) {
    const body: Record<string, unknown> = { text }
    if (retail != null && Number(retail) > 0) body.suggestedRetailPrice = Number(retail)
    if (hasSku) {
      body[SKU_MARK] = { v: 1, hasSku: true, colors, sizes, hand, skus }
    }
    remark = JSON.stringify(body)
  }
  return {
    ...p,
    hasSku,
    colors,
    sizes,
    hand,
    skus,
    stock,
    remark,
  }
}

export function hydrateCatalog(list: Product[]): Product[] {
  return (list || []).map((p) => hydrateProduct(p))
}
