/** 云同步订阅：套餐1 月9.9/年59（1座）；套餐2 月19.9/年119（10座） */

import { request } from './api'
import { t } from './i18n'
import { isLoggedIn } from './session'
import { requestPurchaseSubscribe, sendPurchaseNotice } from './subscribe'

export type SubPlan = 'monthly' | 'yearly' | 'team_monthly' | 'team_yearly'
export type SubStatus = 'active' | 'expired' | 'none'
export type GrantSource = 'self' | 'shop_seat' | 'none'

const ALL_PLAN_IDS: SubPlan[] = ['monthly', 'yearly', 'team_monthly', 'team_yearly']

export function isSubPlan(id: string): id is SubPlan {
  return ALL_PLAN_IDS.indexOf(id as SubPlan) >= 0
}

export function planCycle(id: string): 'year' | 'month' {
  return id === 'yearly' || id === 'team_yearly' ? 'year' : 'month'
}

export interface Entitlement {
  status: SubStatus
  plan: SubPlan | null
  expireAt: string | null
  priceFen: number | null
  source: 'cloud' | 'local_mock' | 'dev_force'
  grantSource: GrantSource
  cloudActive: boolean
  seatLimit: number
  fetchedAt: number
}

export type CatalogPlan = {
  id: SubPlan
  group: string
  groupTitle: string
  title: string
  priceLabel: string
  priceFen: number
  days: number
  hint: string
  productId: string
  seatLimit: number
  cycle: string
  recommend?: boolean
  priceAmount?: string
  perDayLabel?: string
}

export type CatalogGroup = {
  id: string
  title: string
  seatLimit: number
  seatHint: string
  plans: CatalogPlan[]
}

/** 须与 MP 虚拟支付「道具管理」里的道具 ID 一致；价格以后端目录为准 */
export const SUB_PLANS: CatalogPlan[] = [
  {
    id: 'monthly',
    group: 'basic',
    groupTitle: '套餐1 基础版',
    title: '月卡',
    priceLabel: '¥9.9',
    priceFen: 990,
    days: 30,
    hint: '含 1 名跟随员工 · 30 天',
    productId: 'cloud_sync_monthly',
    seatLimit: 1,
    cycle: 'month',
  },
  {
    id: 'yearly',
    group: 'basic',
    groupTitle: '套餐1 基础版',
    title: '年卡',
    priceLabel: '¥59',
    priceFen: 5900,
    days: 365,
    hint: '含 1 名跟随员工 · 365 天',
    productId: 'cloud_sync_yearly',
    seatLimit: 1,
    cycle: 'year',
    recommend: true,
  },
  {
    id: 'team_monthly',
    group: 'team',
    groupTitle: '套餐2 团队版',
    title: '月卡',
    priceLabel: '¥19.9',
    priceFen: 1990,
    days: 30,
    hint: '含 10 名跟随员工 · 30 天',
    productId: 'cloud_team_monthly',
    seatLimit: 10,
    cycle: 'month',
  },
  {
    id: 'team_yearly',
    group: 'team',
    groupTitle: '套餐2 团队版',
    title: '年卡',
    priceLabel: '¥119',
    priceFen: 11900,
    days: 365,
    hint: '含 10 名跟随员工 · 365 天',
    productId: 'cloud_team_yearly',
    seatLimit: 10,
    cycle: 'year',
    recommend: true,
  },
]

export function fallbackPlanGroups(): CatalogGroup[] {
  const by: Record<string, CatalogGroup> = {}
  const groups: CatalogGroup[] = []
  for (const p of SUB_PLANS) {
    if (!by[p.group]) {
      by[p.group] = {
        id: p.group,
        title: p.groupTitle,
        seatLimit: p.seatLimit,
        seatHint: t('seatHint').replace('{n}', String(p.seatLimit)),
        plans: [],
      }
      groups.push(by[p.group])
    }
    by[p.group].plans.push(presentPlan(p))
  }
  return groups
}

/** 卡片上拆开的金额和日均价。价格仍以服务端目录为准。 */
export function presentPlan(p: CatalogPlan): CatalogPlan {
  const fen = Number(p.priceFen || 0)
  const yuan = fen / 100
  const priceAmount =
    fen > 0 ? (fen % 100 === 0 ? String(Math.round(yuan)) : yuan.toFixed(1)) : String(p.priceLabel || '').replace(/^¥/, '')
  const perDay = p.days > 0 && fen > 0 ? yuan / p.days : 0
  return {
    ...p,
    priceAmount,
    perDayLabel: perDay > 0 ? `约 ¥${perDay.toFixed(2)}/天` : '',
  }
}

