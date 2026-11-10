/** 扫码查账 / 代理广场申请 */

import { API_BASE, request } from './api'
import { mediaUrl } from './media'
import { getSession, isGuest, isLoggedIn } from './session'
import { ensureArrivalQrImage } from '../utils/arrival-qr'

export const LOOKUP_QR_HINT = '扫码查账'

export interface LookupOrder {
  token?: string
  lookupUrl?: string
  synced?: boolean
  message?: string
  shopName?: string
  ownerUserId?: number
  orderNo?: string
  customerName?: string
  customerPhone?: string
  remark?: string
  totalAmount?: number
  totalQuantity?: number
  createdAt?: string | null
  isReturn?: boolean
  isPaid?: boolean
  isPickedUp?: boolean
  isShipped?: boolean
  isDelivered?: boolean
  trackingNos?: string[]
  hasDeliveryPhoto?: boolean
  photoUrl?: string
  rejectReason?: string
  agentFulfillment?: string
  unpaidAmount?: number
  /** 公开查账链：只读凭证 */
  readonly?: boolean
  publicChain?: boolean
  chainId?: string
  sealedAt?: string | null
  chainHint?: string
  signature?: string
  signatureAlg?: string
  signatureValid?: boolean
  /** 打印预览展示（非上链正文） */
  templateId?: string
  headerTitle?: string
  footer?: string
  printPaymentQr?: boolean
  showPayQr?: boolean
  qrHint?: string
  wechatQrBase64?: string
  alipayQrBase64?: string
  items?: Array<{
    productCode?: string
    productName?: string
    spec?: string
    unit?: string
    quantity?: number
    price?: number
    subtotal?: number
  }>
}

export interface AgentBinding {
  ownerUserId: number
  customerUid: string
  customerName: string
  phone?: string
  shopName: string
  unpaidAmount: number
  acceptAgentOrders?: boolean
  merchantExpired?: boolean
  role?: 'admin' | 'staff' | string
}

export interface AgentProfile {
  displayName?: string
  phone?: string
  complete?: boolean
}

export interface AgentCatalogProduct {
  code: string
  name: string
  ownerUserId?: number
  shopName?: string
  unit?: string
  /** 代理价（客户上次成交价，无则同原价） */
  price: number
  /** 原价（商品库售价） */
  basePrice?: number
  agentPrice?: number
  stock?: number | null
  category?: string
  hasSku?: boolean
  colors?: string[]
  sizes?: string[]
  skus?: Array<{ color: string; size: string; stock?: number | null }>
  countInStats?: boolean
  imageUrls?: string[]
  isNewArrival?: boolean
  watching?: boolean
  newArrivalAt?: string | null
  coverUrl?: string
  imageCount?: number
  stockLevel?: 'in' | 'low' | 'out'
  suggestedRetailPrice?: number | null
  videoUrl?: string
}

export function agentOrderKind(remark?: string | null): 'pending' | 'rejected' | 'agent' | '' {
  const s = String(remark || '').trim()
  if (s.startsWith('代理待开')) return 'pending'
  if (s.startsWith('代理打回')) return 'rejected'
  if (s.startsWith('代理')) return 'agent'
  return ''
}

export function parseRejectReason(remark?: string | null): string {
  const s = String(remark || '').trim()
  if (!s.startsWith('代理打回')) return ''
  return s.slice(4).trim()
}

export function confirmAgentRemark(remark?: string | null): string {
  const s = String(remark || '')
  if (s.startsWith('代理待开')) return (`代理${s.slice(4)}`).trim() || '代理'
  return s || '代理'
}

export function parseAgentShip(remark?: string | null): {
  name: string
  phone: string
  address: string
  urgent: boolean
  note: string
} {
  const raw = String(remark || '').trim()
  const urgent = /(?:^|\s)加急(?:\s|$)/.test(raw)
  let name = ''
  let phone = ''
  let address = ''
  let note = ''
  const rest = raw.replace(/^代理待开\s*/, '').replace(/^代理\s*/, '')
  const m = rest.match(/^收件:(\S*)\s+(\S*)\s+(.*)$/)
  if (m) {
    name = m[1] || ''
    phone = m[2] || ''
    let tail = (m[3] || '').trim()
    tail = tail.replace(/(?:^|\s)加急(?:\s|$)/, ' ').trim()
    address = tail
    note = ''
  } else {
    note = rest.replace(/(?:^|\s)加急(?:\s|$)/, ' ').trim()
  }
  return { name, phone, address, urgent, note }
}

export function agentFulfillmentOf(o: {
  remark?: string | null
  isShipped?: boolean
  isDelivered?: boolean
}): 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'rejected' | '' {
  if (o.isDelivered) return agentOrderKind(o.remark) ? 'delivered' : ''
  if (o.isShipped) return agentOrderKind(o.remark) ? 'shipped' : ''
  const kind = agentOrderKind(o.remark)
  if (kind === 'pending') return 'pending'
  if (kind === 'rejected') return 'rejected'
  if (kind === 'agent') return 'confirmed'
  return ''
}

const AGENT_BOUND_KEY = 'tuk_agent_bound_v1'

let _pendingStallInvite = ''
let _pendingStaffInvite = ''
let _pendingMerchantInvite = ''
const _consumedInviteKeys: Record<string, true> = {}

export function isStallInviteToken(raw: string) {
  return /^i\.[A-Za-z0-9._-]+/.test(String(raw || '').trim())
}

export function isAgentBindToken(raw: string) {
  return /^a\.[A-Za-z0-9_-]+\.[0-9a-f]{32}$/.test(String(raw || '').trim())
}

export function isStaffInviteToken(raw: string) {
  return /^s\.[A-Za-z0-9._-]+/.test(String(raw || '').trim())
}

export function isMerchantOpenToken(raw: string) {
  return /^m\.[A-Za-z0-9._-]+/.test(String(raw || '').trim())
}

const GENERIC_INVITE_SHOPS = new Set(['', '图可开单打印', '图可开单', '图可科技', 'تۇكە زاكاز بېسىش'])

export function merchantOpenShareTitle(inviterName?: string) {
  const name = String(inviterName || '').trim()
  if (!name || GENERIC_INVITE_SHOPS.has(name)) return '邀请开通图可开单'
  return `${name}邀请开通图可开单`
}

export const MERCHANT_OPEN_SHARE_IMAGE = mediaUrl('invite-open-cover.jpg')

export function merchantOpenShareMessage(token?: string, shopName?: string) {
  const tok = String(token || '').trim()
  const shop = String(shopName || '').trim()
  const q = [`invite=${encodeURIComponent(tok)}`]
  if (shop && !GENERIC_INVITE_SHOPS.has(shop)) q.push(`shop=${encodeURIComponent(shop)}`)
  return {
    title: merchantOpenShareTitle(shop),
    path: tok ? `/pages/login/login?${q.join('&')}` : '/pages/home/home',
    imageUrl: MERCHANT_OPEN_SHARE_IMAGE,
  }
}

