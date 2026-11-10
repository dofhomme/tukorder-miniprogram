/**
 * 开单取价（对齐 App UserPriceMemoryService）：
 * 客户上次成交价 > 本人历史记忆价 > 商品库默认价
 */
import { getOrCreateClientId, request } from './api'
import { CacheKeys, cachePeek, cacheSet } from './cache'
import { isGuest, isLoggedIn } from './session'
import { isCloudSyncAllowed } from './subscription'
import { peekDealCell } from './customer-deal'
import { peekCachedOrders, type CartItem, type OrderBrief, upsertOrderInCache } from './team'

export type UserPriceRow = {
  productCode: string
  price: number
  updatedAt?: string
}

type UserPriceMap = Record<string, UserPriceRow>
const DIRTY_KEY = 'tuk_user_prices_dirty_v1'

function cid() {
  return getOrCreateClientId()
}

function normCode(code: string): string {
  return String(code || '').trim()
}

function codeKey(code: string): string {
  return normCode(code).toLowerCase()
}

function peekUserPriceMap(): UserPriceMap {
  return cachePeek<UserPriceMap>(CacheKeys.userPrices) || {}
}

function writeUserPriceMap(map: UserPriceMap) {
  cacheSet(CacheKeys.userPrices, map, cid())
}

function peekDirtyCodes(): string[] {
  try {
    const raw = wx.getStorageSync(DIRTY_KEY)
    if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean)
  } catch (_) {}
  return []
}

function writeDirtyCodes(codes: string[]) {
  try {
    wx.setStorageSync(DIRTY_KEY, Array.from(new Set(codes)))
  } catch (_) {}
}

function markDirty(code: string) {
  const k = codeKey(code)
  if (!k) return
  const next = peekDirtyCodes()
  if (!next.includes(k)) {
    next.push(k)
    writeDirtyCodes(next)
  }
}

function orderTime(o: OrderBrief): number {
  const t = Date.parse(String(o.createdAt || ''))
  if (Number.isFinite(t)) return t
  return Number(o.id) || 0
}

/** 该客户最近一次非退单订单中，该货号成交单价（按 customer_name 精确匹配，对齐 App） */
export function getCustomerLastPrice(
  customerName: string,
  productCode: string,
): number | null {
  const name = String(customerName || '').trim()
  const code = codeKey(productCode)
  if (!name || !code) return null
  const cell = peekDealCell(name, productCode)
  if (cell) {
    if (cell.deleted) return null
    if (cell.price > 0) return cell.price
  }

  let bestPrice: number | null = null
  let bestT = -1
  let bestId = -1

  for (const o of peekCachedOrders()) {
    if (o.isReturn) continue
    if (String(o.customerName || '').trim() !== name) continue
    const items = o.items || []
    if (!items.length) continue
    const t = orderTime(o)
    const oid = Number(o.id) || 0
    for (const it of items) {
      if (codeKey(it.productCode) !== code) continue
      const price = Number(it.price)
      if (!(price > 0)) continue
      if (t > bestT || (t === bestT && oid > bestId)) {
        bestT = t
        bestId = oid
        bestPrice = price
      }
    }
  }
  return bestPrice
}

/** 开单人个人记忆价（可来自云端 user-prices 或本机存单） */
export function getUserProductPrice(productCode: string): number | null {
  const k = codeKey(productCode)
  if (!k) return null
  const row = peekUserPriceMap()[k]
  if (!row) return null
  const price = Number(row.price)
  return Number.isFinite(price) && price >= 0 ? price : null
}

export type UnitPriceSource = 'last' | 'memory' | 'catalog'

/**
 * 解析开单单价：客户上次成交价 > 本人历史价 > 商品库默认价。
 * source 只标明命中了哪一级，不另算一个价。
 */
export function resolveUnitPriceDetail(opts: {
  customerName?: string
  productCode: string
  catalogPrice?: number
}): { price: number; source: UnitPriceSource } {
  const code = normCode(opts.productCode)
  const customer = String(opts.customerName || '').trim()
  if (customer) {
    const cp = getCustomerLastPrice(customer, code)
    if (cp != null) return { price: cp, source: 'last' }
  }
  const up = getUserProductPrice(code)
  if (up != null) return { price: up, source: 'memory' }
  const cat = Number(opts.catalogPrice)
  return { price: Number.isFinite(cat) && cat >= 0 ? cat : 0, source: 'catalog' }
}

