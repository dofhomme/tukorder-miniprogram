import { getOrCreateClientId, request, setClientId, API_BASE } from './api'
import { clearTeamDataCaches, ensureStorageHeadroom, safeSetStorage } from './cache'
import { clearEntitlementCache } from './subscription'
import {
  clearGuestSession,
  clearSession,
  getSession,
  setGuestSession,
  setSession,
} from './session'
import type { Session, TeamInfo } from './session'

const IMAGEOK_ORIGIN = 'https://imageok.cn'
const IMAGEOK_TOKEN_KEY = 'tuk_imageok_token'
const MP_TICKET_KEY = 'tuk_mp_bind_ticket'
/** 配置默认 AppID；实际登录以运行时为准，避免开发者工具仍挂旧 AppID 时 code 对不上 */
const MP_APPID_FALLBACK = 'wx2ff1daf57f870590'

function resolveMpAppId(): string {
  try {
    const info = wx.getAccountInfoSync()
    const runtime = String(info?.miniProgram?.appId || '').trim()
    if (runtime) return runtime
  } catch (_) {}
  return MP_APPID_FALLBACK
}

function saveImageOkToken(token: string) {
  ensureStorageHeadroom()
  if (!safeSetStorage(IMAGEOK_TOKEN_KEY, token)) {
    throw new Error('本地缓存已满，请在开发者工具清除数据缓存后重试')
  }
}

export function getImageOkToken(): string {
  return (wx.getStorageSync(IMAGEOK_TOKEN_KEY) as string) || ''
}

function saveMpTicket(ticket: string) {
  ensureStorageHeadroom()
  if (!safeSetStorage(MP_TICKET_KEY, ticket)) {
    throw new Error('本地缓存已满，请在开发者工具清除数据缓存后重试')
  }
}

export function getMpTicket(): string {
  return (wx.getStorageSync(MP_TICKET_KEY) as string) || ''
}

export function clearMpTicket() {
  try {
    wx.removeStorageSync(MP_TICKET_KEY)
  } catch (_) {}
}

/** 换号登录时清本地业务缓存（对齐 App wipeLocalIfAccountChanged） */
function wipeIfAccountChanged(newPhone: string, newUserId?: number) {
  const prev = getSession()
  const prevPhone = String(prev?.phone || '').trim()
  const prevId = Number(prev?.userId || 0)
  const nextPhone = newPhone.trim()
  const nextId = Number(newUserId || 0)
  const samePhone = !!prevPhone && prevPhone === nextPhone
  const sameId = prevId === 0 || nextId === 0 || prevId === nextId
  if (samePhone && sameId) return
  try {
    clearTeamDataCaches()
  } catch (_) {}
  try {
    clearEntitlementCache()
  } catch (_) {}
}

type AuthPayload = {
  phone: string
  clientId: string
  userId: number
  isAdmin?: boolean
  team?: TeamInfo | null
  accessToken?: string
  trialWelcome?: { days?: number; expireAt?: string | null }
}

let pendingTrialDays = 0

/** 本次登录刚开通的试用天数。只取一次。 */
export function takeTrialWelcomeDays(): number {
  const days = pendingTrialDays
  pendingTrialDays = 0
  return days
}

function finalizeSession(
  raw: AuthPayload,
): { ok: true; session: Session } | { ok: false; error: string } {
  const role = String(raw.team?.role || '').trim()
  if (!role && !raw.isAdmin) {
    clearSession()
    return {
      ok: false,
      error: '无法识别账号身份，请检查网络后重试',
    }
  }
  wipeIfAccountChanged(raw.phone, raw.userId)
  const session: Session = {
    phone: raw.phone,
    clientId: raw.clientId,
    userId: raw.userId,
    isAdmin: !!raw.isAdmin,
    team: raw.team || null,
    accessToken: (raw.accessToken || '').trim() || undefined,
    loggedInAt: Date.now(),
  }
  setSession(session)
  try {
    const { setWorkspacePreference } = require('./workspace') as typeof import('./workspace')
    setWorkspacePreference('merchant')
  } catch (_) {}
  return { ok: true, session }
}