export async function fetchPlanCatalog(): Promise<CatalogGroup[]> {
  const fallback = fallbackPlanGroups()
  try {
    const res = await request<{
      groups?: Array<{
        id?: string
        title?: string
        seatLimit?: number
        plans?: Array<{
          id?: string
          group?: string
          groupTitle?: string
          title?: string
          priceLabel?: string
          priceFen?: number
          days?: number
          hint?: string
          productId?: string
          seatLimit?: number
          cycle?: string
          recommend?: boolean
        }>
      }>
    }>({
      path: '/api/v1/billing/plans',
      method: 'GET',
      needAuth: false,
      skipAuthKick: true,
    })
    const raw = Array.isArray(res.data?.groups) ? res.data!.groups : []
    const groups: CatalogGroup[] = []
    for (const g of raw) {
      const plans: CatalogPlan[] = []
      for (const p of g.plans || []) {
        const id = String(p.id || '')
        if (!isSubPlan(id)) continue
        const local = SUB_PLANS.find((x) => x.id === id)
        plans.push({
          id,
          group: String(p.group || g.id || local?.group || ''),
          groupTitle: String(p.groupTitle || g.title || local?.groupTitle || ''),
          title: String(p.title || local?.title || id),
          priceLabel: String(p.priceLabel || local?.priceLabel || ''),
          priceFen: typeof p.priceFen === 'number' ? p.priceFen : local?.priceFen || 0,
          days: typeof p.days === 'number' ? p.days : local?.days || 30,
          hint: String(p.hint || local?.hint || ''),
          productId: String(p.productId || local?.productId || ''),
          seatLimit: typeof p.seatLimit === 'number' ? p.seatLimit : local?.seatLimit || 0,
          cycle: String(p.cycle || local?.cycle || 'month'),
          recommend: !!p.recommend,
        })
        plans[plans.length - 1] = presentPlan(plans[plans.length - 1])
      }
      if (!plans.length) continue
      const seatLimit = typeof g.seatLimit === 'number' ? g.seatLimit : plans[0].seatLimit
      groups.push({
        id: String(g.id || plans[0].group),
        title: String(g.title || plans[0].groupTitle),
        seatLimit,
        seatHint: t('seatHint').replace('{n}', String(seatLimit)),
        plans,
      })
    }
    if (groups.length) return groups
  } catch (_) {}
  return fallback
}

/** 虚拟支付 offerId（可公开；签名密钥只在服务端） */
export const XPAY_OFFER_ID = '1450634243'

const ENTITLEMENT_KEY = 'tuk_cloud_entitlement_v1'
const DEV_FORCE_KEY = 'tuk_dev_force_cloud_sync'
/** 后端 create 未就绪时本地 Mock；线上已接虚拟支付后为 false */
export const BILLING_MOCK_ENABLED = false

const CACHE_TTL_MS = 10 * 60 * 1000

function emptyEntitlement(partial?: Partial<Entitlement>): Entitlement {
  return {
    status: 'none',
    plan: null,
    expireAt: null,
    priceFen: null,
    source: 'local_mock',
    grantSource: 'none',
    cloudActive: false,
    seatLimit: 0,
    fetchedAt: Date.now(),
    ...partial,
  }
}

export function getDevForceCloudSync(): boolean {
  try {
    if (wx.getAccountInfoSync().miniProgram.envVersion !== 'develop') return false
    return !!wx.getStorageSync(DEV_FORCE_KEY)
  } catch {
    return false
  }
}

export function setDevForceCloudSync(on: boolean) {
  try {
    if (on) wx.setStorageSync(DEV_FORCE_KEY, 1)
    else wx.removeStorageSync(DEV_FORCE_KEY)
  } catch (_) {}
}

export function peekEntitlement(): Entitlement {
  if (getDevForceCloudSync()) {
    return emptyEntitlement({
      status: 'active',
      plan: 'yearly',
      expireAt: new Date(Date.now() + 365 * 86400000).toISOString(),
      priceFen: 5900,
      source: 'dev_force',
    })
  }
  try {
    const raw = wx.getStorageSync(ENTITLEMENT_KEY)
    if (!raw || typeof raw !== 'object') return emptyEntitlement()
    const e = raw as Entitlement
    if (e.status === 'active' && e.expireAt) {
      const t = Date.parse(e.expireAt)
      if (Number.isFinite(t) && t <= Date.now()) {
        const expired = { ...e, status: 'expired' as const, fetchedAt: Date.now() }
        writeEntitlement(expired)
        return expired
      }
    }
    return e
  } catch {
    return emptyEntitlement()
  }
}