export function priceSourceLabel(source: UnitPriceSource): string {
  if (source === 'last') return '上次'
  if (source === 'memory') return '记忆'
  return '标价'
}

/** 解析开单单价：客户上次成交价 > 本人历史价 > 商品库默认价 */
export function resolveUnitPrice(opts: {
  customerName?: string
  productCode: string
  catalogPrice?: number
}): number {
  return resolveUnitPriceDetail(opts).price
}

/** 存单后写入个人记忆价，并标记待上云 */
export function rememberPricesFromItems(items: CartItem[]) {
  if (!items?.length) return
  const map = { ...peekUserPriceMap() }
  const now = new Date().toISOString()
  let changed = false
  for (const it of items) {
    const code = normCode(it.productCode)
    if (!code) continue
    const price = Number(it.price)
    if (!(price >= 0)) continue
    const k = codeKey(code)
    map[k] = { productCode: code.slice(0, 64), price, updatedAt: now }
    markDirty(code)
    changed = true
  }
  if (changed) writeUserPriceMap(map)
}

/** 把刚保存的订单并入本地缓存，便于立刻打开订单 / 按客户价取价 */
export function prependOrderToCache(order: OrderBrief) {
  upsertOrderInCache(order)
}

export async function pullUserPrices(): Promise<{
  ok: boolean
  error?: string
  count: number
}> {
  if (isGuest() || !isLoggedIn() || !isCloudSyncAllowed()) {
    return { ok: true, count: Object.keys(peekUserPriceMap()).length }
  }
  try {
    const res = await request<UserPriceRow[]>({
      path: `/api/v1/team/user-prices?clientId=${encodeURIComponent(cid())}`,
      method: 'GET',
      needAuth: true,
    })
    if (!res.ok) return { ok: false, error: res.message, count: 0 }
    const list = Array.isArray(res.data) ? res.data : []
    const map = { ...peekUserPriceMap() }
    for (const row of list) {
      const code = normCode(row.productCode || (row as any).product_code)
      if (!code) continue
      const price = Number(row.price)
      if (!(price >= 0)) continue
      const k = codeKey(code)
      const incomingAt = String(row.updatedAt || (row as any).updated_at || '')
      const localAt = map[k]?.updatedAt || ''
      if (!map[k] || incomingAt >= localAt) {
        map[k] = {
          productCode: code.slice(0, 64),
          price,
          updatedAt: incomingAt || new Date().toISOString(),
        }
      }
    }
    writeUserPriceMap(map)
    return { ok: true, count: list.length }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e || '拉取失败'), count: 0 }
  }
}

export async function pushUserPrices(): Promise<{
  ok: boolean
  error?: string
  pushed: number
}> {
  if (isGuest() || !isLoggedIn() || !isCloudSyncAllowed()) {
    return { ok: true, pushed: 0 }
  }
  const dirty = peekDirtyCodes()
  if (!dirty.length) return { ok: true, pushed: 0 }
  const map = peekUserPriceMap()
  const prices: UserPriceRow[] = []
  for (const k of dirty) {
    const row = map[k]
    if (!row) continue
    prices.push({
      productCode: row.productCode.slice(0, 64),
      price: row.price,
      updatedAt: row.updatedAt || new Date().toISOString(),
    })
  }
  if (!prices.length) {
    writeDirtyCodes([])
    return { ok: true, pushed: 0 }
  }
  try {
    const res = await request<{ saved?: number }>({
      path: '/api/v1/team/user-prices',
      method: 'POST',
      needAuth: true,
      data: { clientId: cid(), prices },
    })
    if (!res.ok) return { ok: false, error: res.message, pushed: 0 }
    writeDirtyCodes([])
    return { ok: true, pushed: prices.length }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e || '上传失败'), pushed: 0 }
  }
}

export function peekUserPriceCount(): number {
  return Object.keys(peekUserPriceMap()).length
}