/** 与官网 sanitizeUserNickname 一致：最多 8 字，去掉尖括号和换行 */
export function sanitizeAccountNickname(raw: string): string {
  let s = String(raw || '').trim()
  s = s.replace(/[<>]/g, '')
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\r\n]/g, '')
  if (s.length > 8) s = s.slice(0, 8)
  return s
}

function rememberSessionNickname(nickname: string) {
  const cur = getSession()
  if (!cur) return
  setSession({
    ...cur,
    team: { ...(cur.team || {}), displayName: nickname },
  })
}

/** 读官网当前昵称，店铺设置和官网用同一份 */
export async function fetchImageOkNickname(): Promise<{
  ok: boolean
  nickname?: string
  error?: string
}> {
  const token = getImageOkToken()
  if (!token) return { ok: false, error: '未登录官网账号' }
  const r = await imageOkRequest<{ user?: { nickname?: string }; error?: string }>({
    path: '/api/auth/me',
    method: 'GET',
    token,
  })
  const user = r.data?.user
  if (!r.ok || r.data?.error || !user) {
    return { ok: false, error: r.error || r.data?.error || '读取官网昵称失败' }
  }
  return { ok: true, nickname: sanitizeAccountNickname(String(user.nickname || '')) }
}

/** 写入官网昵称，并更新本机「我的」里显示的名字 */
export async function saveImageOkNickname(raw: string): Promise<{
  ok: boolean
  nickname?: string
  error?: string
}> {
  const token = getImageOkToken()
  if (!token) return { ok: false, error: '未登录官网账号，无法同步昵称' }
  const nickname = sanitizeAccountNickname(raw)
  const r = await imageOkRequest<{ user?: { nickname?: string }; error?: string }>({
    path: '/api/auth/profile',
    method: 'POST',
    token,
    data: { nickname },
  })
  if (!r.ok || r.data?.error) {
    return { ok: false, error: r.error || r.data?.error || '昵称同步官网失败' }
  }
  const saved = sanitizeAccountNickname(String(r.data?.user?.nickname ?? nickname))
  rememberSessionNickname(saved)
  return { ok: true, nickname: saved }
}

function imageOkRequest<T = Record<string, unknown>>(opts: {
  path: string
  method?: 'GET' | 'POST'
  data?: Record<string, unknown>
  token?: string
}): Promise<{ ok: boolean; data?: T; error?: string; httpStatus?: number }> {
  const token = String(opts.token || '').trim()
  return new Promise((resolve) => {
    wx.request({
      url: `${IMAGEOK_ORIGIN}${opts.path}`,
      method: opts.method || 'POST',
      timeout: 20000,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      data: opts.data || {},
      success(res) {
        const body = (res.data || {}) as T & {
          code?: number
          error?: string
          message?: string
        }
        const httpStatus = res.statusCode || 0
        if (httpStatus >= 400) {
          resolve({
            ok: false,
            error: body.error || body.message || `请求失败(${httpStatus})`,
            httpStatus,
            data: body,
          })
          return
        }
        if (body.code != null && body.code !== 200) {
          resolve({
            ok: false,
            error: body.error || body.message || '请求失败',
            httpStatus,
            data: body,
          })
          return
        }
        resolve({ ok: true, data: body, httpStatus })
      },
      fail(err) {
        resolve({
          ok: false,
          error: err.errMsg || '无法连接 ImageOK，请检查域名与网络',
        })
      },
    })
  })
}

