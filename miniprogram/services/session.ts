/** 本地会话（与 App 同账号体系；accessToken + clientId 设备绑定） */

import { ensureStorageHeadroom, safeSetStorage } from './cache'

const SESSION_KEY = 'tuk_session'
const GUEST_KEY = 'tuk_guest_session'

export interface TeamInfo {
  role?: string
  ownerUserId?: number
  displayName?: string
  shopName?: string
  [key: string]: unknown
}

export interface Session {
  phone: string
  clientId: string
  userId: number
  isAdmin?: boolean
  team?: TeamInfo | null
  accessToken?: string
  loggedInAt: number
}

/** 微信游客：仅 openid 票据，无手机号 / 无开单 accessToken */
export interface GuestSession {
  /** 有票据时可直接升绑；纯浏览介绍可为空 */
  mpTicket?: string
  nickname?: string
  avatarUrl?: string
  /** true = 未微信登录，仅看介绍 */
  browseOnly?: boolean
  /** 已确认用户须知，可进本地开单本 */
  orderReady?: boolean
  enteredAt: number
}

export function getSession(): Session | null {
  try {
    const raw = wx.getStorageSync(SESSION_KEY)
    if (!raw || typeof raw !== 'object') return null
    const s = raw as Session
    if (!s.phone || !s.clientId || !s.userId) return null
    return s
  } catch {
    return null
  }
}

export function setSession(s: Session) {
  ensureStorageHeadroom()
  clearGuestSession()
  if (!safeSetStorage(SESSION_KEY, s)) {
    throw new Error('本地缓存已满，请清除数据缓存后重试')
  }
}

export function clearSession() {
  try {
    wx.removeStorageSync(SESSION_KEY)
  } catch (_) {}
}

export function getGuestSession(): GuestSession | null {
  try {
    const raw = wx.getStorageSync(GUEST_KEY)
    if (!raw || typeof raw !== 'object') return null
    const g = raw as GuestSession
    if (!g.enteredAt) return null
    return g
  } catch {
    return null
  }
}

export function setGuestSession(g: GuestSession) {
  ensureStorageHeadroom()
  clearSession()
  const payload: GuestSession = {
    mpTicket: (g.mpTicket || '').trim() || undefined,
    nickname: (g.nickname || '').trim() || undefined,
    avatarUrl: (g.avatarUrl || '').trim() || undefined,
    browseOnly: !!g.browseOnly,
    orderReady: !!g.orderReady,
    enteredAt: g.enteredAt || Date.now(),
  }
  if (!safeSetStorage(GUEST_KEY, payload)) {
    throw new Error('本地缓存已满，请清除数据缓存后重试')
  }
}

/** 标记游客已确认须知，可本地开单 */
export function markGuestOrderReady() {
  const g = getGuestSession()
  if (!g) {
    setGuestSession({ orderReady: true, browseOnly: true, enteredAt: Date.now() })
    return
  }
  setGuestSession({ ...g, orderReady: true, enteredAt: g.enteredAt || Date.now() })
}

export function clearGuestSession() {
  try {
    wx.removeStorageSync(GUEST_KEY)
  } catch (_) {}
}

/** 正式开单账号（有 accessToken） */
export function isLoggedIn(): boolean {
  const s = getSession()
  return !!(s && String(s.accessToken || '').trim())
}

/** 微信游客或纯浏览介绍 */
export function isGuest(): boolean {
  if (isLoggedIn()) return false
  return !!getGuestSession()
}

/** 可进入主界面（正式登录或游客） */
export function canBrowseApp(): boolean {
  return isLoggedIn() || isGuest()
}

export function getAccessToken(): string {
  return (getSession()?.accessToken || '').trim()
}

export function setAccessToken(token: string) {
  const s = getSession()
  if (!s) return
  s.accessToken = (token || '').trim()
  setSession(s)
}
