/** 单设备登录：其它端登录后本机自动退出并提示 */

import { checkSessionStatus, logout } from './auth'
import { clearTeamDataCaches } from './cache'
import { isLoggedIn } from './session'

let _timer: ReturnType<typeof setInterval> | null = null
let _checking = false
let _kicking = false
let _bootTimer: ReturnType<typeof setTimeout> | null = null

const LOGOUT_NOTICE_KEY = 'tuk_logout_notice'
/** 轮询间隔拉长，避免模拟器频繁请求+热重载叠加卡顿 */
const POLL_MS = 60000
/** 启动后再查，避免与首屏渲染抢主线程 */
const BOOT_DELAY_MS = 3000

function goLoginWithMessage(message: string, title?: string) {
  logout()
  try {
    clearTeamDataCaches()
  } catch (_) {}
  try {
    wx.setStorageSync(LOGOUT_NOTICE_KEY, message)
  } catch (_) {}
  wx.showModal({
    title: title || '账号已在其它端登录',
    content: message,
    showCancel: false,
    confirmText: '重新登录',
    success: () => {
      wx.reLaunch({ url: '/pages/login/login' })
    },
    fail: () => {
      wx.reLaunch({ url: '/pages/login/login' })
    },
  })
}

/** 校验会话；被踢则清登录态并提示 */
export async function verifyOrKick(): Promise<boolean> {
  if (_checking || _kicking) return false
  if (!isLoggedIn()) return false
  _checking = true
  try {
    const status = await checkSessionStatus()
    if (status.valid) return false
    if (!isLoggedIn()) return false
    _kicking = true
    stopSessionGuard()
    const msg =
      status.message ||
      '您的账号已在其它设备登录，本设备已自动退出'
    const banned = msg.indexOf('封禁') >= 0
    goLoginWithMessage(msg, banned ? '账号已封禁' : undefined)
    return true
  } catch (_) {
    // 网络失败不踢人，避免预览卡死感
    return false
  } finally {
    _checking = false
    setTimeout(() => {
      _kicking = false
    }, 2000)
  }
}

export function startSessionGuard() {
  if (_timer || _bootTimer) return
  _bootTimer = setTimeout(() => {
    _bootTimer = null
    void verifyOrKick()
    if (_timer) return
    _timer = setInterval(() => {
      void verifyOrKick()
    }, POLL_MS)
  }, BOOT_DELAY_MS)
}

export function stopSessionGuard() {
  if (_bootTimer) {
    clearTimeout(_bootTimer)
    _bootTimer = null
  }
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
}

/** 小程序切回前台时立即检查（已在轮询中则不叠加重试） */
export function onAppShowSessionCheck() {
  if (!isLoggedIn()) {
    stopSessionGuard()
    return
  }
  if (!_timer && !_bootTimer) {
    startSessionGuard()
  } else if (_timer && !_checking && !_kicking) {
    void verifyOrKick()
  }
}
