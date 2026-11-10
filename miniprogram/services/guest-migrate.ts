/** 游客/本机数据扫描与批量上传云端 */

import { pushUserPrices } from './customer-price'
import {
  formatExpireLabel,
  isCloudSyncAllowed,
  refreshEntitlement,
} from './subscription'
import {
  fetchCatalog,
  fetchCategories,
  fetchCustomers,
  fetchOrderByNo,
  fetchShop,
  listAllRemoteOrderNos,
  mergeCatalogIntoCache,
  mergeCategoriesIntoCache,
  mergeCustomersIntoCache,
  patchCatalog,
  peekCachedCatalog,
  peekCachedCategories,
  peekCachedCustomers,
  peekCachedOrders,
  peekCachedShop,
  recentOrdersSinceIso,
  uploadCategories,
  uploadCustomers,
  uploadOrder,
  uploadShop,
  type Customer,
  type OrderBrief,
  type Product,
  type ShopInfo,
} from './team'

export const PENDING_UPLOAD_KEY = 'tuk_pending_local_upload'

export type LocalGuestScan = {
  orders: OrderBrief[]
  products: Product[]
  customers: Customer[]
  categories: Array<{ id?: number; name: string; sortOrder?: number }>
  shop: ShopInfo | null
  counts: { orders: number; products: number; customers: number; categories: number }
  hasData: boolean
}

export function scanLocalGuestData(): LocalGuestScan {
  const orders = peekCachedOrders()
  const products = peekCachedCatalog()
  const customers = peekCachedCustomers()
  const categories = peekCachedCategories()
  const shop = peekCachedShop()
  const counts = {
    orders: orders.length,
    products: products.length,
    customers: customers.length,
    categories: categories.length,
  }
  const hasShopName = !!(shop && String(shop.shopName || '').trim())
  const hasData =
    counts.orders > 0 ||
    counts.products > 0 ||
    counts.customers > 0 ||
    counts.categories > 0 ||
    hasShopName
  return { orders, products, customers, categories, shop, counts, hasData }
}

export function markPendingLocalUpload(on: boolean) {
  try {
    if (on) wx.setStorageSync(PENDING_UPLOAD_KEY, 1)
    else wx.removeStorageSync(PENDING_UPLOAD_KEY)
  } catch (_) {}
}

export function hasPendingLocalUpload(): boolean {
  try {
    return !!wx.getStorageSync(PENDING_UPLOAD_KEY)
  } catch {
    return false
  }
}

/** 登录后确认未开通云同步时弹出，可去开通页。 */
export function promptCloudSyncAfterLogin(opts: {
  onOpen: () => void
  onLater: () => void
}): void {
  const scan = scanLocalGuestData()
  let content = '当前账号未开通云同步，账单和商品只保存在本机。开通后可与电脑、App 同步。'
  if (scan.hasData) {
    const { orders, products, customers } = scan.counts
    content += `本机还有约 ${orders} 笔账单、${products} 个商品、${customers} 个客户，开通后可上传。`
    markPendingLocalUpload(true)
  } else {
    markPendingLocalUpload(false)
  }
  wx.showModal({
    title: '未开通云同步',
    content,
    confirmText: '去开通',
    cancelText: '稍后再说',
    success(res) {
      if (res.confirm) opts.onOpen()
      else opts.onLater()
    },
    fail: () => opts.onLater(),
  })
}

/** 绑号/登录成功后：有本机数据则弹窗询问是否上云 */
export function promptUploadAfterBind(opts?: {
  onSkip?: () => void
  onGoSubscription?: () => void
}): void {
  const scan = scanLocalGuestData()
  if (!scan.hasData) {
    markPendingLocalUpload(false)
    opts?.onSkip?.()
    return
  }
  markPendingLocalUpload(true)
  const { orders, products, customers } = scan.counts
  const content =
    `检测到本机约 ${orders} 笔账单、${products} 个商品、${customers} 个客户。` +
    `上传后可与电脑端/App 同步。云端同步需开通订阅。` +
    `也可稍后再传，本机数据不会丢。`

  wx.showModal({
    title: '上传本机开单数据？',
    content,
    confirmText: '去开通',
    cancelText: '暂不上传',
    success(res) {
      if (res.confirm) {
        wx.navigateTo({
          url: '/pages/subscription/subscription?from=upload',
          fail: () => opts?.onSkip?.(),
        })
        opts?.onGoSubscription?.()
        return
      }
      opts?.onSkip?.()
    },
    fail: () => opts?.onSkip?.(),
  })
}

