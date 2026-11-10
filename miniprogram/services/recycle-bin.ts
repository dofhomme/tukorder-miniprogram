/**
 * 回收站：
 * - 未付费 / 游客：只走本机 Storage（清缓存会一起清掉）
 * - 已开通云同步：订单/商品/分类快照写入云端；客户/退包本身就是云端软删
 *   清缓存后从云端拉回本地
 */
import { genJobNo, request, getOrCreateClientId } from './api'
import { CacheKeys, cacheSet } from './cache'
import { isGuest, isLoggedIn } from './session'
import { isCloudSyncAllowed } from './subscription'
import { t } from './i18n'
import { forgetRecentCustomer } from './recent-customers'
import { revertAutoStockForOrder } from './stock-order'
import { canDeleteOrder, deleteCustomers, deleteOrderByNo, deleteReturnPackage, isOwner, peekCachedCatalog, peekCachedCustomers, patchCatalog, removeOrderFromCache, uploadOrder, upsertOrderInCache, upsertReturnPackage } from './team'
import type { Category, Customer, OrderBrief, Product, ReturnPackage } from './team'

const KEY = 'tuk_recycle_bin_v1'
const LOCAL_TRASH_CUSTOMERS = 'tuk_local_trash_customers'
const LOCAL_TRASH_RETURNS = 'tuk_local_trash_returns'

/** 商家或游客均可永久清理本机回收站 */
function canPurgeLocal(): boolean {
  return isOwner() || isGuest() || !isLoggedIn()
}

/** 游客 / 未登录 / 未订阅：客户与退包软删只落本机 */
function localTrashOnly(): boolean {
  return isGuest() || !isLoggedIn() || !isCloudSyncAllowed()
}

/** 付费云同步：订单/商品/分类回收站上云 */
function cloudRecycleEnabled(): boolean {
  return isLoggedIn() && !isGuest() && isCloudSyncAllowed()
}

export type TrashOrder = OrderBrief & { trashedAt: number }
export type TrashProduct = Product & { trashedAt: number }
export type TrashCategory = Category & { trashedAt: number }

type RecycleStore = {
  orders: TrashOrder[]
  products: TrashProduct[]
  categories: TrashCategory[]
}

function emptyStore(): RecycleStore {
  return { orders: [], products: [], categories: [] }
}

function loadStore(): RecycleStore {
  try {
    const raw = wx.getStorageSync(KEY)
    if (raw && typeof raw === 'object') {
      return {
        orders: Array.isArray(raw.orders) ? raw.orders : [],
        products: Array.isArray(raw.products) ? raw.products : [],
        categories: Array.isArray(raw.categories) ? raw.categories : [],
      }
    }
  } catch (_) {}
  return emptyStore()
}

function slimStore(s: RecycleStore): RecycleStore {
  const stripOrder = (o: TrashOrder): TrashOrder => {
    const copy = { ...o } as TrashOrder & {
      deliveryPhotoBase64?: string
      deliveryPhotoPath?: string
    }
    delete copy.deliveryPhotoBase64
    delete copy.deliveryPhotoPath
    return copy
  }
  return {
    orders: (s.orders || []).slice(0, 200).map(stripOrder),
    products: (s.products || []).slice(0, 300),
    categories: (s.categories || []).slice(0, 100),
  }
}

function saveStoreLocal(s: RecycleStore) {
  try {
    wx.setStorageSync(KEY, s)
  } catch (_) {}
}

async function pushRecycleBinToCloud(s: RecycleStore): Promise<void> {
  if (!cloudRecycleEnabled()) return
  const slim = slimStore(s)
  await request({
    path: '/api/v1/team/recycle-bin',
    method: 'PUT',
    data: {
      clientId: getOrCreateClientId(),
      orders: slim.orders,
      products: slim.products,
      categories: slim.categories,
    },
  })
}

/** 拉和推串行。永久删除后若先拉后推，云端旧快照会把刚删的项写回来。 */
let recycleEpoch = 0
let recycleChain: Promise<void> = Promise.resolve()

