/** 商家开单台 vs 代理代发台。代理是微信绑定客户，不是档口云账号。 */

import { isGuest, isLoggedIn } from './session'

export const OFFICIAL_SITE_URL = 'https://imageok.cn'
const OWNER_KEY = 'tuk_agent_owner_v1'
const AGENT_BOUND_KEY = 'tuk_agent_bound_v1'
const ROLE_KEY = 'tuk_workspace_role_v1'

export type WorkspaceRole = 'merchant' | 'agent'

export function peekAgentBoundFlag(): boolean {
  try {
    return !!wx.getStorageSync(AGENT_BOUND_KEY)
  } catch (_) {
    return false
  }
}

export function getWorkspacePreference(): WorkspaceRole {
  try {
    const v = wx.getStorageSync(ROLE_KEY)
    if (v === 'agent' || v === 'merchant') return v
  } catch (_) {}
  if (isLoggedIn() && !isGuest()) return 'merchant'
  return peekAgentBoundFlag() ? 'agent' : 'merchant'
}

export function setWorkspacePreference(role: WorkspaceRole) {
  try {
    wx.setStorageSync(ROLE_KEY, role)
  } catch (_) {}
}

export function isAgentWorkspace(): boolean {
  if (!peekAgentBoundFlag()) return false
  return getWorkspacePreference() === 'agent'
}

export function isMerchantSession(): boolean {
  return isLoggedIn() && !isGuest()
}

/** 开发者工具 / 开发版。编译启动不要沿用上次代理台。 */
export function isDevelopMp(): boolean {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion === 'develop'
  } catch (_) {
    return false
  }
}

/** 开发版冷启动：未登录商家时回到介绍首页，避免模拟器残留代理态。 */
export function resetDevelopLaunchWorkspace() {
  if (!isDevelopMp() || isMerchantSession()) return
  setWorkspacePreference('merchant')
}

/** 仅「已绑代理微信 + 已登录商家」可切换。 */
export function canSwitchWorkspace(): boolean {
  return peekAgentBoundFlag() && isMerchantSession()
}

export function switchWorkspace(role: WorkspaceRole): { ok: boolean; error?: string } {
  if (role === 'agent') {
    if (!peekAgentBoundFlag()) return { ok: false, error: '尚未绑定代理档口' }
    setWorkspacePreference('agent')
    return { ok: true }
  }
  if (!isLoggedIn() || isGuest()) return { ok: false, error: '请先登录商家账号' }
  setWorkspacePreference('merchant')
  return { ok: true }
}

export function applyWorkspaceAndRelaunch(role: WorkspaceRole) {
  const r = switchWorkspace(role)
  if (!r.ok) {
    wx.showToast({ title: r.error || '无法切换', icon: 'none' })
    return
  }
  const url = `/pages/home/home?ws=${encodeURIComponent(role)}`
  wx.reLaunch({
    url,
    fail: () => {
      wx.switchTab({ url: '/pages/home/home' })
    },
  })
}

export function peekAgentOwnerId(): number {
  try {
    const raw = wx.getStorageSync(OWNER_KEY)
    if (raw === '' || raw === null || raw === undefined) return 0
    return Number(raw) || 0
  } catch (_) {
    return 0
  }
}

export function saveAgentOwnerId(id: number) {
  try {
    wx.setStorageSync(OWNER_KEY, Number(id) || 0)
  } catch (_) {}
}

const PROFILE_OK = 'tuk_agent_profile_ok_v1'

export function peekAgentProfileOk(): boolean {
  try {
    return Number(wx.getStorageSync(PROFILE_OK) || 0) === 1
  } catch (_) {
    return false
  }
}

export function saveAgentProfileOk(ok: boolean) {
  try {
    wx.setStorageSync(PROFILE_OK, ok ? 1 : 0)
  } catch (_) {}
}

export function openAgentProfileGate() {
  wx.redirectTo({
    url: '/pages/agent-profile/agent-profile?gate=1',
    fail: () => {
      wx.navigateTo({ url: '/pages/agent-profile/agent-profile?gate=1' })
    },
  })
}

export function tabBarTheme(): 'agent' | 'merchant' {
  return isAgentWorkspace() ? 'agent' : 'merchant'
}

export function openOfficialSite(title = '图可官网') {
  wx.navigateTo({
    url: `/pages/web/web?url=${encodeURIComponent(OFFICIAL_SITE_URL)}&title=${encodeURIComponent(title)}`,
  })
}
