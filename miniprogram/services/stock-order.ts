/**
 * 订单自动库存：
 * - 有颜色尺码的，改对应格子，货号库存等于各格子合计
 * - 没有颜色尺码的，改货号总库存
 * - 保存销售单：库存减去数量
 * - 保存退单（数量为负）：库存加回
 * - 覆盖保存同一单号：先冲销再按新明细重算
 * - 移入回收站：不回加
 * - 回收站彻底删除 / 清空：按当时扣过的数量加回
 */
import { genJobNo } from './api'
import { loadPrintSettings } from './print-settings'
import { applyItemsToCatalog, colorSizeFromItem, isSkuProduct, skuSpec } from './product-sku'
import {
  fetchCatalog,
  patchCatalog,
  peekCachedCatalog,
  uploadStockMovements,
} from './team'
import type { CartItem, Product, StockMovement } from './team'

const KEY = 'tuk_order_auto_stock_v1'

export type OrderStockSnap = {
  orderNo: string
  isReturn: boolean
  items: Array<{ code: string; qty: number; color?: string; size?: string }>
  at: number
}

function loadMap(): Record<string, OrderStockSnap> {
  try {
    const raw = wx.getStorageSync(KEY)
    if (raw && typeof raw === 'object') return raw as Record<string, OrderStockSnap>
  } catch (_) {}
  return {}
}

function saveMap(m: Record<string, OrderStockSnap>) {
  try {
    wx.setStorageSync(KEY, m)
  } catch (_) {}
}

export function hasAutoStockForOrderNo(orderNo: string): boolean {
  const no = (orderNo || '').trim()
  if (!no) return false
  return !!loadMap()[no]
}

export function peekAutoStockSnap(orderNo: string): OrderStockSnap | null {
  const no = (orderNo || '').trim()
  if (!no) return null
  return loadMap()[no] || null
}

function signedQty(qty: number, isReturn: boolean): number {
  const n = Number(qty || 0)
  if (!n) return 0
  if (isReturn && n > 0) return -Math.abs(n)
  return n
}

function toSnaps(
  items: CartItem[] | undefined,
  isReturn: boolean,
): Array<{ code: string; qty: number; color?: string; size?: string }> {
  const out: Array<{ code: string; qty: number; color?: string; size?: string }> = []
  for (const it of items || []) {
    const code = String(it.productCode || '').trim()
    const qty = signedQty(Number(it.quantity || 0), isReturn)
    if (!code || !qty) continue
    const spec = colorSizeFromItem(it)
    out.push({
      code,
      qty,
      color: spec.color || undefined,
      size: spec.size || undefined,
    })
  }
  return out
}

function snapsToItems(
  snaps: Array<{ code: string; qty: number; color?: string; size?: string }>,
): CartItem[] {
  return snaps.map((s) => ({
    productCode: s.code,
    productName: s.code,
    color: s.color,
    size: s.size,
    price: 0,
    quantity: s.qty,
    subtotal: 0,
    countInStats: true,
  }))
}

async function loadCatalog(): Promise<Product[]> {
  const cached = peekCachedCatalog()
  if (cached.length) return cached
  const r = await fetchCatalog()
  return r.ok ? r.products || [] : []
}

async function commitCatalogDelta(items: CartItem[], isReturn: boolean): Promise<Product[]> {
  const products = await loadCatalog()
  if (!products.length) return []
  const next = applyItemsToCatalog(products, items, isReturn)
  const changed = next.filter((p) => {
    const old = products.find((x) => x.code === p.code)
    if (!old) return true
    if (Number(old.stock) !== Number(p.stock)) return true
    const cells = (list: Product['skus']) =>
      (list || []).map((cell) => `${cell.color}/${cell.size}:${cell.stock ?? ''}`).join('|')
    return cells(old.skus) !== cells(p.skus)
  })
  if (!changed.length) return next
  const patch = await patchCatalog(changed)
  if (!patch.ok) return products
  return next
}