export type MigrateProgress = {
  phase: string
  current: number
  total: number
}

export type MigrateResult = {
  ok: boolean
  error?: string
  uploaded: {
    shop: boolean
    categories: number
    products: number
    customers: number
    orders: number
    prices: boolean
  }
  skipped: {
    shop: boolean
    categories: number
    products: number
    customers: number
    orders: number
  }
  pulled: {
    products: number
    customers: number
    categories: number
    orders: number
  }
}

function emptyUploaded(): MigrateResult['uploaded'] {
  return {
    shop: false,
    categories: 0,
    products: 0,
    customers: 0,
    orders: 0,
    prices: false,
  }
}

function emptySkipped(): MigrateResult['skipped'] {
  return { shop: false, categories: 0, products: 0, customers: 0, orders: 0 }
}

function emptyPulled(): MigrateResult['pulled'] {
  return { products: 0, customers: 0, categories: 0, orders: 0 }
}

function productCode(p: Product): string {
  return String(p?.code || '').trim()
}

function categoryName(c: { name?: string }): string {
  return String(c?.name || '').trim()
}

function customerFingerprint(c: Customer): string {
  return `${String(c?.name || '').trim()}|${String(c?.phone || '').trim()}`
}

function shopNameOf(shop: ShopInfo | null | undefined): string {
  return String(shop?.shopName || '').trim()
}

/**
 * 本机 vs 云端对比后只补空缺：
 * - 本机有、云端没有 → 上传
 * - 云端有、本机没有 → 写入本机缓存
 * - 两边已有相同键 → 跳过，不再整包同步
 */