function writeEntitlement(e: Entitlement) {
  try {
    wx.setStorageSync(ENTITLEMENT_KEY, e)
  } catch (_) {}
}

export function clearEntitlementCache() {
  try {
    wx.removeStorageSync(ENTITLEMENT_KEY)
  } catch (_) {}
}

export function isCloudSyncAllowed(): boolean {
  if (!isLoggedIn()) return false
  if (getDevForceCloudSync()) return true
  const e = peekEntitlement()
  const flagged = e.cloudActive === true || e.status === 'active'
  if (!flagged) return false
  if (!e.expireAt) return e.cloudActive === true || e.status === 'active'
  const t = Date.parse(e.expireAt)
  return Number.isFinite(t) ? t > Date.now() : false
}

export function getEntitlement(): Entitlement {
  return peekEntitlement()
}

function applyStatusPayload(data: {
  status?: string
  plan?: string | null
  expireAt?: string | null
  priceFen?: number | null
  cloudActive?: boolean
  source?: string
  seatLimit?: number
} | null): Entitlement {
  const statusRaw = String(data?.status || 'none')
  const status: SubStatus =
    statusRaw === 'active' || statusRaw === 'expired' ? statusRaw : 'none'
  const planRaw = String(data?.plan || '')
  const plan: SubPlan | null = isSubPlan(planRaw) ? planRaw : null
  const grantRaw = String(data?.source || '')
  const grantSource: GrantSource =
    grantRaw === 'shop_seat' ? 'shop_seat' : grantRaw === 'self' ? 'self' : 'none'
  const cloudActive =
    data?.cloudActive === true || (data?.cloudActive !== false && status === 'active')
  const next = emptyEntitlement({
    status,
    plan,
    expireAt: data?.expireAt ? String(data.expireAt) : null,
    priceFen: typeof data?.priceFen === 'number' ? data.priceFen : null,
    source: 'cloud',
    grantSource,
    cloudActive,
    seatLimit: typeof data?.seatLimit === 'number' ? data.seatLimit : 0,
    fetchedAt: Date.now(),
  })
  writeEntitlement(next)
  return next
}

export async function refreshEntitlement(opts?: {
  force?: boolean
}): Promise<Entitlement> {
  if (!isLoggedIn()) {
    clearEntitlementCache()
    return emptyEntitlement()
  }
  if (getDevForceCloudSync()) return peekEntitlement()

  const cached = peekEntitlement()
  if (
    !opts?.force &&
    cached.source === 'cloud' &&
    Date.now() - (cached.fetchedAt || 0) < CACHE_TTL_MS
  ) {
    return cached
  }

  const res = await request<{
    status?: string
    plan?: string | null
    expireAt?: string | null
    priceFen?: number | null
    cloudActive?: boolean
    source?: string
    seatLimit?: number
  }>({
    path: '/api/v1/billing/subscription/status',
    method: 'GET',
    skipAuthKick: true,
  })

  if (res.ok && res.data) {
    return applyStatusPayload(res.data)
  }

  if (cached.source === 'local_mock' || cached.source === 'cloud') {
    return cached
  }
  return emptyEntitlement({ fetchedAt: Date.now() })
}

export type VirtualPayParams = {
  mode: 'short_series_goods'
  /** JSON 字符串，须原样传给 wx.requestVirtualPayment */
  signData: string
  paySig: string
  signature: string
  orderId?: string
}

export type CreateSubResult =
  | { ok: true; mode: 'xpay'; pay: VirtualPayParams }
  | { ok: true; mode: 'mock'; entitlement: Entitlement }
  | { ok: false; error: string }

function wxLoginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (r) => {
        const code = String(r?.code || '').trim()
        if (code) resolve(code)
        else reject(new Error('wx.login 未返回 code'))
      },
      fail: (e) => reject(new Error(String((e as any)?.errMsg || 'wx.login 失败'))),
    })
  })
}

