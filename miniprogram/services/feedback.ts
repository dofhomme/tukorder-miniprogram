/** 技术支持留言：游客 / 绑定用户、商家 / 代理均可提交 */

import { getOrCreateClientId, request } from './api'
import { getGuestSession, getSession, isLoggedIn } from './session'
import { msgSecCheck } from './sec-check'
import { peekCachedShop } from './team'
import { isAgentWorkspace } from './workspace'

export type FeedbackRole = 'merchant' | 'agent'

export async function submitFeedback(
  message: string,
  opts?: {
    role?: FeedbackRole
    shopName?: string
    nickname?: string
  },
): Promise<{
  ok: boolean
  error?: string
}> {
  const text = (message || '').trim()
  if (!text) return { ok: false, error: '请填写留言内容' }
  if (text.length > 1000) return { ok: false, error: '留言不超过1000字' }

  // 微信 security.msgSecCheck；scene=2 评论/留言
  wx.showLoading({ title: '安全检测', mask: true })
  const sec = await msgSecCheck(text, 2)
  wx.hideLoading()
  if (!sec.ok) {
    return { ok: false, error: sec.error || '内容未通过安全检测' }
  }

  const session = getSession()
  const guest = getGuestSession()
  const agent = opts?.role === 'agent' || (opts?.role == null && isAgentWorkspace())
  const role: FeedbackRole = agent ? 'agent' : 'merchant'
  const shop = peekCachedShop()
  const nickname = String(
    opts?.nickname ||
      session?.team?.displayName ||
      guest?.nickname ||
      '',
  ).trim()

  const res = await request({
    path: '/api/v1/app/feedback',
    method: 'POST',
    needAuth: isLoggedIn(),
    skipAuthKick: true,
    data: {
      clientId: getOrCreateClientId(),
      message: text,
      role,
      shopName: String(opts?.shopName || shop?.shopName || '').trim(),
      nickname: nickname || undefined,
    },
  })
  if (!res.ok) return { ok: false, error: res.message || '提交失败' }
  return { ok: true }
}
