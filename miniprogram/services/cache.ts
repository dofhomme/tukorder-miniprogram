/** 本地 + 内存缓存：加快二次进入，断网时仍可展示上次数据 */

type CacheEnvelope<T> = {
  v: T
  t: number
  clientId?: string
  /** 写入时的账号。换号后旧缓存不能再当成本账号的数据。 */
  userKey?: string
}

/** 当前缓存归属。session 反向引用本文件，这里运行时再取，避免循环依赖。 */
function currentCacheUserKey(): string {
  try {
    const session = require('./session') as typeof import('./session')
    const s = session.getSession()
    if (s && Number(s.userId) > 0) return `u:${s.userId}`
    if (session.isGuest()) return 'guest'
  } catch (_) {}
  return ''
}

function cacheBelongsToCurrentUser(env: CacheEnvelope<unknown>): boolean {
  const key = currentCacheUserKey()
  if (!key || !env.userKey) return false
  return env.userKey === key
}

const mem = new Map<string, CacheEnvelope<unknown>>()

export const CacheKeys = {
  catalog: 'tuk_cache_catalog',
  customers: 'tuk_cache_customers',
  shop: 'tuk_cache_shop',
  orders: 'tuk_cache_orders',
  /** 分类列表（游客本机 / 正式账号缓存） */
  categories: 'tuk_cache_categories',
  /** 开单人个人记忆价（货号 → 单价），对齐 App user_product_prices */
  userPrices: 'tuk_cache_user_prices',
  /** 供应链首页环形图（计数 + 未付） */
  supplyMap: 'tuk_cache_supply_map',
} as const

/** 默认过期：商品/客户 24h，订单 30min（仅作「是否优先用缓存跳过首屏空等」参考，过期仍可读） */
export const CacheTTL = {
  catalog: 24 * 60 * 60 * 1000,
  customers: 24 * 60 * 60 * 1000,
  shop: 24 * 60 * 60 * 1000,
  orders: 30 * 60 * 1000,
  categories: 24 * 60 * 60 * 1000,
  userPrices: 24 * 60 * 60 * 1000,
} as const

function readEnvelope<T>(key: string): CacheEnvelope<T> | null {
  const hit = mem.get(key) as CacheEnvelope<T> | undefined
  if (hit) return hit
  try {
    const raw = wx.getStorageSync(key)
    if (!raw || typeof raw !== 'object' || !('v' in raw) || !('t' in raw)) return null
    const env = raw as CacheEnvelope<T>
    mem.set(key, env as CacheEnvelope<unknown>)
    return env
  } catch (e) {
    return null
  }
}

export function cacheGet<T>(key: string, maxAgeMs?: number): T | null {
  const env = readEnvelope<T>(key)
  if (!env || !cacheBelongsToCurrentUser(env)) return null
  if (maxAgeMs != null && Date.now() - env.t > maxAgeMs) return null
  return env.v
}

/** 不论是否过期都取出（用于首屏秒开）。不是当前账号的缓存直接当没有。 */
export function cachePeek<T>(key: string): T | null {
  const env = readEnvelope<T>(key)
  if (!env || !cacheBelongsToCurrentUser(env)) return null
  return env.v
}

export function cacheSet<T>(key: string, value: T, clientId?: string) {
  const env: CacheEnvelope<T> = {
    v: value,
    t: Date.now(),
    clientId,
    userKey: currentCacheUserKey(),
  }
  mem.set(key, env as CacheEnvelope<unknown>)
  if (!safeSetStorage(key, env)) {
    /* 存储满时忽略，内存仍可用 */
  }
}

export function cacheRemove(key: string) {
  mem.delete(key)
  try {
    wx.removeStorageSync(key)
  } catch (e) {
    /* ignore */
  }
}

/** 退出登录 / 清除缓存时调用 */
export function clearTeamDataCaches() {
  Object.values(CacheKeys).forEach((k) => cacheRemove(k))
  try {
    wx.removeStorageSync('tuk_orders_cache')
    wx.removeStorageSync('tuk_order_sync_queue')
    wx.removeStorageSync('tuk_orders_pull_horizon_ms')
    wx.removeStorageSync('tuk_orders_last_sync_ms')
    wx.removeStorageSync('tuk_team_meta_sync_v1')
    wx.removeStorageSync('tuk_recent_customers')
  } catch (e) {
    /* ignore */
  }
}

/** 体积可能很大的业务缓存 key（可安全删除，不影响重新登录） */
const HEAVY_KEYS = [
  CacheKeys.catalog,
  CacheKeys.customers,
  CacheKeys.shop,
  CacheKeys.orders,
  CacheKeys.userPrices,
  'tuk_orders_cache',
  'tuk_order_sync_queue',
  'tuk_stmt_preview',
  'tuk_recycle_bin_v1',
  'tuk_pending_sheet',
  'tuk_recent_customers',
  'tuk_user_prices_dirty_v1',
]

function safeRemove(key: string) {
  try {
    wx.removeStorageSync(key)
  } catch (_) {}
}

/** 清理大块业务缓存，给登录态腾出 Storage 配额（微信上限约 10MB） */
export function purgeHeavyLocalStorage(): { beforeKb: number; afterKb: number } {
  let beforeKb = 0
  let afterKb = 0
  try {
    beforeKb = Number(wx.getStorageInfoSync().currentSize || 0)
  } catch (_) {}
  clearTeamDataCaches()
  for (const k of HEAVY_KEYS) safeRemove(k)
  try {
    const info = wx.getStorageInfoSync()
    afterKb = Number(info.currentSize || 0)
    // 再扫一遍：清掉其它非登录 tuk_ 大 key
    const keep = new Set([
      'tuk_session',
      'tuk_client_id',
      'tuk_imageok_token',
      'tuk_mp_bind_ticket',
      'tuk_logout_notice',
    ])
    for (const key of info.keys || []) {
      if (keep.has(key)) continue
      if (key.startsWith('tuk_cache_') || key === 'tuk_orders_cache' || key === 'tuk_stmt_preview') {
        safeRemove(key)
      }
    }
    afterKb = Number(wx.getStorageInfoSync().currentSize || 0)
  } catch (_) {}
  return { beforeKb, afterKb }
}

/** 接近或超过配额时主动腾空间（单位 KB） */
export function ensureStorageHeadroom(minFreeKb = 512): boolean {
  try {
    const info = wx.getStorageInfoSync()
    const used = Number(info.currentSize || 0)
    const limit = Number(info.limitSize || 10240)
    if (limit - used >= minFreeKb && used < limit * 0.85) return true
    purgeHeavyLocalStorage()
    const after = wx.getStorageInfoSync()
    return Number(after.limitSize || 10240) - Number(after.currentSize || 0) >= Math.min(minFreeKb, 128)
  } catch (_) {
    return false
  }
}

/** 写入 Storage；配额满时清大缓存后重试一次 */
export function safeSetStorage(key: string, value: unknown): boolean {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (e) {
    const msg = String((e as { errMsg?: string })?.errMsg || e || '')
    if (!/exceed|max size|storage/i.test(msg)) {
      try {
        purgeHeavyLocalStorage()
        wx.setStorageSync(key, value)
        return true
      } catch (_) {
        return false
      }
    }
    purgeHeavyLocalStorage()
    try {
      wx.setStorageSync(key, value)
      return true
    } catch (_) {
      return false
    }
  }
}