/** 创建订阅订单；服务端用最新 code 换 session_key 后签名 */
export async function createSubscription(plan: SubPlan): Promise<CreateSubResult> {
  if (!isLoggedIn()) return { ok: false, error: '请先登录' }
  const meta = SUB_PLANS.find((p) => p.id === plan)
  if (!meta) return { ok: false, error: '无效套餐' }

  let code = ''
  try {
    code = await wxLoginCode()
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || '微信登录失败' }
  }

  const res = await request<{
    mock?: boolean
    mode?: string
    signData?: string
    paySig?: string
    signature?: string
    orderId?: string
    status?: string
    plan?: string
    expireAt?: string
    priceFen?: number
  }>({
    path: '/api/v1/billing/subscription/create',
    method: 'POST',
    data: {
      plan,
      code,
    },
    skipAuthKick: true,
  })

  if (
    res.ok &&
    res.data?.signData &&
    res.data?.paySig &&
    res.data?.signature
  ) {
    return {
      ok: true,
      mode: 'xpay',
      pay: {
        mode: 'short_series_goods',
        signData: String(res.data.signData),
        paySig: String(res.data.paySig),
        signature: String(res.data.signature),
        orderId: res.data.orderId,
      },
    }
  }

  if (res.ok && (res.data?.mock || res.data?.status === 'active')) {
    const ent = applyStatusPayload({
      status: 'active',
      plan,
      expireAt:
        res.data?.expireAt ||
        new Date(Date.now() + meta.days * 86400000).toISOString(),
      priceFen: res.data?.priceFen ?? meta.priceFen,
    })
    if (res.data?.mock) {
      const local = { ...ent, source: 'local_mock' as const }
      writeEntitlement(local)
      return { ok: true, mode: 'mock', entitlement: local }
    }
    return { ok: true, mode: 'mock', entitlement: ent }
  }

  if (BILLING_MOCK_ENABLED) {
    const local = emptyEntitlement({
      status: 'active',
      plan,
      expireAt: new Date(Date.now() + meta.days * 86400000).toISOString(),
      priceFen: meta.priceFen,
      source: 'local_mock',
    })
    writeEntitlement(local)
    return { ok: true, mode: 'mock', entitlement: local }
  }

  return { ok: false, error: res.message || '下单失败，请稍后重试' }
}

function canUseVirtualPayment(): boolean {
  try {
    const v = wx.getSystemInfoSync().SDKVersion || '0'
    const parts = String(v)
      .split('.')
      .map((x) => parseInt(x, 10) || 0)
    const n = (parts[0] || 0) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0)
    if (n >= 21902) return true
  } catch (_) {}
  try {
    return !!(wx as any).canIUse && wx.canIUse('requestVirtualPayment')
  } catch {
    return false
  }
}

/** 调起小程序虚拟支付（道具直购） */
export function requestVirtualPayment(pay: VirtualPayParams): Promise<{
  ok: boolean
  error?: string
}> {
  return new Promise((resolve) => {
    if (!canUseVirtualPayment()) {
      resolve({ ok: false, error: '当前微信版本不支持虚拟支付，请升级微信' })
      return
    }
    const api = (wx as any).requestVirtualPayment
    if (typeof api !== 'function') {
      resolve({ ok: false, error: '当前基础库不支持虚拟支付' })
      return
    }
    api({
      mode: pay.mode,
      signData: pay.signData,
      paySig: pay.paySig,
      signature: pay.signature,
      success: () => resolve({ ok: true }),
      fail: (err: { errMsg?: string; errCode?: number }) => {
        const msg = String(err?.errMsg || '')
        if (/cancel/i.test(msg)) {
          resolve({ ok: false, error: '已取消支付' })
          return
        }
        // 虚拟支付内部会走 WechatChannel → requestPayment；no permission 多为 MP 未开通虚拟支付/类目/主体限制
        if (/no permission|access denied|banned|jsapi has no permission/i.test(msg)) {
          resolve({
            ok: false,
            error:
              '支付无权限：请确认小程序已开通「虚拟支付」、非个人主体，道具已发布，并用真机测试（沙盒需加体验者）',
          })
          return
        }
        resolve({
          ok: false,
          error: msg || `支付失败(${err?.errCode || ''})`,
        })
      },
    })
  })
}

/** 支付成功后主动让服务端查单发货（不依赖推送） */
async function confirmSubscriptionOrder(orderId?: string): Promise<Entitlement | null> {
  const id = String(orderId || '').trim()
  if (!id) return null
  try {
    const res = await request<{
      status?: string
      plan?: string | null
      expireAt?: string | null
      priceFen?: number | null
      confirmed?: boolean
    }>({
      path: '/api/v1/billing/subscription/confirm',
      method: 'POST',
      data: { orderId: id },
      skipAuthKick: true,
    })
    if (res.ok && res.data) {
      return applyStatusPayload(res.data)
    }
  } catch (_) {}
  return null
}