function rememberPendingInvite(kind: 'stall' | 'staff' | 'merchant', token: string) {
  const t = String(token || '').trim()
  if (!t || _consumedInviteKeys[`${kind}:${t}`]) return
  if (kind === 'staff') _pendingStaffInvite = t
  else if (kind === 'merchant') _pendingMerchantInvite = t
  else _pendingStallInvite = t
}

export function queryHasInviteToken(query?: Record<string, unknown> | null) {
  const parsed = extractInviteToken(
    String((query && (query.invite || query.token || query.staffInvite)) || ''),
  )
  return !!(parsed.invite || parsed.staffInvite || parsed.merchantInvite || parsed.agentBind)
}

/** 真正从分享/扫码进来才消化邀请。仅开发版普通编译忽略残留 query，正式版不受影响。 */
export function shouldConsumeLaunchInvites(pageQuery?: Record<string, unknown> | null) {
  try {
    const env = wx.getAccountInfoSync().miniProgram.envVersion
    const opts = wx.getEnterOptionsSync ? wx.getEnterOptionsSync() : null
    const scene = Number(opts?.scene || 0)
    if (env === 'develop' && (scene === 1001 || scene === 1005)) return false
  } catch (_) {}
  if (queryHasInviteToken(pageQuery)) return true
  try {
    const opts = wx.getEnterOptionsSync ? wx.getEnterOptionsSync() : null
    return queryHasInviteToken((opts?.query || {}) as Record<string, unknown>)
  } catch (_) {
    return false
  }
}

/** 邀请代理码里的档口编号。小程序码 scene 为 ao{店主编号}，明文链接为 owner=。 */
export function parseAgentOwnerQuery(query?: Record<string, unknown> | null): number {
  const q = query || {}
  const direct = Number(q.owner || 0)
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct)
  let scene = String(q.scene || '').trim()
  try {
    scene = decodeURIComponent(scene)
  } catch (_) {}
  const m = /^ao(\d{1,12})$/.exec(scene)
  return m ? Number(m[1]) : 0
}

/** 当前登录号就是这张邀请码的本店老板或员工 */
export function isOwnAgentInvite(ownerId: number): boolean {
  if (!ownerId || !isLoggedIn() || isGuest()) return false
  const session = getSession()
  if (!session) return false
  if (Number(session.userId) === ownerId) return true
  return Number(session.team?.ownerUserId) === ownerId
}

let _ownInvitePromptAt = 0

/** 本店账号扫自己的邀请码时必须有提示，不能静默回到首页 */
export function promptOwnAgentInvite() {
  const now = Date.now()
  if (now - _ownInvitePromptAt < 4000) return
  _ownInvitePromptAt = now
  wx.showModal({
    title: '这是你自己的邀请',
    content: '本店账号不能申请成为自己的代理。请让客户用他们的微信扫这个码。',
    showCancel: false,
    confirmText: '知道了',
    success: () => {
      const pages = getCurrentPages()
      const route = pages.length ? String(pages[pages.length - 1].route || '') : ''
      if (route === 'pages/login/login') {
        wx.switchTab({ url: '/pages/home/home' })
      }
    },
  })
}

const AGENT_INVITE_SCENES = new Set([1047, 1048, 1049, 1065, 1194, 1286])
let _handledAgentInvite = ''
let _handledAgentInviteAt = 0

/**
 * 扫邀请码时，已在前台的小程序常常不跳登录页。
 * 这里按本次进入参数处理：自己的号提示，别人的号进代理登录。
 */
export function handleScannedAgentInvite(options?: {
  scene?: number
  query?: Record<string, unknown> | null
} | null) {
  const query = options?.query || {}
  const owner = parseAgentOwnerQuery(query)
  if (!owner) return
  const scene = Number(options?.scene || 0)
  const modeAgent = String(query.mode || '') === 'agent'
  if (scene && !AGENT_INVITE_SCENES.has(scene) && !modeAgent) return
  const key = `${owner}`
  const now = Date.now()
  if (_handledAgentInvite === key && now - _handledAgentInviteAt < 15000) return
  _handledAgentInvite = key
  _handledAgentInviteAt = now
  if (isOwnAgentInvite(owner)) {
    promptOwnAgentInvite()
    return
  }
  const pages = getCurrentPages()
  const route = pages.length ? String(pages[pages.length - 1].route || '') : ''
  if (!route || route === 'pages/login/login') return
  wx.reLaunch({ url: `/pages/login/login?mode=agent&stay=1&owner=${owner}` })
}

/** 分享进 tabBar 首页时，热启动可能不走 onLoad，先把邀请码存下来。 */
export function captureLaunchInvites(query?: Record<string, unknown> | null) {
  const q = query || {}
  const invite = String(q.invite || '').trim()
  const staff = String(q.staffInvite || '').trim()
  const token = String(q.token || '').trim()
  // 只认代理邀请 i./员工 s./开通商家 m.；查账 token（o.）绝不能当邀请
  if (isStaffInviteToken(staff) || isStaffInviteToken(invite) || isStaffInviteToken(token)) {
    rememberPendingInvite(
      'staff',
      isStaffInviteToken(staff) ? staff : isStaffInviteToken(invite) ? invite : token,
    )
  }
  if (isMerchantOpenToken(invite) || isMerchantOpenToken(token)) {
    rememberPendingInvite('merchant', isMerchantOpenToken(invite) ? invite : token)
  }
  if (isStallInviteToken(invite) || isStallInviteToken(token)) {
    rememberPendingInvite('stall', isStallInviteToken(invite) ? invite : token)
  }
}

export function takePendingStallInvite() {
  const v = _pendingStallInvite
  _pendingStallInvite = ''
  if (v) _consumedInviteKeys[`stall:${v}`] = true
  return v
}

export function takePendingStaffInvite() {
  const v = _pendingStaffInvite
  _pendingStaffInvite = ''
  if (v) _consumedInviteKeys[`staff:${v}`] = true
  return v
}

export function takePendingMerchantInvite() {
  const v = _pendingMerchantInvite
  _pendingMerchantInvite = ''
  if (v) _consumedInviteKeys[`merchant:${v}`] = true
  return v
}

