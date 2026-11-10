/** 清除本地业务数据并同步云端（对齐 App LocalDataResetService） */

import { clearTeamDataCaches, CacheKeys, cacheRemove } from './cache'
import { clearSavedPrinter } from './bluetooth'
import { isGuest, isLoggedIn } from './session'
import { isCloudSyncAllowed, refreshEntitlement } from './subscription'
import {
  DEFAULT_ORDER_PULL_DAYS,
  fetchAllOrdersFull,
  fetchCatalog,
  fetchCustomers,
  fetchShop,
  markOrdersLastSyncNow,
  recentOrdersSinceIso,
  recentOrdersSinceMs,
  widenOrdersPullHorizon,
} from './team'
import { STMT_PREVIEW_KEY } from './analytics'
import { pullRecycleBinFromCloud } from './recycle-bin'

/** 登录态相关：清除缓存时必须保留 */
const KEEP_KEYS = new Set([
  'tuk_session',
  'tuk_client_id',
  'tuk_imageok_token',
  'tuk_guest_session',
  'tuk_mp_bind_ticket',
  'tuk_cloud_entitlement_v1',
  'tuk_dev_force_cloud_sync',
])

/** 明确要清掉的业务 / 设置 key */
const CLEAR_KEYS = [
  CacheKeys.catalog,
  CacheKeys.customers,
  CacheKeys.shop,
  CacheKeys.orders,
  CacheKeys.categories,
  'tuk_orders_cache',
  'tuk_orders_pull_horizon_ms',
  'tuk_orders_last_sync_ms',
  'tuk_print_settings_v1',
  'tuk_print_template_v1',
  'tuk_ble_printer',
  'tuk_ble_printer_paper',
  'tuk_recycle_bin_v1',
  'tuk_guest_trash_customers',
  'tuk_recent_customers',
  'tuk_pending_sheet',
  'tuk_pending_local_upload',
  STMT_PREVIEW_KEY,
  'demo_wx_logged_in',
]

export type LocalResetResult = {
  ok: boolean
  error?: string
  syncMessage?: string
}

function safeRemove(key: string) {
  try {
    wx.removeStorageSync(key)
  } catch (_) {}
}

/** 清空本地业务缓存与设置类存储，保留登录 */
export function clearLocalBusinessData() {
  clearTeamDataCaches()
  for (const k of CLEAR_KEYS) {
    cacheRemove(k)
    safeRemove(k)
  }
  try {
    clearSavedPrinter()
  } catch (_) {}

  // 扫一遍 storage：清掉其它 tuk_ 前缀业务 key，但保留登录相关
  try {
    const info = wx.getStorageInfoSync()
    for (const key of info.keys || []) {
      if (KEEP_KEYS.has(key)) continue
      if (key.startsWith('tuk_') || key.startsWith('platform.')) {
        safeRemove(key)
      }
    }
  } catch (_) {}
}

/** 登录成功后：刷新权益并拉云端店铺/商品/客户/订单 */
export async function hydrateAfterLogin(): Promise<LocalResetResult> {
  if (!isLoggedIn() || isGuest()) {
    return { ok: false, error: '请先登录账号' }
  }
  try {
    await refreshEntitlement({ force: true })
  } catch (_) {}
  if (!isCloudSyncAllowed()) {
    return { ok: true, syncMessage: '登录成功（未开通云同步）' }
  }
  try {
    const { pullPrintTemplateFromCloud } = require('./print-template') as typeof import('./print-template')
    await pullPrintTemplateFromCloud({ applyPrintOptions: true })
  } catch (_) {}
  const synced = await syncBusinessDataFromCloud()
  try {
    await pullRecycleBinFromCloud()
  } catch (_) {}
  return synced
}

/** 从云端拉取商品 / 店铺 / 客户 / 近 N 天订单（默认 10 天） */
export async function syncBusinessDataFromCloud(): Promise<LocalResetResult> {
  if (!isLoggedIn()) {
    return { ok: false, error: '请先登录账号' }
  }

  const orderDays = DEFAULT_ORDER_PULL_DAYS
  const sinceIso = recentOrdersSinceIso(orderDays)
  const [shop, cat, cust, ord] = await Promise.all([
    fetchShop(),
    fetchCatalog(),
    fetchCustomers(),
    fetchAllOrdersFull({ allCreators: true, since: sinceIso }),
  ])

  const errors: string[] = []
  if (!shop.ok) errors.push(shop.error || '店铺')
  if (!cat.ok) errors.push(cat.error || '商品')
  if (!cust.ok) errors.push(cust.error || '客户')
  if (!ord.ok) errors.push(ord.error || '账单')

  if (ord.ok) {
    widenOrdersPullHorizon(recentOrdersSinceMs(orderDays))
    markOrdersLastSyncNow()
  }

  if (errors.length === 4) {
    return {
      ok: false,
      error: errors[0] || '请检查网络后在「同步数据」重试',
    }
  }

  // 订单数放最前：登录 toast 约 20 字，避免只看到商品/客户
  const parts: string[] = []
  if (ord.ok) parts.push(`近${orderDays}天账单${ord.orders.length}`)
  if (cat.ok) parts.push(`商品${cat.products.length}`)
  if (cust.ok) parts.push(`客户${cust.customers?.length ?? 0}`)
  if (shop.ok && shop.shop?.shopName) parts.push(String(shop.shop.shopName).trim())

  const syncMessage =
    parts.length > 0 ? `已同步 ${parts.join(' ')}` : '本地已恢复默认'

  if (errors.length) {
    return {
      ok: false,
      error: errors.join('；'),
      syncMessage,
    }
  }
  return { ok: true, syncMessage }
}

/** 一键：清本地 → 已登录且已订阅则同步云端；否则只清本机 */
export async function resetAndSyncFromCloud(): Promise<LocalResetResult> {
  try {
    clearLocalBusinessData()
    if (isGuest() || !isLoggedIn()) {
      return {
        ok: true,
        syncMessage: '本地缓存已清除（游客模式不同步云端）',
      }
    }
    if (!isCloudSyncAllowed()) {
      return {
        ok: true,
        syncMessage: '本地缓存已清除（未开通云同步，不同步云端）',
      }
    }
    const synced = await syncBusinessDataFromCloud()
    try {
      await pullRecycleBinFromCloud()
    } catch (_) {}
    return synced
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