export async function uploadLocalGuestDataToCloud(opts?: {
  onProgress?: (p: MigrateProgress) => void
}): Promise<MigrateResult> {
  await refreshEntitlement({ force: true })
  if (!isCloudSyncAllowed()) {
    return {
      ok: false,
      error: '请先开通云同步订阅',
      uploaded: emptyUploaded(),
      skipped: emptySkipped(),
      pulled: emptyPulled(),
    }
  }

  const scan = scanLocalGuestData()
  const uploaded = emptyUploaded()
  const skipped = emptySkipped()
  const pulled = emptyPulled()

  const report = (phase: string, current: number, total: number) => {
    opts?.onProgress?.({ phase, current, total })
  }

  try {
    report('比对', 0, 1)

    // 1. 店铺：云端已有店名则跳过
    report('店铺', 0, 1)
    const shopRes = await fetchShop()
    if (!shopRes.ok || shopRes.fromCache) {
      return {
        ok: false,
        error: shopRes.error || '无法获取云端店铺，已取消以免重复上传',
        uploaded,
        skipped,
        pulled,
      }
    }
    const localShopName = shopNameOf(scan.shop)
    const cloudShopName = shopRes.ok ? shopNameOf(shopRes.shop) : ''
    if (localShopName && !cloudShopName && scan.shop) {
      const r = await uploadShop({
        shopName: localShopName,
        address: scan.shop.address || undefined,
        phone: scan.shop.phone || undefined,
        footer: scan.shop.footer || undefined,
        logoBase64: scan.shop.logoBase64 || undefined,
      })
      if (!r.ok) {
        return { ok: false, error: (r as any).error || '店铺上传失败', uploaded, skipped, pulled }
      }
      uploaded.shop = true
    } else if (localShopName && cloudShopName) {
      skipped.shop = true
    }
    report('店铺', 1, 1)

    // 2. 分类：按名称，缺的才传；已有的补回本机
    report('分类', 0, 1)
    const catRes = await fetchCategories()
    if (!catRes.ok || catRes.fromCache) {
      return {
        ok: false,
        error: catRes.error || '无法获取云端分类，已取消以免重复上传',
        uploaded,
        skipped,
        pulled,
      }
    }
    const cloudCats = catRes.ok ? catRes.categories : []
    const cloudCatNames = new Set(cloudCats.map(categoryName).filter(Boolean))
    const localCats = scan.categories.filter((c) => categoryName(c))
    const missingCats = localCats.filter((c) => !cloudCatNames.has(categoryName(c)))
    skipped.categories = localCats.length - missingCats.length
    pulled.categories = cloudCats.filter((c) => !localCats.some((x) => categoryName(x) === categoryName(c))).length
    mergeCategoriesIntoCache(localCats)
    if (missingCats.length) {
      const r = await uploadCategories(peekCachedCategories())
      if (!r.ok) {
        return { ok: false, error: (r as any).error || '分类上传失败', uploaded, skipped, pulled }
      }
      uploaded.categories = missingCats.length
    }
    report('分类', 1, 1)

    // 3. 商品：按货号
    report('商品', 0, 1)
    const catalogRes = await fetchCatalog()
    if (!catalogRes.ok || catalogRes.fromCache) {
      return {
        ok: false,
        error: catalogRes.error || '无法获取云端商品，已取消以免重复上传',
        uploaded,
        skipped,
        pulled,
      }
    }
    const cloudProducts = catalogRes.ok ? catalogRes.products : []
    const cloudCodes = new Set(cloudProducts.map(productCode).filter(Boolean))
    const localProducts = scan.products.filter((p) => productCode(p))
    const missingProducts = localProducts.filter((p) => !cloudCodes.has(productCode(p)))
    skipped.products = localProducts.length - missingProducts.length
    pulled.products = cloudProducts.filter((p) => {
      const code = productCode(p)
      return code && !localProducts.some((x) => productCode(x) === code)
    }).length
    mergeCatalogIntoCache(localProducts)
    if (missingProducts.length) {
      const r = await patchCatalog(missingProducts, [])
      if (!r.ok) {
        return { ok: false, error: (r as any).error || '商品上传失败', uploaded, skipped, pulled }
      }
      uploaded.products = missingProducts.length
    }
    report('商品', 1, 1)

    // 4. 客户：按 id，其次姓名+电话
    report('客户', 0, 1)
    const custRes = await fetchCustomers()
    if (!custRes.ok || custRes.fromCache) {
      return {
        ok: false,
        error: custRes.error || '无法获取云端客户，已取消以免重复上传',
        uploaded,
        skipped,
        pulled,
      }
    }
    const cloudCustomers = custRes.ok ? custRes.customers : []
    const cloudCustIds = new Set(cloudCustomers.map((c) => String(c.id || '').trim()).filter(Boolean))
    const cloudCustFp = new Set(cloudCustomers.map(customerFingerprint))
    const localCustomers = scan.customers.filter((c) => c && c.name && !c.deletedAt)
    const missingCustomers = localCustomers.filter((c) => {
      const id = String(c.id || '').trim()
      if (id && cloudCustIds.has(id)) return false
      if (cloudCustFp.has(customerFingerprint(c))) return false
      return true
    })
    skipped.customers = localCustomers.length - missingCustomers.length
    pulled.customers = cloudCustomers.filter((c) => {
      const id = String(c.id || '').trim()
      if (id && localCustomers.some((x) => String(x.id || '').trim() === id)) return false
      return !localCustomers.some((x) => customerFingerprint(x) === customerFingerprint(c))
    }).length
    mergeCustomersIntoCache(localCustomers)
    if (missingCustomers.length) {
      const r = await uploadCustomers(missingCustomers)
      if (!r.ok) {
        return { ok: false, error: (r as any).error || '客户上传失败', uploaded, skipped, pulled }
      }
      uploaded.customers = missingCustomers.length
    }
    report('客户', 1, 1)

    // 5. 记忆价：本身只推脏数据
    report('记忆价', 0, 1)
    const pr = await pushUserPrices()
    uploaded.prices = !!pr.ok && (pr.pushed || 0) > 0
    report('记忆价', 1, 1)

    // 6. 订单：先拉云端单号，只上传本机缺的
    const localOrders = scan.orders.filter((o) => String(o.orderNo || '').trim())
    report('账单', 0, Math.max(localOrders.length, 1))
    const remoteNos = await listAllRemoteOrderNos()
    if (!remoteNos.ok) {
      return {
        ok: false,
        error: remoteNos.error || '比对云端账单失败',
        uploaded,
        skipped,
        pulled,
      }
    }
    const missingOrders = localOrders.filter((o) => {
      const no = String(o.orderNo || '').trim()
      if (!no || remoteNos.nos.has(no)) return false
      return (o.items || []).length > 0
    })
    skipped.orders = localOrders.length - missingOrders.length
    const total = missingOrders.length
    for (let i = 0; i < missingOrders.length; i++) {
      const o = missingOrders[i]
      report('账单', i, total)
      const items = (o.items || []).map((it) => ({
        productCode: it.productCode,
        productName: it.productName,
        spec: it.spec,
        unit: it.unit,
        price: Number(it.price) || 0,
        quantity: Number(it.quantity) || 0,
        subtotal: Number(it.subtotal) || 0,
        countInStats: it.countInStats !== false,
      }))
      if (!items.length) continue
      const r = await uploadOrder({
        waitCloud: true,
        orderNo: o.orderNo,
        customerName: o.customerName || '',
        customerPhone: o.customerPhone || '',
        customerId: o.customerId || undefined,
        remark: o.remark || '',
        totalAmount: Number(o.totalAmount) || 0,
        totalQuantity: Number(o.totalQuantity) || 0,
        items,
        createdAt: o.createdAt || undefined,
        isReturn: !!o.isReturn,
        returnReason: o.returnReason || undefined,
        returnForDate: o.returnForDate || undefined,
        isPaid: !!o.isPaid,
        isPickedUp: !!o.isPickedUp,
        isShipped: !!o.isShipped,
        isDelivered: !!o.isDelivered,
        trackingNos: o.trackingNos,
        deliveryPhotoBase64: o.deliveryPhotoBase64,
        deliveryPhotoPath: o.deliveryPhotoPath,
        localOnly: false,
      })
      if (!r.ok) {
        return {
          ok: false,
          error: `账单 ${o.orderNo} 上传失败：${(r as any).error || '未知错误'}`,
          uploaded,
          skipped,
          pulled,
        }
      }
      uploaded.orders += 1
      report('账单', i + 1, total)
    }

    // 7. 云端有、近 10 天本机没有的订单：按单号补明细
    const localNos = new Set(localOrders.map((o) => String(o.orderNo || '').trim()).filter(Boolean))
    const recentRemote = await listAllRemoteOrderNos({ since: recentOrdersSinceIso() })
    if (recentRemote.ok) {
      const missingOnLocal = [...recentRemote.nos].filter((no) => no && !localNos.has(no))
      const cap = 40
      const toPull = missingOnLocal.slice(0, cap)
      for (let i = 0; i < toPull.length; i++) {
        report('补拉账单', i, toPull.length)
        const got = await fetchOrderByNo(toPull[i])
        if (got.ok && got.order) pulled.orders += 1
      }
    }
    report('账单', Math.max(total, 1), Math.max(total, 1))

    markPendingLocalUpload(false)
    return { ok: true, uploaded, skipped, pulled }
  } catch (e: any) {
    return {
      ok: false,
      error: String(e?.message || e || '上传异常'),
      uploaded,
      skipped,
      pulled,
    }
  }
}