function enqueueRecycle<T>(job: () => Promise<T>): Promise<T> {
  const run = recycleChain.then(job, job)
  recycleChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function saveStore(s: RecycleStore) {
  recycleEpoch += 1
  saveStoreLocal(s)
  if (!cloudRecycleEnabled()) return
  const seen = recycleEpoch
  void enqueueRecycle(async () => {
    if (seen !== recycleEpoch) return
    await pushRecycleBinToCloud(loadStore())
  })
}

async function persistStore(s: RecycleStore): Promise<void> {
  recycleEpoch += 1
  saveStoreLocal(s)
  const seen = recycleEpoch
  await enqueueRecycle(async () => {
    if (seen !== recycleEpoch) return
    await pushRecycleBinToCloud(loadStore())
  })
}

function asTrashList<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : []
}

function unionBy<T>(local: T[], remote: T[], keyOf: (x: T) => string): T[] {
  const map = new Map<string, T>()
  for (const x of remote) {
    const k = keyOf(x)
    if (k) map.set(k, x)
  }
  for (const x of local) {
    const k = keyOf(x)
    if (k) map.set(k, x)
  }
  return Array.from(map.values())
}

/** 付费用户：从云端拉回收站到本机（清缓存 / 打开回收站时） */
export async function pullRecycleBinFromCloud(): Promise<boolean> {
  if (!cloudRecycleEnabled()) return false
  const seen = recycleEpoch
  return enqueueRecycle(async () => {
    if (seen !== recycleEpoch) return false
    return pullRecycleBinBody(seen)
  })
}

async function pullRecycleBinBody(seen: number): Promise<boolean> {
  const res = await request<{
    orders?: TrashOrder[]
    products?: TrashProduct[]
    categories?: TrashCategory[]
  }>({
    path: `/api/v1/team/recycle-bin?clientId=${encodeURIComponent(getOrCreateClientId())}`,
  })
  if (seen !== recycleEpoch) return false
  if (!res.ok) return false
  const data = res.data || {}
  const remote: RecycleStore = {
    orders: asTrashList<TrashOrder>(data.orders),
    products: asTrashList<TrashProduct>(data.products),
    categories: asTrashList<TrashCategory>(data.categories),
  }
  const local = loadStore()
  const remoteEmpty =
    !remote.orders.length && !remote.products.length && !remote.categories.length
  if (remoteEmpty) {
    if (local.orders.length || local.products.length || local.categories.length) {
      await pushRecycleBinToCloud(local)
    }
    return true
  }
  if (seen !== recycleEpoch) return false
  saveStoreLocal({
    orders: unionBy(local.orders, remote.orders, (o) => String(o.orderNo || '')),
    products: unionBy(local.products, remote.products, (p) => String(p.code || '')),
    categories: unionBy(local.categories, remote.categories, (c) => String(c.name || '')),
  })
  return true
}

export function listTrashOrders(): TrashOrder[] {
  return loadStore().orders.slice().sort((a, b) => b.trashedAt - a.trashedAt)
}

export function listTrashProducts(): TrashProduct[] {
  return loadStore().products.slice().sort((a, b) => b.trashedAt - a.trashedAt)
}

export function listTrashCategories(): TrashCategory[] {
  return loadStore().categories.slice().sort((a, b) => b.trashedAt - a.trashedAt)
}

/** 软删订单：写入本地回收站，并从云端删除（与 App 一致） */
export async function softDeleteOrder(order: OrderBrief): Promise<{
  ok: boolean
  error?: string
  cloudError?: string
}> {
  const orderNo = (order.orderNo || '').trim()
  if (!orderNo) return { ok: false, error: '无单号' }
  if (!canDeleteOrder(order)) {
    return { ok: false, error: t('orderEditOwnOnly') }
  }
  const s = loadStore()
  const snapshot = {
    ...order,
    items: Array.isArray(order.items) ? order.items : [],
    trashedAt: Date.now(),
  }
  if (!s.orders.some((o) => o.orderNo === orderNo)) {
    s.orders.unshift(snapshot)
    await persistStore(s)
  } else {
    saveStore(s)
  }
  const cloud = await deleteOrderByNo(orderNo)
  removeOrderFromCache(orderNo)
  return {
    ok: true,
    cloudError: cloud.ok ? undefined : cloud.error || '云端删除失败',
  }
}

