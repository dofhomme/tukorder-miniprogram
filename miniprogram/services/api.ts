/** API 基础：统一请求、clientId、Bearer Token、错误解析 */

import { markNetworkOk, markPoorNetwork } from './network-hint'
import { clearSession, getAccessToken, getSession, isGuest, isLoggedIn, setAccessToken } from './session'

export const API_BASE = 'https://api.imageok.cn'

const CLIENT_ID_KEY = 'tuk_client_id'

function uuidv4(): string {
  const s: string[] = []
  const hex = '0123456789abcdef'
  for (let i = 0; i < 36; i++) {
    s[i] = hex[Math.floor(Math.random() * 16)]
  }
  s[14] = '4'
  s[19] = hex[(parseInt(s[19], 16) & 0x3) | 0x8]
  s[8] = s[13] = s[18] = s[23] = '-'
  return s.join('')
}

export function getOrCreateClientId(): string {
  let id = wx.getStorageSync(CLIENT_ID_KEY) as string
  if (!id || typeof id !== 'string' || id.length < 8) {
    id = uuidv4()
    wx.setStorageSync(CLIENT_ID_KEY, id)
  }
  return id
}

export function setClientId(id: string) {
  if (id) wx.setStorageSync(CLIENT_ID_KEY, id)
}

export interface ApiResult<T = unknown> {
  ok: boolean
  code: number
  err?: string
  message: string
  data: T | null
  httpStatus?: number
}

let _authKickScheduled = false

function scheduleReLogin(message: string) {
  if (_authKickScheduled) return
  if (!getSession()) return
  _authKickScheduled = true
  try {
    clearSession()
  } catch (_) {}
  setTimeout(() => {
    _authKickScheduled = false
    const tip =
      message && /其它|其他|手机端|设备/.test(message)
        ? message
        : message || '登录已失效，请重新登录'
    wx.showModal({
      title: '请重新登录',
      content: tip,
      showCancel: false,
      success: () => {
        wx.reLaunch({ url: '/pages/login/login' })
      },
      fail: () => {
        wx.reLaunch({ url: '/pages/login/login' })
      },
    })
  }, 50)
}

/** 轻量读本地权益（避免与 subscription ↔ api 循环依赖） */
function peekCloudSyncAllowed(): boolean {
  if (!isLoggedIn()) return false
  try {
    if (
      wx.getAccountInfoSync().miniProgram.envVersion === 'develop' &&
      wx.getStorageSync('tuk_dev_force_cloud_sync')
    ) return true
    const e = wx.getStorageSync('tuk_cloud_entitlement_v1') as {
      status?: string
      expireAt?: string | null
      cloudActive?: boolean
    } | null
    if (!e) return false
    if (e.cloudActive !== true && e.status !== 'active') return false
    if (!e.expireAt) return true
    const t = Date.parse(String(e.expireAt))
    return Number.isFinite(t) ? t > Date.now() : false
  } catch {
    return false
  }
}

/**
 * 云端门禁：
 * - 游客/未登录：team / ai / print / billing 一律不上云
 * - 已登录未订阅：team（含 GET）与 ai、print 写操作禁止；billing 放行以便开通
 */