export function summarizeUploadResult(r: MigrateResult): string {
  if (!r.ok) return r.error || '上传失败'
  const u = r.uploaded
  const s = r.skipped
  const p = r.pulled
  const filled: string[] = []
  if (u.shop) filled.push('店铺')
  if (u.orders) filled.push(`账单${u.orders}`)
  if (u.products) filled.push(`商品${u.products}`)
  if (u.customers) filled.push(`客户${u.customers}`)
  if (u.categories) filled.push(`分类${u.categories}`)
  const pulledBits: string[] = []
  if (p.orders) pulledBits.push(`账单${p.orders}`)
  if (p.products) pulledBits.push(`商品${p.products}`)
  if (p.customers) pulledBits.push(`客户${p.customers}`)
  const skippedN = (s.orders || 0) + (s.products || 0) + (s.customers || 0) + (s.categories || 0)
  if (!filled.length && !pulledBits.length) {
    return skippedN > 0 ? '本地与云端已对齐，无需重复同步' : '没有需要同步的数据'
  }
  const parts: string[] = []
  if (filled.length) parts.push(`已补传 ${filled.join('、')}`)
  if (pulledBits.length) parts.push(`已补拉 ${pulledBits.join('、')}`)
  if (skippedN > 0) parts.push('相同数据已跳过')
  return parts.join('，')
}

export { formatExpireLabel }