/** 从粘贴的邀请码、链接或分享 path 里抽出档口绑定 / 员工 / 开通商家令牌。 */
export function extractInviteToken(raw: string): {
  invite?: string
  staffInvite?: string
  merchantInvite?: string
  agentBind?: string
} {
  let s = String(raw || '').trim()
  if (!s) return {}
  try {
    s = decodeURIComponent(s)
  } catch (_) {}
  const staffQ = s.match(/[?&]staffInvite=([^&\s#]+)/i)
  if (staffQ) {
    const v = decodeURIComponent(staffQ[1])
    return isStaffInviteToken(v) ? { staffInvite: v } : {}
  }
  const inviteQ = s.match(/[?&](?:invite|token)=([^&\s#]+)/i)
  if (inviteQ) {
    const v = decodeURIComponent(inviteQ[1])
    if (isStaffInviteToken(v)) return { staffInvite: v }
    if (isMerchantOpenToken(v)) return { merchantInvite: v }
    if (isAgentBindToken(v)) return { agentBind: v }
    if (isStallInviteToken(v)) return { invite: v }
    return {}
  }
  const pathTok = s.match(/\/(?:b|r)\/([A-Za-z0-9._-]+)/)
  if (pathTok) {
    const tok = pathTok[1]
    if (isStaffInviteToken(tok)) return { staffInvite: tok }
    if (isMerchantOpenToken(tok)) return { merchantInvite: tok }
    if (isAgentBindToken(tok)) return { agentBind: tok }
    if (isStallInviteToken(tok)) return { invite: tok }
    return {}
  }
  if (isStaffInviteToken(s)) return { staffInvite: s }
  if (isMerchantOpenToken(s)) return { merchantInvite: s }
  if (isAgentBindToken(s)) return { agentBind: s }
  if (isStallInviteToken(s)) return { invite: s }
  return {}
}

export function peekAgentBound(): boolean {
  try {
    return !!wx.getStorageSync(AGENT_BOUND_KEY)
  } catch (_) {
    return false
  }
}

export function markAgentBound(bound: boolean) {
  try {
    if (bound) wx.setStorageSync(AGENT_BOUND_KEY, 1)
    else wx.removeStorageSync(AGENT_BOUND_KEY)
  } catch (_) {}
}

export interface LookupQr {
  showLookupQr: boolean
  lookupQr: string
  lookupQrHint: string
  lookupQrUrl: string
}

const emptyQr: LookupQr = {
  showLookupQr: false,
  lookupQr: '',
  lookupQrHint: '',
  lookupQrUrl: '',
}

export async function mintLookupUrl(orderNo: string): Promise<string> {
  const r = await mintLookupShare(orderNo)
  return r.url
}

/** 签发公开查账分享：token 指向单据；展示档口当前账本，HMAC 只防外部串改 */
export async function mintLookupShare(orderNo: string): Promise<{
  ok: boolean
  token: string
  url: string
  chainId: string
  sealedAt: string
  signatureValid: boolean
  error: string
}> {
  const empty = {
    ok: false as const,
    token: '',
    url: '',
    chainId: '',
    sealedAt: '',
    signatureValid: false,
    error: '无法签发查账码',
  }
  const no = String(orderNo || '').trim()
  if (!no || !isLoggedIn() || isGuest() || !getSession()?.userId) {
    return { ...empty, error: '请先登录档口账号' }
  }
  const res = await request<{
    url?: string
    token?: string
    chainId?: string
    sealedAt?: string | null
    signatureValid?: boolean
  }>({
    path: '/api/v1/public/lookup-token',
    method: 'POST',
    data: { orderNo: no, refresh: true, live: true },
    skipAuthKick: true,
  })
  if (!res.ok) {
    return { ...empty, error: res.message || empty.error }
  }
  const url = String(res.data?.url || '').trim()
  let token = String(res.data?.token || '').trim()
  if (!token && url) {
    const m = url.match(/\/r\/([^/?#]+)/i)
    if (m) token = decodeURIComponent(m[1])
  }
  if (!token) return { ...empty, error: '查账码为空' }
  return {
    ok: true,
    token,
    url,
    chainId: String(res.data?.chainId || ''),
    sealedAt: String(res.data?.sealedAt || ''),
    signatureValid: res.data?.signatureValid === true,
    error: '',
  }
}

export function lookupSharePath(token: string) {
  const t = String(token || '').trim()
  if (!t) return ''
  return `/pages/order-lookup/order-lookup?token=${encodeURIComponent(t)}`
}

export function agentInviteShareTitle(shopName?: string) {
  const shop = String(shopName || '').trim() || '档口'
  return `${shop}邀请你成为他的代理`
}

export function lookupShareTitle(shopName?: string, orderNo?: string) {
  const shop = String(shopName || '').trim() || '图可开单'
  const no = String(orderNo || '').trim()
  return no ? `${shop} · 公开查账 ${no}` : `${shop} · 公开查账凭证`
}

export async function mintStatementShare(input: {
  customerName: string
  unpaidOnly?: boolean
  rangeLabel?: string
  orderNos: string[]
}): Promise<{
  ok: boolean
  token: string
  url: string
  chainId: string
  sealedAt: string
  signatureValid: boolean
  error: string
}> {
  const empty = {
    ok: false as const,
    token: '',
    url: '',
    chainId: '',
    sealedAt: '',
    signatureValid: false,
    error: '无法签发对账码',
  }
  const customerName = String(input.customerName || '').trim()
  const orderNos = (input.orderNos || []).map((n) => String(n || '').trim()).filter(Boolean)
  if (!customerName || !orderNos.length) {
    return { ...empty, error: '没有可分享的对账单' }
  }
  if (!isLoggedIn() || isGuest() || !getSession()?.userId) {
    return { ...empty, error: '请先登录档口账号' }
  }
  const res = await request<{
    url?: string
    token?: string
    chainId?: string
    sealedAt?: string | null
    signatureValid?: boolean
  }>({
    path: '/api/v1/public/statement-token',
    method: 'POST',
    data: {
      customerName,
      unpaidOnly: !!input.unpaidOnly,
      rangeLabel: String(input.rangeLabel || '').trim(),
      orderNos,
      refresh: true,
      live: true,
    },
    skipAuthKick: true,
  })
  if (!res.ok) {
    return { ...empty, error: res.message || empty.error }
  }
  const token = String(res.data?.token || '').trim()
  if (!token) return { ...empty, error: '对账码为空' }
  return {
    ok: true,
    token,
    url: String(res.data?.url || '').trim(),
    chainId: String(res.data?.chainId || ''),
    sealedAt: String(res.data?.sealedAt || ''),
    signatureValid: res.data?.signatureValid === true,
    error: '',
  }
}

export function statementSharePath(token: string) {
  const t = String(token || '').trim()
  if (!t) return ''
  return `/pages/statement-lookup/statement-lookup?token=${encodeURIComponent(t)}`
}

export function statementShareTitle(shopName?: string, customerName?: string) {
  const shop = String(shopName || '').trim() || '图可开单'
  const name = String(customerName || '').trim()
  return name ? `${shop} · 公开对账 ${name}` : `${shop} · 公开对账凭证`
}

export async function fetchStatementLookup(token: string) {
  const t = String(token || '').trim()
  if (!t) return { ok: false as const, error: '缺少对账码', data: null as StatementLookup | null }
  const res = await request<StatementLookup>({
    path: `/api/v1/public/statement-lookup?token=${encodeURIComponent(t)}&live=1&_t=${Date.now()}`,
    needAuth: false,
  })
  if (!res.ok) return { ok: false as const, error: res.message, data: null as StatementLookup | null }
  return { ok: true as const, error: null as string | null, data: res.data }
}

export interface StatementLookup {
  token?: string
  shopName?: string
  customerName?: string
  customerPhone?: string
  rangeLabel?: string
  printTime?: string
  unpaidOnly?: boolean
  orders?: Array<{
    orderNo?: string
    orderNoLabel?: string
    createdAt?: string
    totalAmount?: number
    totalQuantity?: number
    isReturn?: boolean
    isPaid?: boolean
    amountLabel?: string
    qtyLabel?: string
    statusLabel?: string
    statusClass?: string
  }>
  totals?: {
    orderCount?: number
    qty?: number
    total?: number
    paidCount?: number
    paidAmount?: number
    unpaidCount?: number
    unpaidAmount?: number
    totalLabel?: string
    paidLabel?: string
    unpaidLabel?: string
    receivableLabel?: string
  }
  readonly?: boolean
  publicChain?: boolean
  chainId?: string
  sealedAt?: string | null
  chainHint?: string
  signature?: string
  signatureAlg?: string
  signatureValid?: boolean
  printPaymentQr?: boolean
  showPayQr?: boolean
  qrHint?: string
  wechatQrBase64?: string
  alipayQrBase64?: string
}

export async function resolveLookupQr(orderNo: string): Promise<LookupQr> {
  const url = await mintLookupUrl(orderNo)
  if (!url) return emptyQr
  try {
    const qrPath = await ensureArrivalQrImage(url)
    return {
      showLookupQr: true,
      lookupQr: qrPath,
      lookupQrHint: LOOKUP_QR_HINT,
      lookupQrUrl: url.replace(/^https?:\/\//i, ''),
    }
  } catch (_) {
    return {
      showLookupQr: true,
      lookupQr: '',
      lookupQrHint: LOOKUP_QR_HINT,
      lookupQrUrl: url.replace(/^https?:\/\//i, ''),
    }
  }
}

export async function fetchOrderLookup(token: string) {
  const t = String(token || '').trim()
  if (!t) return { ok: false as const, error: '缺少查账码', data: null as LookupOrder | null }
  const res = await request<LookupOrder>({
    path: `/api/v1/public/order-lookup?token=${encodeURIComponent(t)}&live=1&_t=${Date.now()}`,
    needAuth: false,
  })
  if (!res.ok) return { ok: false as const, error: res.message, data: null as LookupOrder | null }
  return { ok: true as const, error: null as string | null, data: res.data }
}

export async function fetchBindStatus() {
  const res = await request<{ items: { customerUid: string; wxBound: boolean }[] }>({
    path: '/api/v1/team/customers/bind-status',
    skipAuthKick: true,
  })
  if (!res.ok) return [] as { customerUid: string; wxBound: boolean }[]
  return res.data?.items || []
}

export async function unbindAgent(customerUid: string) {
  const res = await request({
    path: '/api/v1/team/customers/agent-unbind',
    method: 'POST',
    data: { customerUid },
  })
  return res.ok ? { ok: true as const } : { ok: false as const, error: res.message }
}

export async function unbindAgentShop(ownerUserId: number) {
  try {
    const code = await wxLoginCode()
    const res = await request<{ ok?: boolean; shopName?: string; leftCount?: number }>({
      path: '/api/v1/public/agent-unbind-shop',
      method: 'POST',
      needAuth: false,
      data: { code, ownerUserId },
    })
    if (!res.ok) return { ok: false as const, error: res.message || '解绑失败' }
    return {
      ok: true as const,
      shopName: res.data?.shopName || '',
      leftCount: Number(res.data?.leftCount || 0),
    }
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : '解绑失败' }
  }
}

/** 没有 AppID 或 wx.login 失败时返回空串，不抛错，避免首页被 MiniProgramError 打断。 */
function wxLoginCode(): Promise<string> {
  return new Promise((resolve) => {
    let appId = ''
    try {
      appId = String(wx.getAccountInfoSync()?.miniProgram?.appId || '').trim()
    } catch (_) {}
    if (!appId || appId === 'touristappid') {
      resolve('')
      return
    }
    wx.login({
      success: (r) => resolve(r.code || ''),
      fail: () => resolve(''),
    })
  })
}

async function agentAuthPost<T>(path: string, data: Record<string, unknown> = {}) {
  const code = await wxLoginCode()
  if (!code) return { ok: false as const, error: '微信登录暂不可用', data: null as T | null }
  const res = await request<T>({
    path,
    method: 'POST',
    needAuth: false,
    data: { code, ...data },
  })
  if (!res.ok) return { ok: false as const, error: res.message, data: null as T | null }
  return { ok: true as const, error: null, data: res.data }
}

export type AgentFolderItem = {
  code: string
  name?: string
  color?: string
  size?: string
  coverUrl?: string
  suggestedRetailPrice?: number | null
  stockLevel?: string
  askAgent?: boolean
}

export type AgentFolder = {
  id: number
  title: string
  kind?: string
  itemCount?: number
  items?: AgentFolderItem[]
  updatedAt?: string
}

export interface AgentInvitePreview {
  kind?: string
  shopName?: string
  customerName?: string
  customerUid?: string
  ownerUserId?: number
  alreadyBound?: boolean
  alreadySelf?: boolean
  alreadyStaff?: boolean
  canBind?: boolean
  message?: string
}

function modalConfirm(title: string, content: string, confirmText = '确定', cancelText = '取消') {
  return new Promise<boolean>((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText,
      cancelText,
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false),
    })
  })
}

function modalTip(title: string, content: string) {
  return new Promise<void>((resolve) => {
    wx.showModal({
      title,
      content,
      showCancel: false,
      confirmText: '知道了',
      success: () => resolve(),
      fail: () => resolve(),
    })
  })
}

function enterBoundWorkspace(info?: { ownerUserId?: number } | null) {
  markAgentBound(true)
  try {
    const ws = require('./workspace') as typeof import('./workspace')
    ws.setWorkspacePreference('agent')
    const oid = Number(info?.ownerUserId || 0)
    if (oid) ws.saveAgentOwnerId(oid)
  } catch (_) {}
}

export async function consumeStallInvite(_inviteToken?: string) {
  await modalTip('请提交申请', '请到货盘顶部的代理广场找到档口并提交申请，由档口审核通过')
  return { ok: true as const, bound: false, skipped: true, error: null, data: null }
}

/** 代理同事邀请服务端未开放：旧链接只提示，不发请求 */
export async function consumeStaffInvite(staffInvite: string) {
  const token = String(staffInvite || '').trim()
  if (!token) return { ok: false as const, bound: false, skipped: true, error: '邀请无效' }
  await modalTip('暂未开放', '代理同事邀请暂未开放，请让同事到代理广场申请绑定档口')
  return { ok: false as const, bound: false, skipped: true, error: '暂未开放' }
}

type AgentCustomerInviteInfo = {
  shopName?: string
  customerName?: string
  ownerUserId?: number
  alreadyBound?: boolean
  canBind?: boolean
  bound?: boolean
  message?: string
}

async function postAgentCustomerInvite(token: string, bind: boolean) {
  const code = await wxLoginCode()
  if (!code) {
    return { ok: false as const, error: '微信登录暂不可用', data: null as AgentCustomerInviteInfo | null }
  }
  const res = await request<AgentCustomerInviteInfo>({
    path: '/api/v1/public/agent-customer-invite',
    method: 'POST',
    needAuth: false,
    data: { code, token, preview: !bind, bind },
  })
  if (!res.ok) return { ok: false as const, error: res.message, data: null as AgentCustomerInviteInfo | null }
  return { ok: true as const, error: null, data: res.data }
}

export async function mintAgentCustomerInvite(customerUid: string) {
  const res = await request<{ token?: string; customerName?: string; shopName?: string }>({
    path: '/api/v1/team/agent-customer-invite',
    method: 'POST',
    data: { customerUid },
  })
  if (!res.ok || !res.data?.token) {
    return {
      ok: false as const,
      error: res.message || '无法生成邀请',
      token: '',
      customerName: '',
      shopName: '',
    }
  }
  return {
    ok: true as const,
    error: '',
    token: res.data.token,
    customerName: res.data.customerName || '',
    shopName: res.data.shopName || '',
  }
}

export async function previewAgentCustomerInvite(token: string) {
  return postAgentCustomerInvite(token, false)
}

export async function consumeAgentCustomerInvite(token: string) {
  const tok = String(token || '').trim()
  if (!isAgentBindToken(tok)) {
    await modalTip('无法加入', '邀请无效')
    return { ok: false as const, bound: false, skipped: true, error: '邀请无效', data: null }
  }
  const preview = await previewAgentCustomerInvite(tok)
  if (!preview.ok || !preview.data) {
    await modalTip('无法加入', String(preview.error || '邀请无效'))
    return { ok: false as const, bound: false, skipped: true, error: preview.error || '邀请无效', data: null }
  }
  const info = preview.data
  if (info.alreadyBound) {
    enterBoundWorkspace(info)
    return { ok: true as const, bound: true, skipped: true, error: null, data: info }
  }
  if (!info.canBind) {
    await modalTip('无法加入', String(info.message || '邀请无效'))
    return { ok: true as const, bound: false, skipped: true, error: info.message || '邀请无效', data: info }
  }
  const shop = info.shopName || '档口'
  const name = info.customerName || '客户'
  const confirmed = await modalConfirm(
    '绑定客户',
    `是否以客户「${name}」加入「${shop}」？绑定后可查看该客户的账单。`,
    '绑定',
    '取消',
  )
  if (!confirmed) return { ok: true as const, bound: false, skipped: true, error: null, data: info }
  const res = await postAgentCustomerInvite(tok, true)
  if (res.ok && res.data && (res.data.bound || res.data.alreadyBound)) {
    enterBoundWorkspace(res.data)
    return { ok: true as const, bound: true, skipped: false, error: null, data: res.data }
  }
  const msg = res.error || res.data?.message || '绑定失败'
  await modalTip('无法加入', String(msg))
  return { ok: false as const, bound: false, skipped: false, error: msg, data: res.data }
}

export type MerchantInviteStats = {
  monthCount: number
  lifeCount: number
  monthLeft: number
  lifeLeft: number
  inviterDays: number
  inviteeDays: number
}

function readInviteStats(raw?: Partial<MerchantInviteStats> | null): MerchantInviteStats | null {
  if (!raw) return null
  return {
    monthCount: Number(raw.monthCount || 0),
    lifeCount: Number(raw.lifeCount || 0),
    monthLeft: Number(raw.monthLeft || 0),
    lifeLeft: Number(raw.lifeLeft || 0),
    inviterDays: Number(raw.inviterDays || 0),
    inviteeDays: Number(raw.inviteeDays || 0),
  }
}

export function merchantInviteStatsHint(s: MerchantInviteStats | null | undefined) {
  if (!s) return ''
  return `已成功 ${s.lifeCount} 人 · 本月还可邀 ${s.monthLeft} 人`
}

export async function mintMerchantOpenInvite() {
  if (isLoggedIn() && !isGuest()) {
    const res = await request<{ inviteToken?: string } & Partial<MerchantInviteStats>>({
      path: '/api/v1/merchant-invite/mint',
      method: 'POST',
    })
    if (!res.ok) return { ok: false as const, error: res.message, token: '', stats: null }
    return {
      ok: true as const,
      error: null,
      token: res.data?.inviteToken || '',
      stats: readInviteStats(res.data),
    }
  }
  // 公开接口只给已绑定档口的代理；游客 / 未绑定会 403，这里直接跳过
  if (!peekAgentBound()) {
    return { ok: false as const, error: '', token: '', stats: null }
  }
  const code = await wxLoginCode()
  const res = await request<{ inviteToken?: string } & Partial<MerchantInviteStats>>({
    path: '/api/v1/public/merchant-invite/mint',
    method: 'POST',
    needAuth: false,
    data: { code },
  })
  if (!res.ok) return { ok: false as const, error: res.message, token: '', stats: null }
  return {
    ok: true as const,
    error: null,
    token: res.data?.inviteToken || '',
    stats: readInviteStats(res.data),
  }
}

export async function fetchMerchantInviteStats() {
  const logged = isLoggedIn() && !isGuest()
  if (!logged && !peekAgentBound()) {
    return { ok: false as const, stats: null, error: '' }
  }
  let code = ''
  if (!logged) {
    try {
      code = await wxLoginCode()
    } catch (_) {}
  }
  const res = await request<Partial<MerchantInviteStats>>({
    path: '/api/v1/merchant-invite/stats',
    method: 'POST',
    needAuth: logged,
    data: code ? { code } : {},
  })
  if (!res.ok) return { ok: false as const, stats: null, error: res.message }
  return { ok: true as const, stats: readInviteStats(res.data), error: null }
}

export async function claimMerchantOpenInvite(inviteToken?: string) {
  const token = String(inviteToken || '').trim()
  let code = ''
  try {
    code = await wxLoginCode()
  } catch (_) {}
  const res = await request<{
    granted?: boolean
    already?: boolean
    message?: string
    inviteeDays?: number
    inviterDays?: number
    flushedDays?: number
  }>({
    path: '/api/v1/merchant-invite/claim',
    method: 'POST',
    data: token ? { inviteToken: token, code } : { code },
  })
  if (!res.ok) return { ok: false as const, granted: false, message: res.message || '领取失败' }
  return {
    ok: true as const,
    granted: !!res.data?.granted,
    already: !!res.data?.already,
    message: res.data?.message || '',
    inviteeDays: Number(res.data?.inviteeDays || 0),
    flushedDays: Number(res.data?.flushedDays || 0),
  }
}

export async function updateAgentPhone(phone: string, ownerUserId?: number) {
  return updateAgentProfile({ phone, ownerUserId })
}

export async function updateAgentProfile(opts: {
  displayName?: string
  phone?: string
  ownerUserId?: number
}) {
  const code = await wxLoginCode()
  const data: Record<string, unknown> = { code }
  if (opts.displayName != null) data.displayName = String(opts.displayName || '').trim()
  if (opts.phone != null) data.phone = String(opts.phone || '').trim()
  if (opts.ownerUserId) data.ownerUserId = opts.ownerUserId
  const res = await request<{
    phone?: string
    customerName?: string
    displayName?: string
    complete?: boolean
  }>({
    path: '/api/v1/public/agent-profile',
    method: 'POST',
    needAuth: false,
    data,
  })
  if (!res.ok) {
    return {
      ok: false as const,
      error: res.message,
      phone: '',
      displayName: '',
    }
  }
  try {
    const ws = require('./workspace') as typeof import('./workspace')
    ws.saveAgentProfileOk(!!(res.data?.complete || String(res.data?.displayName || '').trim()))
  } catch (_) {}
  return {
    ok: true as const,
    error: null,
    phone: res.data?.phone || String(opts.phone || ''),
    displayName: res.data?.displayName || res.data?.customerName || String(opts.displayName || ''),
  }
}

export type AgentTrendDay = {
  date?: string
  pickupAmount?: number
  pickupQty?: number
  pickupCount?: number
  refundAmount?: number
  refundQty?: number
  refundCount?: number
}

export type AgentInbox = {
  pending?: number
  inTransit?: number
  rejected?: number
  newArrivalCount?: number
}

export type AgentRankItem = {
  code?: string
  name?: string
  shopName?: string
  qty?: number
  amount?: number
}

export type AgentHomeStats = {
  totalCount?: number
  returnCount?: number
  monthCount?: number
  totalAmount?: number
  refundAmount?: number
  unpaidAmount?: number
  shippedCount?: number
  avgTicket?: number
  since?: string
  trend?: AgentTrendDay[]
  pickupRank?: AgentRankItem[]
  returnRank?: AgentRankItem[]
}

export async function fetchAgentMe(
  ownerUserId?: number,
  opts?: { allOrders?: boolean; home?: boolean; dateFrom?: string; dateTo?: string },
) {
  const code = await wxLoginCode()
  if (!code) return { ok: false as const, error: '微信登录暂不可用', data: null }
  const accessToken = (getSession()?.accessToken || '').trim()
  const payload: Record<string, unknown> = { code }
  if (ownerUserId) payload.ownerUserId = ownerUserId
  if (opts?.allOrders) payload.allOrders = true
  if (opts?.home) payload.home = true
  if (opts?.dateFrom) payload.dateFrom = opts.dateFrom
  if (opts?.dateTo) payload.dateTo = opts.dateTo
  if (accessToken) payload.accessToken = accessToken
  const res = await request<{
    bound: boolean
    bindings: AgentBinding[]
    current?: AgentBinding
    acceptAgentOrders?: boolean
    orders: LookupOrder[]
    stats?: AgentHomeStats
    inbox?: AgentInbox
    merchantExpired?: boolean
    expireShops?: Array<{ ownerUserId?: number; shopName?: string }>
    statementAck?: { dateFrom?: string; dateTo?: string; ackedAt?: string } | null
    profile?: AgentProfile
    summary?: {
      orderCount?: number
      returnCount?: number
      salesAmount?: number
      refundAmount?: number
    }
  }>({
    path: '/api/v1/public/agent-me',
    method: 'POST',
    needAuth: false,
    data: payload,
  })
  if (!res.ok) return { ok: false as const, error: res.message, data: null }
  const data = res.data
  const bindings = data?.bindings || []
  const bound = bindings.length > 0
  markAgentBound(bound)
  try {
    const ws = require('./workspace') as typeof import('./workspace')
    ws.saveAgentProfileOk(!!data?.profile?.complete)
  } catch (_) {}
  const picked =
    ownerUserId && bindings.find((b) => Number(b.ownerUserId) === Number(ownerUserId))
  return {
    ok: true as const,
    error: null,
    data: data
      ? {
          ...data,
          bound,
          bindings,
          current: picked || data.current,
          orders: data.orders || [],
        }
      : null,
  }
}

export async function fetchAgentShopSetting() {
  const res = await request<{ acceptAgentOrders?: boolean; pendingCount?: number }>({
    path: '/api/v1/team/shop/agent-orders',
  })
  if (!res.ok) return { ok: false as const, error: res.message, acceptAgentOrders: true, pendingCount: 0 }
  return {
    ok: true as const,
    error: null,
    acceptAgentOrders: !!res.data?.acceptAgentOrders,
    pendingCount: Number(res.data?.pendingCount || 0),
  }
}

export async function saveAgentShopSetting(acceptAgentOrders: boolean) {
  let code = ''
  try {
    code = await wxLoginCode()
  } catch (_) {}
  const data: Record<string, unknown> = { acceptAgentOrders }
  if (code) data.code = code
  const res = await request<{ acceptAgentOrders?: boolean }>({
    path: '/api/v1/team/shop/agent-orders',
    method: 'POST',
    data,
  })
  if (!res.ok) return { ok: false as const, error: res.message, acceptAgentOrders }
  return { ok: true as const, error: null, acceptAgentOrders: !!res.data?.acceptAgentOrders }
}

export function merchantRenewShare(shopName?: string) {
  const shop = String(shopName || '').trim()
  return {
    title: shop ? shop + '账户已到期，请开通续费' : '商家账户已到期，请开通续费',
    path: '/pages/subscription/subscription',
  }
}

export async function fetchAgentCatalog(
  ownerUserId?: number,
  opts?: { tab?: 'all' | 'new'; q?: string; cursor?: string; limit?: number },
) {
  const code = await wxLoginCode()
  const res = await request<{
    acceptAgentOrders?: boolean
    shopName?: string
    customerName?: string
    customerUid?: string
    ownerUserId?: number
    newArrivalCount?: number
    nextCursor?: string
    hasMore?: boolean
    products?: AgentCatalogProduct[]
    restockWatch?: string[]
  }>({
    path: '/api/v1/public/agent-catalog',
    method: 'POST',
    needAuth: false,
    data: {
      code,
      ...(ownerUserId ? { ownerUserId } : {}),
      tab: opts?.tab || 'all',
      q: opts?.q || '',
      cursor: opts?.cursor || '',
      limit: opts?.limit || 6,
    },
  })
  if (!res.ok) return { ok: false as const, error: res.message, data: null }
  return { ok: true as const, error: null, data: res.data }
}

export async function fetchAgentProduct(productCode: string, ownerUserId?: number) {
  const code = await wxLoginCode()
  const res = await request<AgentCatalogProduct & { galleryUrls?: string[] }>({
    path: '/api/v1/public/agent-product',
    method: 'POST',
    needAuth: false,
    data: {
      code,
      productCode,
      ...(ownerUserId ? { ownerUserId } : {}),
    },
  })
  if (!res.ok) return { ok: false as const, error: res.message, data: null }
  return { ok: true as const, error: null, data: res.data }
}

export async function createAgentShare(productCode: string, ownerUserId?: number, folderId?: number) {
  const code = await wxLoginCode()
  const res = await request<{ token?: string; path?: string; expireAt?: string; folder?: boolean }>({
    path: '/api/v1/public/agent-share/create',
    method: 'POST',
    needAuth: false,
    data: {
      code,
      ...(productCode ? { productCode } : {}),
      ...(folderId ? { folderId } : {}),
      ...(ownerUserId ? { ownerUserId } : {}),
    },
  })
  if (!res.ok) return { ok: false as const, error: res.message, data: null }
  return { ok: true as const, error: null, data: res.data }
}

export async function fetchAgentShare(token: string) {
  const t = String(token || '').trim()
  if (!t) return { ok: false as const, error: '链接无效', data: null }
  const res = await request<{
    shopName?: string
    code?: string
    name?: string
    coverUrl?: string
    galleryUrls?: string[]
    suggestedRetailPrice?: number | null
    askAgent?: boolean
    stockLevel?: string
    colors?: string[]
    sizes?: string[]
    folder?: boolean
    title?: string
    items?: AgentFolderItem[]
    newArrival?: boolean
    videoUrl?: string
  }>({
    path: `/api/v1/public/agent-share/${encodeURIComponent(t)}`,
    method: 'GET',
    needAuth: false,
  })
  if (!res.ok) return { ok: false as const, error: res.message, data: null }
  return { ok: true as const, error: null, data: res.data }
}

export async function fetchNewArrivalLink() {
  const res = await request<{ token?: string; url?: string; path?: string; shopName?: string }>({
    path: '/api/v1/team/shop/new-arrival-link',
    method: 'POST',
  })
  if (!res.ok) return { ok: false as const, error: res.message, url: '' }
  return { ok: true as const, error: null, url: String(res.data?.url || ''), path: String(res.data?.path || '') }
}

export async function searchAgentCode(q: string, ownerUserId?: number) {
  return agentAuthPost<{
    q?: string
    hits?: Array<{
      ownerUserId?: number
      shopName?: string
      customerName?: string
      code?: string
      name?: string
      coverUrl?: string
      stockLevel?: string
      price?: number
      isNewArrival?: boolean
    }>
  }>('/api/v1/public/agent-code-search', {
    q,
    ...(ownerUserId ? { ownerUserId } : {}),
  })
}

export type AgentImageHit = {
  ownerUserId?: number
  shopName?: string
  customerName?: string
  code?: string
  name?: string
  coverUrl?: string
  stockLevel?: string
  price?: number
  isNewArrival?: boolean
  videoUrl?: string
  distance?: number
}

export async function searchAgentImage(opts: {
  filePath?: string
  dhash?: string
  ownerUserId?: number
}) {
  const login = await wxLoginCode()
  const dhash = String(opts.dhash || '').trim()
  const filePath = String(opts.filePath || '').trim()
  if (filePath) {
    return new Promise<{ ok: true; error: null; data: { hits?: AgentImageHit[] } | null } | { ok: false; error: string; data: null }>((resolve) => {
      wx.uploadFile({
        url: `${API_BASE}/api/v1/public/agent-search-image`,
        filePath,
        name: 'file',
        timeout: 30000,
        formData: {
          code: login,
          ...(dhash ? { dhash } : {}),
          ...(opts.ownerUserId ? { ownerUserId: String(opts.ownerUserId) } : {}),
        },
        success(res) {
          let body: { code?: number; message?: string; data?: { hits?: AgentImageHit[] } } | null = null
          try {
            body = JSON.parse(String(res.data || '')) as {
              code?: number
              message?: string
              data?: { hits?: AgentImageHit[] }
            }
          } catch (_) {
            body = null
          }
          if (res.statusCode === 200 && body && body.code === 0) {
            resolve({ ok: true, error: null, data: body.data || { hits: [] } })
            return
          }
          resolve({ ok: false, error: body?.message || `搜图失败(${res.statusCode})`, data: null })
        },
        fail(err) {
          resolve({ ok: false, error: err.errMsg || '搜图失败', data: null })
        },
      })
    })
  }
  return agentAuthPost<{ hits?: AgentImageHit[] }>('/api/v1/public/agent-search-image', {
    ...(dhash ? { dhash } : {}),
    ...(opts.ownerUserId ? { ownerUserId: opts.ownerUserId } : {}),
  })
}

export async function fetchAgentFolders(ownerUserId?: number, folderId?: number) {
  return agentAuthPost<{ folders?: AgentFolder[]; folder?: AgentFolder; ownerUserId?: number }>(
    '/api/v1/public/agent-folders',
    {
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(folderId ? { folderId } : {}),
    },
  )
}

export async function upsertAgentFolder(opts: {
  ownerUserId?: number
  id?: number
  title: string
  items?: AgentFolderItem[]
  kind?: string
}) {
  return agentAuthPost<{ folder?: AgentFolder }>('/api/v1/public/agent-folders/upsert', {
    ...(opts.ownerUserId ? { ownerUserId: opts.ownerUserId } : {}),
    ...(opts.id ? { id: opts.id } : {}),
    title: opts.title,
    ...(opts.items ? { items: opts.items } : {}),
    ...(opts.kind ? { kind: opts.kind } : {}),
  })
}

export async function deleteAgentFolder(id: number, ownerUserId?: number) {
  return agentAuthPost<{ deleted?: boolean }>('/api/v1/public/agent-folders/delete', {
    id,
    ...(ownerUserId ? { ownerUserId } : {}),
  })
}

export async function addToAgentFolder(
  folderId: number,
  productCode: string,
  ownerUserId?: number,
  spec?: { color?: string; size?: string },
) {
  return agentAuthPost<{ folder?: AgentFolder }>('/api/v1/public/agent-folders/add', {
    folderId,
    productCode,
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(spec?.color ? { color: spec.color } : {}),
    ...(spec?.size ? { size: spec.size } : {}),
  })
}

export async function addAgentWishlist(productCode: string, ownerUserId?: number) {
  return agentAuthPost<{ folder?: AgentFolder; items?: AgentFolderItem[] }>(
    '/api/v1/public/agent-wishlist',
    {
      action: 'add',
      productCode,
      ...(ownerUserId ? { ownerUserId } : {}),
    },
  )
}

export async function setAgentRestockWatch(productCode: string, on: boolean, ownerUserId?: number) {
  return agentAuthPost<{ codes?: string[] }>('/api/v1/public/agent-restock-watch', {
    productCode,
    on,
    ...(ownerUserId ? { ownerUserId } : {}),
  })
}

export async function submitAgentOrder(
  items: Array<{ code: string; qty: number; color?: string; size?: string }>,
  opts?: {
    ownerUserId?: number
    remark?: string
    shipToName?: string
    shipToPhone?: string
    shipToAddress?: string
    urgent?: boolean
    clientOrderId?: string
  },
) {
  const code = await wxLoginCode()
  const clientOrderId =
    String(opts?.clientOrderId || '').trim() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const res = await request<{
    orderNo?: string
    totalAmount?: number
    unpaidAmount?: number
    shopName?: string
    customerName?: string
    agentFulfillment?: string
    idempotent?: boolean
  }>({
    path: '/api/v1/public/agent-order',
    method: 'POST',
    needAuth: false,
    data: {
      code,
      items,
      clientOrderId,
      remark: opts?.remark || '',
      shipToName: opts?.shipToName || '',
      shipToPhone: opts?.shipToPhone || '',
      shipToAddress: opts?.shipToAddress || '',
      urgent: !!opts?.urgent,
      ...(opts?.ownerUserId ? { ownerUserId: opts.ownerUserId } : {}),
    },
  })
  if (!res.ok) return { ok: false as const, error: res.message, data: null }
  return { ok: true as const, error: null, data: res.data }
}

export async function ackAgentStatement(dateFrom: string, dateTo: string, ownerUserId?: number) {
  return agentAuthPost<{ ack?: { dateFrom?: string; dateTo?: string; ackedAt?: string } }>(
    '/api/v1/public/agent-statement/ack',
    { dateFrom, dateTo, ...(ownerUserId ? { ownerUserId } : {}) },
  )
}

export async function nudgeAgentStatement(customerUid: string, customerName?: string) {
  const res = await request<{ nudged?: boolean; unpaidAmount?: number }>({
    path: '/api/v1/team/agent-statement/nudge',
    method: 'POST',
    data: { customerUid, customerName },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  return { ok: true as const, error: null, unpaidAmount: Number(res.data?.unpaidAmount || 0) }
}

export async function rejectAgentPending(orderNo: string, reason: string) {
  const res = await request<{ orderNo?: string; remark?: string }>({
    path: '/api/v1/team/agent-pending/reject',
    method: 'POST',
    data: { orderNo, reason },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  return { ok: true as const, error: null }
}

export type PlazaShop = {
  ownerUserId: number
  shopName: string
  hasLogo?: boolean
  logoUrl?: string
  newArrivalCount?: number
  applyStatus?: string
}

export function plazaLogoSrc(shop: PlazaShop): string {
  const path = String(shop.logoUrl || '').trim()
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
}

export async function fetchAgentPlaza(opts?: { page?: number; q?: string }) {
  const code = await wxLoginCode()
  const res = await request<{ shops?: PlazaShop[]; hasMore?: boolean; page?: number }>({
    path: '/api/v1/public/agent-plaza',
    method: 'POST',
    needAuth: false,
    data: {
      code,
      page: opts?.page || 1,
      q: opts?.q || '',
    },
  })
  if (!res.ok) return { ok: false as const, error: res.message, shops: [] as PlazaShop[], hasMore: false }
  return {
    ok: true as const,
    error: null,
    shops: res.data?.shops || [],
    hasMore: !!res.data?.hasMore,
  }
}

function mpEnvVersion(): 'release' | 'trial' | 'develop' {
  try {
    const v = wx.getAccountInfoSync().miniProgram.envVersion
    if (v === 'develop' || v === 'trial' || v === 'release') return v
  } catch (_) {}
  return 'release'
}

function writeAgentCodeImage(ownerId: number, env: string, b64: string): string {
  const pure = String(b64 || '')
    .replace(/^data:image\/\w+;base64,/, '')
    .replace(/\s+/g, '')
  if (pure.length < 32) return ''
  const path = `${wx.env.USER_DATA_PATH}/tuk_agent_wxacode_${ownerId}_${env}.png`
  try {
    wx.getFileSystemManager().writeFileSync(path, pure, 'base64')
    return path
  } catch (_) {
    return ''
  }
}

/** 首页邀请代理：黑白方码。扫码打开代理登录，登录后向这家店申请。 */
export async function ensureAgentInviteQr(ownerId: number): Promise<string> {
  const env = mpEnvVersion()
  const res = await request<{ urlLink?: string; imageBase64?: string }>({
    path: '/api/v1/team/agent-invite-qr',
    method: 'POST',
    needAuth: true,
    data: { envVersion: env },
  })
  const urlLink = String(res.data?.urlLink || '').trim()
  if (res.ok && /^https:\/\//.test(urlLink)) {
    try {
      const drawn = await ensureArrivalQrImage(urlLink)
      if (drawn) return drawn
    } catch (_) {}
  }
  const official = writeAgentCodeImage(ownerId, env, String(res.data?.imageBase64 || ''))
  if (official) return official
  const query = `mode=agent&stay=1&owner=${ownerId}`
  const link =
    `weixin://dl/business/?appid=wx2ff1daf57f870590` +
    `&path=pages/login/login&query=${encodeURIComponent(query)}` +
    `&env_version=${env}`
  return ensureArrivalQrImage(link)
}

export async function applyAgentShop(opts: {
  ownerUserId: number
  displayName: string
  phone?: string
  note?: string
}) {
  const code = await wxLoginCode()
  const res = await request<{ applyStatus?: string; message?: string }>({
    path: '/api/v1/public/agent-apply',
    method: 'POST',
    needAuth: false,
    data: {
      code,
      ownerUserId: opts.ownerUserId,
      displayName: opts.displayName,
      phone: opts.phone || '',
      note: opts.note || '',
    },
  })
  if (!res.ok) return { ok: false as const, error: res.message }
  return { ok: true as const, error: null, applyStatus: res.data?.applyStatus || 'pending', message: res.data?.message || '' }
}

export type AgentMergeCandidate = {
  customerUid: string
  name: string
  phone?: string
  wxBound?: boolean
  orderCount?: number
  unpaid?: number
  mergedName?: string
  hasData?: boolean
}

export type AgentApplyItem = {
  id: number
  displayName: string
  phone?: string
  note?: string
  status: string
  rejectReason?: string
  createdAt?: string
  mergeCandidates?: AgentMergeCandidate[]
}

export async function fetchMerchantAgentApplies(status = 'pending') {
  const res = await request<{ items?: AgentApplyItem[]; pendingCount?: number }>({
    path: `/api/v1/team/agent-applies?status=${encodeURIComponent(status)}`,
    method: 'GET',
  })
  if (!res.ok) return { ok: false as const, error: res.message, items: [] as AgentApplyItem[] }
  return { ok: true as const, error: null, items: res.data?.items || [] }
}

export async function decideMerchantAgentApply(
  id: number,
  action: 'approve' | 'reject',
  opts?: { reason?: string; mergeCustomerUid?: string; createNew?: boolean },
) {
  const res = await request<{
    status?: string
    message?: string
    needMerge?: boolean
    candidates?: AgentMergeCandidate[]
  }>({
    path: '/api/v1/team/agent-applies/decide',
    method: 'POST',
    data: {
      id,
      action,
      reason: opts?.reason || '',
      mergeCustomerUid: opts?.mergeCustomerUid || '',
      createNew: !!opts?.createNew,
    },
  })
  if (!res.ok) return { ok: false as const, error: res.message, needMerge: false, candidates: [] as AgentMergeCandidate[] }
  return {
    ok: true as const,
    error: null,
    message: res.data?.message || '',
    needMerge: !!res.data?.needMerge,
    candidates: res.data?.candidates || [],
  }
}

export async function submitAgentReturn(
  items: Array<{ code: string; qty: number }>,
  opts?: { ownerUserId?: number; remark?: string },
) {
  return agentAuthPost<{ cloudUid?: string; items?: Array<{ code: string; qty: number }> }>(
    '/api/v1/public/agent-return',
    {
      items,
      remark: opts?.remark || '',
      ...(opts?.ownerUserId ? { ownerUserId: opts.ownerUserId } : {}),
    },
  )
}