function cloudAccessDenied(
  path: string,
  method: string,
  needAuth: boolean,
): ApiResult | null {
  if (!needAuth) return null
  const p = String(path || '')
  const m = (method || 'GET').toUpperCase()
  const guestOrAnon = isGuest() || !isLoggedIn()
  const cloudOk = peekCloudSyncAllowed()

  const isTeam = p.startsWith('/api/v1/team')
  const isAi = p.startsWith('/api/v1/ai')
  const isPrint = p.startsWith('/api/v1/print')
  const isBilling = p.startsWith('/api/v1/billing')

  // 代理台即使还留着商家登录态，也不走档口云接口，避免两套数据串台
  try {
    if (
      wx.getStorageSync('tuk_workspace_role_v1') === 'agent' &&
      !!wx.getStorageSync('tuk_agent_bound_v1') &&
      (isTeam || isAi || isPrint || isBilling)
    ) {
      return {
        ok: false,
        code: 403,
        message: '代理工作台不使用商家云数据',
        data: null,
        httpStatus: 403,
      }
    }
  } catch (_) {}

  if (guestOrAnon) {
    if (isTeam || isAi || isPrint || isBilling) {
      return {
        ok: false,
        code: 401,
        message: '游客模式仅本机，数据不上云',
        data: null,
        httpStatus: 401,
      }
    }
    return null
  }

  if (!cloudOk) {
    if (isBilling) return null
    if (isTeam) {
      return {
        ok: false,
        code: 403,
        message: '未开通云同步，仅本机可用',
        data: null,
        httpStatus: 403,
      }
    }
    if (isAi || isPrint) {
      return {
        ok: false,
        code: 403,
        message: '未开通云同步',
        data: null,
        httpStatus: 403,
      }
    }
  }
  return null
}

export function request<T = unknown>(options: {
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: WechatMiniprogram.IAnyObject | string
  /** 默认 true：带 Bearer；登录等接口传 false */
  needAuth?: boolean
  timeout?: number
  headers?: Record<string, string>
  /** 401 时不踢回登录页（如 session-status） */
  skipAuthKick?: boolean
}): Promise<ApiResult<T>> {
  const clientId = getOrCreateClientId()
  const method = options.method || 'GET'
  const needAuth = options.needAuth !== false
  const denied = cloudAccessDenied(String(options.path || ''), method, needAuth)
  if (denied) {
    return Promise.resolve(denied as ApiResult<T>)
  }
  const header: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Id': clientId,
    ...(options.headers || {}),
  }
  const sentToken = needAuth ? getAccessToken() : ''
  if (sentToken) header.Authorization = `Bearer ${sentToken}`

  return new Promise((resolve) => {
    wx.request({
      url: `${API_BASE}${options.path}`,
      method,
      data: options.data,
      header,
      timeout: options.timeout || 30000,
      success(res) {
        const status = res.statusCode
        if (sentToken && status === 200) {
          const h = (res.header || {}) as Record<string, string>
          const renewed = String(h['X-Access-Token'] || h['x-access-token'] || '').trim()
          if (renewed && getAccessToken() === sentToken) setAccessToken(renewed)
        }
        const body = res.data as {
          code?: number
          err?: string
          message?: string
          data?: T
        } | null
        if (status === 502 || status === 503 || status === 504) {
          markPoorNetwork()
        } else {
          markNetworkOk()
        }
        if (!body || typeof body !== 'object') {
          resolve({
            ok: false,
            code: 1,
            message: `服务响应异常(${status})`,
            data: null,
            httpStatus: status,
          })
          return
        }
        const code = typeof body.code === 'number' ? body.code : 1
        const message = body.message || (code === 0 ? 'ok' : '请求失败')
        if (
          !options.skipAuthKick &&
          needAuth &&
          (status === 401 ||
            /请重新登录|请先登录|登录已过期|凭证|会话已失效|其它设备/.test(message))
        ) {
          scheduleReLogin(message)
        }
        resolve({
          ok: code === 0,
          code,
          err: typeof body.err === 'string' ? body.err : '',
          message,
          data: (body.data ?? null) as T | null,
          httpStatus: status,
        })
      },
      fail(err) {
        markPoorNetwork()
        resolve({
          ok: false,
          code: -1,
          message: err.errMsg || '网络错误，请检查域名与网络',
          data: null,
        })
      },
    })
  })
}

export function genOrderNo(): string {
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(2, '0')
  const stamp =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  const rand = Math.floor(Math.random() * 9000 + 1000)
  return `MP${stamp}${rand}`
}

export function genJobNo(): string {
  return uuidv4()
}