/** ImageOK 平台登录拿 JWT（与 App 一致） */
function loginImageOk(phone: string, password: string): Promise<{
  ok: boolean
  token?: string
  error?: string
}> {
  return imageOkRequest<{ token?: string }>({
    path: '/api/auth/login',
    data: { phone: phone.trim(), password },
  }).then((r) => {
    if (r.ok && r.data?.token) return { ok: true, token: String(r.data.token) }
    return { ok: false, error: r.error || 'ImageOK 登录失败' }
  })
}

async function loginViaImageOkToken(imageokToken: string) {
  const clientId = getOrCreateClientId()
  const res = await request<AuthPayload>({
    path: '/api/v1/auth/imageok-login',
    method: 'POST',
    needAuth: false,
    skipAuthKick: true,
    data: {
      imageokToken,
      clientId,
      deviceType: 'mobile',
    },
  })
  if (!res.ok || !res.data) {
    return { ok: false as const, error: res.message || '换取开单会话失败' }
  }
  const trialDays = Number(res.data.trialWelcome?.days || 0)
  pendingTrialDays = Number.isFinite(trialDays) && trialDays > 0 ? Math.floor(trialDays) : 0
  const boundId = (res.data.clientId || clientId).trim()
  if (boundId) setClientId(boundId)
  saveImageOkToken(imageokToken)
  clearMpTicket()

  const role = String(res.data.team?.role || '').trim()
  if (!role && !res.data.isAdmin) {
    pendingTrialDays = 0
    clearSession()
    return {
      ok: false as const,
      error: '无法识别账号身份，请检查网络后重试',
    }
  }

  return finalizeSession({
    phone: res.data.phone,
    clientId: boundId,
    userId: res.data.userId,
    isAdmin: !!res.data.isAdmin,
    team: res.data.team || null,
    accessToken: res.data.accessToken,
  })
}

/**
 * 统一账号：只走 ImageOK（商家 / 员工同一套手机号密码）。
 */
export async function login(phone: string, password: string) {
  const p = phone.trim()
  const ik = await loginImageOk(p, password)
  if (!ik.ok || !ik.token) {
    return { ok: false as const, error: ik.error || '账号或密码错误' }
  }
  return loginViaImageOkToken(ik.token)
}

function wxLoginCode(): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    wx.login({
      success(res) {
        if (res.code) resolve({ ok: true, code: res.code })
        else resolve({ ok: false, error: '微信登录失败：无 code' })
      },
      fail(err) {
        resolve({ ok: false, error: err.errMsg || '微信登录失败' })
      },
    })
  })
}

type MpLoginBody = {
  code?: number
  need_bind?: boolean
  guest_allowed?: boolean
  mp_ticket?: string
  token?: string
  message?: string
  error?: string
  user?: { nickname?: string; avatar_url?: string }
}

type MpPeekBody = {
  code?: number
  bound?: boolean
  nickname?: string
  avatar_url?: string
  error?: string
  message?: string
}

/**
 * 登录页自动回显：wx.login → peek 已绑用户的 ImageOK 头像/昵称
 * （微信已禁止静默拉微信头像；这里回显的是账号资料）
 */
export async function peekWxProfile(): Promise<{
  ok: boolean
  bound?: boolean
  nickname?: string
  avatarUrl?: string
  error?: string
}> {
  const codeRes = await wxLoginCode()
  if (!codeRes.ok) return { ok: false, error: codeRes.error }
  const r = await imageOkRequest<MpPeekBody>({
    path: '/api/auth/mp/peek',
    data: { code: codeRes.code, appid: resolveMpAppId() },
  })
  if (!r.ok || !r.data) {
    return { ok: false, error: r.error || '预览失败' }
  }
  return {
    ok: true,
    bound: !!r.data.bound,
    nickname: String(r.data.nickname || '').trim(),
    avatarUrl: String(r.data.avatar_url || '').trim(),
  }
}

/**
 * 小程序微信登录：
 * - 已绑定 → ImageOK token → 开单会话
 * - 未绑定 → needBind + mp_ticket（再走短信绑定）
 * profile: { nickName/nickname, avatarUrl/avatar_url } 写入 ImageOK 用户资料
 */