export async function restoreOrder(orderNo: string): Promise<{ ok: boolean; error?: string }> {
  const s = loadStore()
  const idx = s.orders.findIndex((o) => o.orderNo === orderNo)
  if (idx < 0) return { ok: false, error: '回收站中无此账单' }
  const o = s.orders[idx]
  if (!canDeleteOrder(o)) {
    return { ok: false, error: t('orderEditOwnOnly') }
  }
  upsertOrderInCache(o)
  const up = await uploadOrder({
    orderNo: o.orderNo,
    customerName: o.customerName || undefined,
    customerPhone: o.customerPhone || undefined,
    remark: o.remark || undefined,
    totalAmount: Number(o.totalAmount || 0),
    totalQuantity: Number(o.totalQuantity || 0),
    items: Array.isArray(o.items) ? o.items : [],
    createdAt: o.createdAt || undefined,
    isReturn: !!o.isReturn,
    isPaid: !!o.isPaid,
    isPickedUp: !!o.isPickedUp,
    isShipped: !!o.isShipped,
    isDelivered: !!o.isDelivered,
    trackingNos: o.trackingNos,
  })
  if (!up.ok) return { ok: false, error: up.error || '恢复失败' }
  s.orders.splice(idx, 1)
  await persistStore(s)
  return { ok: true }
}

export async function purgeOrder(orderNo: string): Promise<boolean> {
  if (!canPurgeLocal()) return false
  const s = loadStore()
  const found = s.orders.find((o) => o.orderNo === orderNo)
  const n = s.orders.length
  s.orders = s.orders.filter((o) => o.orderNo !== orderNo)
  await persistStore(s)
  if (s.orders.length < n) {
    await revertAutoStockForOrder(orderNo, {
      items: found?.items,
      isReturn: !!found?.isReturn,
    })
    return true
  }
  return false
}

/** 软删商品 */
export async function softDeleteProduct(product: Product): Promise<{ ok: boolean; error?: string }> {
  const code = (product.code || '').trim()
  if (!code) return { ok: false, error: '无货号' }
  const s = loadStore()
  if (!s.products.some((p) => p.code === code)) {
    s.products.unshift({ ...product, trashedAt: Date.now() })
    await persistStore(s)
  } else {
    saveStore(s)
  }
  const r = await patchCatalog([], [code])
  if (!r.ok) return { ok: false, error: r.error || '删除失败' }
  return { ok: true }
}

export async function restoreProduct(code: string): Promise<{ ok: boolean; error?: string }> {
  const s = loadStore()
  const idx = s.products.findIndex((p) => p.code === code)
  if (idx < 0) return { ok: false, error: '回收站中无此商品' }
  const p = s.products[idx]
  const { trashedAt: _, ...product } = p
  const r = await patchCatalog([product], [])
  if (!r.ok) return { ok: false, error: r.error || '恢复失败' }
  s.products.splice(idx, 1)
  await persistStore(s)
  return { ok: true }
}

export async function purgeProduct(code: string): Promise<boolean> {
  if (!canPurgeLocal()) return false
  const s = loadStore()
  const n = s.products.length
  s.products = s.products.filter((p) => p.code !== code)
  await persistStore(s)
  return s.products.length < n
}

/** 软删分类：调用方负责把最新分类列表上传；此处只存快照 */
export function softDeleteCategoryLocal(cat: Category) {
  const name = (cat.name || '').trim()
  if (!name) return
  const s = loadStore()
  if (!s.categories.some((c) => c.name === name)) {
    s.categories.unshift({ ...cat, name, trashedAt: Date.now() })
    saveStore(s)
  }
}

export async function restoreCategory(
  name: string,
  currentCats: Category[],
  upload: (cats: Category[]) => Promise<{ ok: boolean; error?: string | null }>,
): Promise<{ ok: boolean; error?: string }> {
  const s = loadStore()
  const idx = s.categories.findIndex((c) => c.name === name)
  if (idx < 0) return { ok: false, error: '回收站中无此分类' }
  const cat = s.categories[idx]
  if (currentCats.some((c) => c.name === name)) {
    s.categories.splice(idx, 1)
    await persistStore(s)
    return { ok: true }
  }
  const next = [...currentCats, { name: cat.name, sortOrder: currentCats.length }]
  const r = await upload(next)
  if (!r.ok) return { ok: false, error: r.error || '恢复失败' }
  s.categories.splice(idx, 1)
  await persistStore(s)
  return { ok: true }
}