async function writeMovements(
  snaps: Array<{ code: string; qty: number; color?: string; size?: string }>,
  orderNo: string,
  invert: boolean,
  products: Product[],
) {
  const now = new Date().toISOString()
  const movements: StockMovement[] = []
  for (const s of snaps) {
    if (!s.qty) continue
    const stockDelta = invert ? s.qty : -s.qty
    const p = products.find((x) => x.code === s.code)
    const after = p && p.stock != null ? Number(p.stock) : null
    const before = after == null ? null : after - stockDelta
    const isReturnLine = s.qty < 0
    movements.push({
      cloudUid: genJobNo(),
      productCode: s.code,
      productName: p?.name || s.code,
      type: invert
        ? isReturnLine
          ? 'out'
          : 'in'
        : isReturnLine
          ? 'order_return'
          : 'order_out',
      quantity: stockDelta,
      stockBefore: before,
      stockAfter: after,
      orderNo,
      color: s.color,
      size: s.size,
      remark: [
        invert
          ? '回收站彻底删除回加库存'
          : isReturnLine
            ? '退单自动入库'
            : '账单自动出库',
        skuSpec(s.color, s.size),
      ]
        .filter(Boolean)
        .join(' '),
      createdAt: now,
    })
  }
  if (!movements.length) return
  try {
    await uploadStockMovements(movements)
  } catch (_) {
    /* 流水失败不影响已写入的总库存 */
  }
}

export async function applyAutoStockForOrder(opts: {
  orderNo: string
  items: CartItem[]
  isReturn: boolean
  replaceExisting?: boolean
  previousItems?: CartItem[]
  previousIsReturn?: boolean
}): Promise<{ ok: boolean; products: Product[]; skipped: boolean }> {
  const orderNo = (opts.orderNo || '').trim()
  if (!orderNo) return { ok: true, products: peekCachedCatalog(), skipped: true }
  if (!loadPrintSettings().autoStockOutOnSave) {
    return { ok: true, products: peekCachedCatalog(), skipped: true }
  }

  const map = loadMap()
  const existing = map[orderNo]
  if (existing && !opts.replaceExisting) {
    return { ok: true, products: peekCachedCatalog(), skipped: true }
  }

  if (opts.replaceExisting) {
    if (existing) {
      await revertAutoStockForOrder(orderNo, { silent: true })
    } else if (opts.previousItems && opts.previousItems.length) {
      await applyDelta(opts.previousItems, !!opts.previousIsReturn, true, orderNo)
    }
  }

  const snaps = toSnaps(opts.items, opts.isReturn)
  if (!snaps.length) {
    delete map[orderNo]
    saveMap(map)
    return { ok: true, products: peekCachedCatalog(), skipped: true }
  }

  const products = await applyDelta(opts.items, opts.isReturn, false, orderNo)
  map[orderNo] = { orderNo, isReturn: opts.isReturn, items: snaps, at: Date.now() }
  saveMap(map)
  return { ok: true, products, skipped: false }
}

async function applyDelta(
  items: CartItem[],
  isReturn: boolean,
  invert: boolean,
  orderNo: string,
): Promise<Product[]> {
  const signed = (items || []).map((it) => {
    const qty = signedQty(Number(it.quantity || 0), isReturn)
    return { ...it, quantity: invert ? -qty : qty }
  })
  const next = await commitCatalogDelta(signed, false)
  await writeMovements(toSnaps(items, isReturn), orderNo, invert, next)
  return next
}

export async function revertAutoStockForOrder(
  orderNo: string,
  _opts?: {
    items?: CartItem[]
    isReturn?: boolean
    silent?: boolean
  },
): Promise<{ ok: boolean; products: Product[] }> {
  const no = (orderNo || '').trim()
  const map = loadMap()
  const snap = map[no]
  if (!no || !snap || !snap.items.length) {
    if (no && map[no]) {
      delete map[no]
      saveMap(map)
    }
    return { ok: true, products: peekCachedCatalog() }
  }
  const catalog = await loadCatalog()
  const reversible = snapsToItems(snap.items).filter((it) => {
    const p = catalog.find((x) => x.code === it.productCode)
    if (!p || !isSkuProduct(p)) return true
    const hasCell = (p.skus || []).some((cell) => cell.stock != null && Number.isFinite(Number(cell.stock)))
    const spec = colorSizeFromItem(it)
    // 旧记录只改了总数，色码合计会把这次扣减盖掉，库存其实没变。再冲销会多加。
    if (hasCell && !spec.color && !spec.size) return false
    return true
  })
  const products = reversible.length
    ? await applyDelta(reversible, snap.isReturn, true, no)
    : catalog
  delete map[no]
  saveMap(map)
  return { ok: true, products }
}