export async function loginWithWechat(profile?: {
  nickName?: string
  nickname?: string
  avatarUrl?: string
  avatar_url?: string
}): Promise<
  | { ok: true; session: Session }
  | {
      ok: false
      needBind: true
      mpTicket: string
      guestAllowed?: boolean
      error?: string
    }
  | { ok: false; needBind?: false; error: string }
> {
  const codeRes = await wxLoginCode()
  if (!codeRes.ok) return { ok: false, error: codeRes.error }

  const nickname = String(profile?.nickName || profile?.nickname || '').trim()
  const avatarUrl = String(profile?.avatarUrl || profile?.avatar_url || '').trim()

    const r = await imageOkRequest<MpLoginBody>({
      path: '/api/auth/mp/login',
      data: {
        code: codeRes.code,
        appid: resolveMpAppId(),
        nickname,
        avatar_url: avatarUrl,
      },
    })
    const data = (r.data || {}) as MpLoginBody
    if (data.need_bind) {
      const ticket = String(data.mp_ticket || '').trim()
      if (!ticket) {
        return {
          ok: false,
          error: data.message || data.error || r.error || '请绑定手机号开通商家账号',
        }
      }
      saveMpTicket(ticket)
      return {
        ok: false,
        needBind: true,
        mpTicket: ticket,
        guestAllowed: data.guest_allowed === true,
        error: data.message || '请绑定手机号开通商家账号',
      }
    }
    if (!r.ok || !data.token) {
      return { ok: false, error: r.error || data.error || data.message || '微信登录失败' }
    }
    clearGuestSession()
    return loginViaImageOkToken(String(data.token))
}

/**
 * 进入游客态：保存微信绑定票据，可浏览介绍页；确认须知后本地开单。
 */
export function enterGuestSession(opts: {
  mpTicket?: string
  nickname?: string
  avatarUrl?: string
  browseOnly?: boolean
  orderReady?: boolean
}) {
  const ticket = String(opts.mpTicket || getMpTicket() || '').trim()
  if (ticket) saveMpTicket(ticket)
  setGuestSession({
    mpTicket: ticket || undefined,
    nickname: opts.nickname,
    avatarUrl: opts.avatarUrl,
    browseOnly: !!opts.browseOnly && !ticket,
    orderReady: !!opts.orderReady,
    enteredAt: Date.now(),
  })
}

/** 未登录直接进开单表：本机开单、打印，不上云 */
export function enterBrowseOnlyGuest() {
  clearMpTicket()
  setGuestSession({
    browseOnly: true,
    orderReady: true,
    enteredAt: Date.now(),
  })
}

/** 用微信手机号按钮返回的 code 换成大陆手机号。 */
export async function resolveMpPhone(phoneCode: string, mpTicket?: string) {
  const code = String(phoneCode || '').trim()
  if (!code) return { ok: false as const, error: '未拿到微信手机号授权' }
  const ticket = (mpTicket || getMpTicket()).trim()
  const r = await imageOkRequest<{ phone?: string }>({
    path: '/api/auth/mp/resolve-phone',
    data: {
      code,
      mp_ticket: ticket,
      appid: resolveMpAppId(),
    },
  })
  const phone = String(r.data?.phone || '').trim()
  if (!r.ok || !/^1\d{10}$/.test(phone)) {
    return { ok: false as const, error: r.error || '无法获取微信手机号' }
  }
  return { ok: true as const, phone }
}

