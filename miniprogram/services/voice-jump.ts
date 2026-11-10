/** switchTab 带不了 query，语音跨页搜索走本机一跳。 */

export type VoiceJumpPage =
  | 'products'
  | 'orders'
  | 'customers'
  | 'stock'
  | 'analytics'
  | 'returns'
  | 'printSettings'
  | 'printer'

export type VoiceJump = {
  page: VoiceJumpPage
  keyword?: string
  customer?: string
  intent?: string
  from?: string
  to?: string
  range?: string
  unpaidOnly?: boolean
  /** 商品页打开导入或导出。 */
  action?: 'import' | 'export' | 'add'
}

const KEY = 'tuk_voice_jump_v1'

export function setVoiceJump(jump: VoiceJump) {
  try {
    wx.setStorageSync(KEY, jump)
  } catch (_) {}
}

export function takeVoiceJump(page: VoiceJumpPage): VoiceJump | null {
  try {
    const raw = wx.getStorageSync(KEY) as VoiceJump | null
    if (!raw || raw.page !== page) return null
    wx.removeStorageSync(KEY)
    return raw
  } catch (_) {
    return null
  }
}