async function pollEntitlementUntilActive(
  plan: SubPlan,
  orderId?: string,
  tries = 6,
): Promise<{ ok: boolean; entitlement?: Entitlement; error?: string }> {
  // 先主动确认（query_order 发货），再短轮询推送结果
  const confirmed = await confirmSubscriptionOrder(orderId)
  if (confirmed && isCloudSyncAllowed()) {
    return { ok: true, entitlement: confirmed }
  }
  for (let i = 0; i < tries; i++) {
    if (i > 0 && i % 2 === 0) {
      await confirmSubscriptionOrder(orderId)
    }
    const e = await refreshEntitlement({ force: true })
    if (isCloudSyncAllowed()) return { ok: true, entitlement: e }
    await new Promise((r) => setTimeout(r, 280 + i * 120))
  }
  // 不本地乐观开通：支付成功但回调未到时，提示稍后刷新，避免白嫖云同步
  const e = await refreshEntitlement({ force: true })
  if (isCloudSyncAllowed()) return { ok: true, entitlement: e }
  return {
    ok: false,
    error: '支付已提交，权益开通稍有延迟，请稍后下拉刷新或重进本页',
    entitlement: e,
  }
}

export async function purchasePlan(
  plan: SubPlan,
  opts?: {
    /** 收银台关闭且支付成功后立刻回调（早于权益轮询） */
    onPaid?: () => void
  },
): Promise<{
  ok: boolean
  error?: string
  entitlement?: Entitlement
  /** 是否走过真实收银台（非 mock） */
  paid?: boolean
}> {
  const created = await createSubscription(plan)
  if (!created.ok) return { ok: false, error: created.error }

  if (created.mode === 'mock') {
    return { ok: true, entitlement: created.entitlement, paid: false }
  }

  const pay = await requestVirtualPayment(created.pay)
  if (!pay.ok) return { ok: false, error: pay.error, paid: false }

  // 必须紧跟支付 success：先弹订阅（用户手势链），否则 iOS 经常弹不出
  let accepted = false
  try {
    accepted = await requestPurchaseSubscribe()
  } catch (_) {}

  try {
    opts?.onPaid?.()
  } catch (_) {}

  const r = await pollEntitlementUntilActive(plan, created.pay.orderId)

  // 开通成功后再发（模板要有效期）；未开通则短重试，避免权益未落库就标记已发
  if (accepted) {
    const orderId = created.pay.orderId
    for (let i = 0; i < 4; i++) {
      try {
        const sent = await sendPurchaseNotice(orderId)
        if (sent) break
      } catch (_) {}
      if (i < 3) await new Promise((res) => setTimeout(res, 400 + i * 200))
    }
  }
  return { ...r, paid: true }
}

export type BillingOrder = {
  orderId: string
  plan: string
  planTitle: string
  priceFen: number
  priceLabel: string
  status: string
  days?: number
  createdAt: string | null
  deliveredAt: string | null
}

export async function fetchBillingOrders(): Promise<{
  ok: boolean
  orders: BillingOrder[]
  error?: string
}> {
  if (!isLoggedIn()) return { ok: false, orders: [], error: '请先登录' }
  try {
    const res = await request<{ orders?: BillingOrder[] }>({
      path: '/api/v1/billing/subscription/orders',
      method: 'GET',
      skipAuthKick: true,
    })
    if (!res.ok) return { ok: false, orders: [], error: res.message }
    const list = Array.isArray(res.data?.orders) ? res.data!.orders : []
    return { ok: true, orders: list }
  } catch {
    return { ok: false, orders: [], error: '加载失败' }
  }
}

export type BillingOrderView = BillingOrder & {
  statusLabel: string
  timeLabel: string
  dateLabel: string
  daysLabel: string
}

export function billingStatusLabel(status: string): string {
  if (status === 'delivered') return t('billingDelivered')
  if (status === 'pending') return t('billingPending')
  return t('billingClosed')
}

export function billingTimeLabel(iso: string | null): string {
  const ts = Date.parse(String(iso || ''))
  if (!Number.isFinite(ts)) return ''
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function billingDateLabel(iso: string | null): string {
  const ts = Date.parse(String(iso || ''))
  if (!Number.isFinite(ts)) return ''
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function decorateBillingOrders(list: BillingOrder[]): BillingOrderView[] {
  return list.map((o) => {
    const days = Number(o.days) || (planCycle(o.plan) === 'year' ? 365 : 30)
    return {
      ...o,
      statusLabel: billingStatusLabel(o.status),
      timeLabel: billingTimeLabel(o.deliveredAt || o.createdAt),
      dateLabel: billingDateLabel(o.deliveredAt || o.createdAt),
      daysLabel: t('billingDays').replace('{n}', String(days)),
    }
  })
}

export function formatExpireLabel(e: Entitlement): string {
  if (e.status !== 'active' || !e.expireAt) return t('cloudOff')
  const ts = Date.parse(e.expireAt)
  if (!Number.isFinite(ts)) return t('cloudOn')
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t('expireUntil')} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