/** 绑定页：发送短信。开单小程序验码后建成商家账号。 */
export async function sendMpBindSms(
  phone: string,
  mpTicket?: string,
  proof?: { challengeId?: string; points?: { x: number; y: number; t: number }[] },
) {
  const ticket = (mpTicket || getMpTicket()).trim()
  if (!ticket) return { ok: false as const, error: '绑定已过期，请重新微信登录' }
  const r = await imageOkRequest<{ message?: string }>({
    path: '/api/auth/mp/send-bind-sms',
    data: {
      mp_ticket: ticket,
      phone: phone.trim(),
      appid: resolveMpAppId(),
      client: 'web',
      challenge_id: String(proof?.challengeId || ''),
      points: proof?.points || [],
    },
  })
  if (!r.ok) return { ok: false as const, error: r.error || '发送失败' }
  return {
    ok: true as const,
    message: (r.data as { message?: string })?.message || '验证码已发送',
  }
}

/** 验码绑定微信 → 开单会话 */
export async function bindMpPhoneAndLogin(
  phone: string,
  smsCode: string,
  mpTicket?: string,
  profile?: {
    nickName?: string
    nickname?: string
    avatarUrl?: string
    avatar_url?: string
  },
) {
  const ticket = (mpTicket || getMpTicket()).trim()
  if (!ticket) return { ok: false as const, error: '绑定已过期，请重新微信登录' }
  const nickname = String(profile?.nickName || profile?.nickname || '').trim()
  const avatarUrl = String(profile?.avatarUrl || profile?.avatar_url || '').trim()
  const r = await imageOkRequest<MpLoginBody>({
    path: '/api/auth/mp/bind',
    data: {
      mp_ticket: ticket,
      phone: phone.trim(),
      sms_code: String(smsCode || '').trim(),
      appid: resolveMpAppId(),
      nickname,
      avatar_url: avatarUrl,
    },
  })
  if (!r.ok || !r.data?.token) {
    return { ok: false as const, error: r.error || '绑定失败' }
  }
  return loginViaImageOkToken(String(r.data.token))
}

export function logout(opts?: { keepAgentWorkspace?: boolean }) {
  try {
    clearTeamDataCaches()
  } catch (_) {}
  let stayAgent = opts?.keepAgentWorkspace !== false
  if (stayAgent) {
    try {
      const ws = require('./workspace') as typeof import('./workspace')
      stayAgent = ws.peekAgentBoundFlag()
    } catch (_) {
      stayAgent = false
    }
  }
  clearSession()
  clearGuestSession()
  clearMpTicket()
  try {
    wx.removeStorageSync(IMAGEOK_TOKEN_KEY)
  } catch (e) {}
  if (stayAgent) {
    try {
      const { setWorkspacePreference } = require('./workspace') as typeof import('./workspace')
      setWorkspacePreference('agent')
    } catch (_) {}
  }
}

/** 代理工作台退出：清会话，回到图可开单登录页，不再进游客首页 */
export function exitAgentToLogin() {
  try {
    const { stopSessionGuard } = require('./session-guard') as typeof import('./session-guard')
    stopSessionGuard()
  } catch (_) {}
  logout({ keepAgentWorkspace: false })
  try {
    const { clearTeamDataCaches } = require('./cache') as typeof import('./cache')
    clearTeamDataCaches()
  } catch (_) {}
  try {
    const { clearEntitlementCache } = require('./subscription') as typeof import('./subscription')
    clearEntitlementCache()
  } catch (_) {}
  try {
    const { setWorkspacePreference } = require('./workspace') as typeof import('./workspace')
    setWorkspacePreference('merchant')
  } catch (_) {}
  wx.reLaunch({ url: '/pages/login/login?mode=agent&stay=1' })
}

