import { extractInviteToken } from '../../services/lookup'

/** 旧分享链接仍指向本页。有邀请码才进代理登录；空进则回首页介绍。 */
Page({
  onLoad(query: Record<string, string | undefined>) {
    const parsed = extractInviteToken(
      String(query?.invite || query?.token || query?.staffInvite || ''),
    )
    const stall = String(parsed.invite || '').trim()
    const staff = String(parsed.staffInvite || '').trim()
    if (!stall && !staff) {
      wx.reLaunch({
        url: '/pages/home/home',
        fail: () => wx.switchTab({ url: '/pages/home/home' }),
      })
      return
    }
    const parts = ['mode=agent', 'stay=1']
    if (stall) parts.push(`invite=${encodeURIComponent(stall)}`)
    if (staff) parts.push(`staffInvite=${encodeURIComponent(staff)}`)
    const url = `/pages/login/login?${parts.join('&')}`
    wx.redirectTo({
      url,
      fail: () => wx.reLaunch({ url }),
    })
  },
})