export async function purgeCategory(name: string): Promise<boolean> {
  if (!canPurgeLocal()) return false
  const s = loadStore()
  const n = s.categories.length
  s.categories = s.categories.filter((c) => c.name !== name)
  await persistStore(s)
  return s.categories.length < n
}

/** 客户：云端 soft delete */
export async function softDeleteCustomer(customer: Customer): Promise<{
  ok: boolean
  error?: string
}> {
  if (!localTrashOnly() && !isOwner()) return { ok: false, error: '只有老板能删除客户' }
  const all = peekCachedCustomers().slice()
  const idx = all.findIndex((c) => c.id === customer.id)
  const now = Date.now()
  if (idx >= 0) {
    all[idx] = { ...all[idx], deletedAt: now }
  } else {
    all.push({ ...customer, deletedAt: now })
  }
  if (localTrashOnly()) {
    const active = all.filter((c) => c && c.name && !c.deletedAt)
    cacheSet(CacheKeys.customers, active, getOrCreateClientId())
    try {
      wx.setStorageSync(
        LOCAL_TRASH_CUSTOMERS,
        all.filter((c) => !!c.deletedAt),
      )
    } catch (_) {}
    forgetRecentCustomer(customer)
    return { ok: true }
  }
  const up = await uploadCustomersWithDeleted(all)
  if (up.ok) forgetRecentCustomer(customer)
  return up
}

export async function restoreCustomer(id: string): Promise<{ ok: boolean; error?: string }> {
  if (localTrashOnly()) {
    let trash: Customer[] = []
    try {
      const raw = wx.getStorageSync(LOCAL_TRASH_CUSTOMERS)
      if (Array.isArray(raw)) trash = raw as Customer[]
    } catch (_) {}
    // 兼容旧 key
    if (!trash.length) {
      try {
        const raw = wx.getStorageSync('tuk_guest_trash_customers')
        if (Array.isArray(raw)) trash = raw as Customer[]
      } catch (_) {}
    }
    const hit = trash.find((c) => c.id === id)
    const active = peekCachedCustomers().slice()
    if (hit) {
      active.push({ ...hit, deletedAt: null })
      trash = trash.filter((c) => c.id !== id)
    } else {
      const i = active.findIndex((c) => c.id === id)
      if (i >= 0) active[i] = { ...active[i], deletedAt: null }
    }
    cacheSet(CacheKeys.customers, active.filter((c) => c && c.name && !c.deletedAt), getOrCreateClientId())
    try {
      wx.setStorageSync(LOCAL_TRASH_CUSTOMERS, trash)
    } catch (_) {}
    return { ok: true }
  }
  const r = await fetchCustomersIncludingDeleted()
  if (!r.ok) return { ok: false, error: r.error || '加载失败' }
  const all = r.customers.map((c) =>
    c.id === id ? { ...c, deletedAt: null } : c,
  )
  return uploadCustomersWithDeleted(all)
}

export async function purgeCustomer(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!canPurgeLocal()) return { ok: false, error: '无权限永久删除' }
  const peekTrash = (): Customer[] => {
    try {
      const raw = wx.getStorageSync(LOCAL_TRASH_CUSTOMERS)
      if (Array.isArray(raw)) return raw as Customer[]
    } catch (_) {}
    return []
  }
  // 本机模式：只从本机客户缓存 / 回收站移除
  if (localTrashOnly()) {
    const hit =
      peekCachedCustomers().find((c) => c.id === id) ||
      peekTrash().find((c) => c.id === id)
    const all = peekCachedCustomers().filter((c) => c.id !== id)
    cacheSet(CacheKeys.customers, all, getOrCreateClientId())
    try {
      wx.setStorageSync(
        LOCAL_TRASH_CUSTOMERS,
        peekTrash().filter((c) => c.id !== id),
      )
    } catch (_) {}
    forgetRecentCustomer(hit || { id })
    return { ok: true }
  }
  if (!isOwner()) return { ok: false, error: '仅商家可永久删除' }
  const listed = await fetchCustomersIncludingDeleted()
  const hit = listed.ok ? listed.customers.find((c) => c.id === id) : undefined
  const del = await deleteCustomers([id])
  if (!del.ok) return { ok: false, error: del.error || '云端删除失败' }
  forgetRecentCustomer(hit || { id })
  const r = await fetchCustomersIncludingDeleted()
  if (!r.ok) return { ok: true }
  const all = r.customers.filter((c) => c.id !== id)
  return uploadCustomersWithDeleted(all)
}