/** 单设备登录：校验本机 clientId 是否仍为活跃会话 */
export async function checkSessionStatus(): Promise<{
  valid: boolean
  kicked: boolean
  message?: string
}> {
  const s = getSession()
  if (!s?.phone || !s.clientId) {
    return { valid: true, kicked: false }
  }
  const res = await request<{
    valid?: boolean
    reason?: string
    activeDevice?: string
    message?: string
  }>({
    path: `/api/v1/auth/session-status?clientId=${encodeURIComponent(s.clientId)}`,
    timeout: 12000,
    skipAuthKick: true,
  })
  if (!res.ok || !res.data) {
    return { valid: true, kicked: false }
  }
  const data = res.data
  if (data.valid === true) {
    return { valid: true, kicked: false }
  }
  if (data.reason === 'banned') {
    return {
      valid: false,
      kicked: true,
      message: (data.message || '').trim() || '账号已被封禁，不能登录',
    }
  }
  if (data.reason === 'kicked') {
    const msg =
      (data.message || '').trim() ||
      kickedMessageForDevice(data.activeDevice)
    return { valid: false, kicked: true, message: msg }
  }
  if (data.reason === 'not_found') {
    return {
      valid: false,
      kicked: false,
      message: '账号会话已失效，请重新登录',
    }
  }
  return { valid: false, kicked: false }
}

function kickedMessageForDevice(activeDevice?: string): string {
  if (activeDevice === 'mobile') {
    return '您的账号已在手机端登录，本设备已自动退出'
  }
  if (activeDevice === 'desktop') {
    return '您的账号已在电脑端登录，本设备已自动退出'
  }
  return '您的账号已在其它设备登录，本设备已自动退出'
}

const SCAN_TICKET_RE = /^[a-f0-9]{32}$/i

export function parseScanTicket(raw: string | undefined): string {
  let s = String(raw == null ? '' : raw).trim()
  if (!s) return ''
  try {
    s = decodeURIComponent(s)
  } catch (_) {}
  if (SCAN_TICKET_RE.test(s)) return s.toLowerCase()
  const fromQuery = s.match(/(?:^|[?&#/])(?:scene|t|ticket)=([a-f0-9]{32})\b/i)
  if (fromQuery) return fromQuery[1].toLowerCase()
  return ''
}

export type ScanLoginPreview = {
  ok: boolean
  error?: string
  httpStatus?: number
  deviceLabel?: string
  client?: string
  phoneMasked?: string
  nickname?: string
}

async function scanAuthPost(path: string, ticket: string): Promise<{
  ok: boolean
  error?: string
  httpStatus?: number
  data?: Record<string, unknown>
}> {
  const token = getImageOkToken()
  if (!token) {
    return { ok: false, error: '请先微信登录并绑定手机号', httpStatus: 401 }
  }
  const r = await imageOkRequest<Record<string, unknown>>({
    path,
    data: { ticket },
    token,
  })
  if (!r.ok) {
    return {
      ok: false,
      error: r.error || '请求失败',
      httpStatus: r.httpStatus,
    }
  }
  return { ok: true, data: r.data as Record<string, unknown>, httpStatus: r.httpStatus }
}

export async function previewScanLogin(ticket: string): Promise<ScanLoginPreview> {
  const t = parseScanTicket(ticket)
  if (!t) return { ok: false, error: '登录码无效' }
  const r = await scanAuthPost('/api/auth/mp/scan/preview', t)
  if (!r.ok) return { ok: false, error: r.error, httpStatus: r.httpStatus }
  const data = r.data || {}
  const account = (data.account || {}) as { nickname?: string; phone_masked?: string }
  return {
    ok: true,
    deviceLabel: String(data.device_label || ''),
    client: String(data.client || ''),
    phoneMasked: String(account.phone_masked || ''),
    nickname: String(account.nickname || ''),
  }
}

export async function confirmScanLogin(ticket: string): Promise<ScanLoginPreview & { message?: string }> {
  const t = parseScanTicket(ticket)
  if (!t) return { ok: false, error: '登录码无效' }
  const r = await scanAuthPost('/api/auth/mp/scan/confirm', t)
  if (!r.ok) return { ok: false, error: r.error, httpStatus: r.httpStatus }
  const data = r.data || {}
  return {
    ok: true,
    message: String(data.message || '已确认'),
    deviceLabel: String(data.device_label || ''),
    client: String(data.client || ''),
  }
}

export { API_BASE }