export async function fetchCustomersIncludingDeleted(): Promise<{
  ok: boolean
  error?: string
  customers: Customer[]
}> {
  if (localTrashOnly()) {
    return { ok: false, error: '未开通云同步', customers: [] }
  }
  const res = await request<{ customers: Customer[]; count: number }>({
    path: `/api/v1/team/customers?clientId=${encodeURIComponent(getOrCreateClientId())}`,
  })
  if (!res.ok) {
    return { ok: false, error: res.message, customers: [] }
  }
  return { ok: true, customers: res.data?.customers || [] }
}

export async function listTrashCustomers(): Promise<Customer[]> {
  if (localTrashOnly()) {
    try {
      const raw = wx.getStorageSync(LOCAL_TRASH_CUSTOMERS)
      if (Array.isArray(raw)) return raw as Customer[]
      const legacy = wx.getStorageSync('tuk_guest_trash_customers')
      if (Array.isArray(legacy)) return legacy as Customer[]
    } catch (_) {}
    return []
  }
  const r = await fetchCustomersIncludingDeleted()
  if (!r.ok) return []
  return r.customers.filter((c) => !!c.deletedAt)
}

async function uploadCustomersWithDeleted(customers: Customer[]) {
  if (localTrashOnly()) {
    return { ok: false as const, error: '未开通云同步，无法写入云端' }
  }
  const res = await request<{ count: number }>({
    path: '/api/v1/team/customers/upload',
    method: 'POST',
    data: {
      clientId: getOrCreateClientId(),
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone || null,
        deletedAt: c.deletedAt || null,
      })),
    },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  const active = customers.filter((c) => c && c.name && !c.deletedAt)
  cacheSet(CacheKeys.customers, active, getOrCreateClientId())
  return { ok: true as const }
}

/** 退包：软删 */
export async function softDeleteReturnPackage(pkg: ReturnPackage): Promise<{
  ok: boolean
  error?: string
}> {
  const cloudUid = pkg.cloudUid || genJobNo()
  if (localTrashOnly()) {
    try {
      const raw = wx.getStorageSync(LOCAL_TRASH_RETURNS)
      const list: ReturnPackage[] = Array.isArray(raw) ? (raw as ReturnPackage[]) : []
      const next = list.filter((x) => x.cloudUid !== cloudUid)
      next.push({
        ...pkg,
        cloudUid,
        deletedAt: new Date().toISOString(),
      } as ReturnPackage)
      wx.setStorageSync(LOCAL_TRASH_RETURNS, next)
    } catch (_) {}
    return { ok: true }
  }
  const res = await request({
    path: '/api/v1/team/return-packages',
    method: 'POST',
    data: {
      clientId: getOrCreateClientId(),
      cloudUid,
      trackingNo: pkg.trackingNo,
      carrier: pkg.carrier || '',
      packageCount: pkg.packageCount || 1,
      items: pkg.items || [],
      remark: pkg.remark || '',
      isHandled: !!pkg.isHandled,
      createdAt: pkg.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: new Date().toISOString(),
    },
  })
  if (!res.ok) return { ok: false, error: res.message }
  return { ok: true }
}

export async function restoreReturnPackage(pkg: ReturnPackage): Promise<{
  ok: boolean
  error?: string
}> {
  if (localTrashOnly()) {
    try {
      const raw = wx.getStorageSync(LOCAL_TRASH_RETURNS)
      const list: ReturnPackage[] = Array.isArray(raw) ? (raw as ReturnPackage[]) : []
      wx.setStorageSync(
        LOCAL_TRASH_RETURNS,
        list.filter((x) => x.cloudUid !== pkg.cloudUid),
      )
    } catch (_) {}
    // 退包本机业务列表由页面自己维护；恢复仅移出回收站
    return { ok: true }
  }
  const r = await upsertReturnPackage({
    cloudUid: pkg.cloudUid,
    trackingNo: pkg.trackingNo,
    carrier: pkg.carrier || undefined,
    packageCount: pkg.packageCount,
    items: pkg.items,
    remark: pkg.remark || undefined,
    isHandled: !!pkg.isHandled,
  })
  if (!r.ok) return { ok: false, error: r.error || '恢复失败' }
  const res = await request({
    path: '/api/v1/team/return-packages',
    method: 'POST',
    data: {
      clientId: getOrCreateClientId(),
      cloudUid: pkg.cloudUid,
      trackingNo: pkg.trackingNo,
      carrier: pkg.carrier || '',
      packageCount: pkg.packageCount || 1,
      items: pkg.items || [],
      remark: pkg.remark || '',
      isHandled: !!pkg.isHandled,
      createdAt: pkg.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    },
  })
  if (!res.ok) return { ok: false, error: res.message }
  return { ok: true }
}

export async function purgeReturnPackage(cloudUid: string): Promise<{
  ok: boolean
  error?: string
}> {
  if (!isOwner() && !localTrashOnly()) return { ok: false, error: '仅商家可永久删除' }
  if (localTrashOnly()) {
    try {
      const raw = wx.getStorageSync(LOCAL_TRASH_RETURNS)
      const list: ReturnPackage[] = Array.isArray(raw) ? (raw as ReturnPackage[]) : []
      wx.setStorageSync(
        LOCAL_TRASH_RETURNS,
        list.filter((x) => x.cloudUid !== cloudUid),
      )
    } catch (_) {}
    return { ok: true }
  }
  if (!isOwner()) return { ok: false, error: '仅商家可永久删除' }
  return deleteReturnPackage(cloudUid)
}

export async function listTrashReturnPackages(): Promise<ReturnPackage[]> {
  if (localTrashOnly()) {
    try {
      const raw = wx.getStorageSync(LOCAL_TRASH_RETURNS)
      if (Array.isArray(raw)) return raw as ReturnPackage[]
    } catch (_) {}
    return []
  }
  const res = await request<ReturnPackage[]>({
    path: `/api/v1/team/return-packages?clientId=${encodeURIComponent(getOrCreateClientId())}`,
  })
  if (!res.ok) return []
  const list = Array.isArray(res.data) ? res.data : []
  return list.filter((x) => !!x.deletedAt)
}

export async function emptyRecycleBin(): Promise<void> {
  if (!canPurgeLocal()) return
  const s = loadStore()
  const trashOrders = s.orders.slice()
  for (const o of trashOrders) {
    await revertAutoStockForOrder(o.orderNo, {
      items: o.items,
      isReturn: !!o.isReturn,
    })
  }
  // purge local
  s.orders = []
  s.products = []
  s.categories = []
  await persistStore(s)
  try {
    const raw = wx.getStorageSync(LOCAL_TRASH_CUSTOMERS)
    if (Array.isArray(raw)) {
      for (const c of raw as Customer[]) forgetRecentCustomer(c)
      wx.setStorageSync(LOCAL_TRASH_CUSTOMERS, [])
    }
  } catch (_) {}
  if (isGuest() || !isLoggedIn()) return
  if (!isOwner()) return
  // customers
  const cust = await fetchCustomersIncludingDeleted()
  if (cust.ok) {
    const trash = cust.customers.filter((c) => !!c.deletedAt)
    for (const c of trash) forgetRecentCustomer(c)
    const trashIds = trash.map((c) => c.id)
    if (trashIds.length) {
      const del = await deleteCustomers(trashIds)
      if (!del.ok) return
    }
    const keep = cust.customers.filter((c) => !c.deletedAt)
    await uploadCustomersWithDeleted(keep)
  }
  // returns
  const trashed = await listTrashReturnPackages()
  for (const p of trashed) {
    if (p.cloudUid) await deleteReturnPackage(p.cloudUid)
  }
}

export function findProductInCatalogOrTrash(code: string): Product | null {
  const cat = peekCachedCatalog()
  const hit = cat.find((p) => p.code === code)
  if (hit) return hit
  return listTrashProducts().find((p) => p.code === code) || null
}
