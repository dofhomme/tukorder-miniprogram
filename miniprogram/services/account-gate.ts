/** 云端能力门禁：账号 vs 云同步订阅分层 */

import { getMpTicket } from './auth'
import { canBrowseApp, clearGuestSession, getGuestSession, isLoggedIn } from './session'
import { isCloudSyncAllowed, refreshEntitlement } from './subscription'

export type CloudGateReason =
  | 'order'
  | 'sync'
  | 'print_cloud'
  | 'team'
  | 'products'
  | 'orders'
  | 'generic'
  | 'upload_local'
  | 'ai'
  | 'voice'
  | 'returns'

const REASON_COPY: Record<CloudGateReason, { title: string; content: string }> = {
  order: {
    title: '开单需绑定账号',
    content:
      '本机开单可先游客使用。绑定手机号后可登录账号；云端同步需另开通订阅。',
  },
  sync: {
    title: '云同步需开通订阅',
    content:
      '拉取/上传云端商品、客户与订单属于云同步服务。未开通时数据仍只保存在本机。',
  },
  print_cloud: {
    title: '云打印需开通订阅',
    content: '云打印任务挂在开单账号的云同步权益下，请先开通云同步订阅。',
  },
  team: {
    title: '团队功能需开通订阅',
    content: '团队与店铺云端管理需要有效云同步。店主开通后可勾选跟随员工，未勾选的员工需自行开通。',
  },
  products: {
    title: '云端商品库需订阅',
    content: '云端商品与库存属于店铺云数据，请开通云同步后使用；本机商品库可继续用。',
  },
  orders: {
    title: '云端订单需订阅',
    content: '云端历史订单需开通云同步；本机订单仍可在本机查看。',
  },
  generic: {
    title: '需要开单账号',
    content: '该功能需要绑定手机号后使用。',
  },
  upload_local: {
    title: '上传本机数据需订阅',
    content:
      '将本机开单数据上传云端并与电脑端/App 同步，需开通云同步。',
  },
  ai: {
    title: 'AI 识别为订阅专属',
    content:
      '文字识别与相册/拍照识图开单属于云同步会员功能。游客不可使用。',
  },
  voice: {
    title: '语音智能开单',
    content:
      '按住说话就能填货号、选客户、打印小票。开通云同步后即可使用。',
  },
  returns: {
    title: '退包登记需开通订阅',
    content: '退包登记属于云端业务，游客不可用；请登录并开通云同步后使用。',
  },
}

function goBindOrLogin() {
  const ticket =
    (getGuestSession()?.mpTicket || '').trim() || getMpTicket().trim()
  const q = ticket ? '?bind=1' : '?stay=1'
  wx.reLaunch({ url: `/pages/login/login${q}` })
}

function goSubscription(from?: string) {
  const q = from ? `?from=${encodeURIComponent(from)}` : ''
  wx.navigateTo({ url: `/pages/subscription/subscription${q}` })
}

/**
 * 已正式登录返回 true；否则弹窗引导绑定/登录，返回 false。
 */
export function requireCloudAccount(reason: CloudGateReason = 'generic'): boolean {
  if (isLoggedIn()) return true
  if (!canBrowseApp()) {
    wx.reLaunch({ url: '/pages/login/login' })
    return false
  }
  const copy = REASON_COPY[reason] || REASON_COPY.generic
  const ticket =
    (getGuestSession()?.mpTicket || '').trim() || getMpTicket().trim()
  // 同步类：未登录先绑号；已登录走 requireCloudSync
  const isSyncish =
    reason === 'sync' ||
    reason === 'upload_local' ||
    reason === 'print_cloud' ||
    reason === 'team' ||
    reason === 'products' ||
    reason === 'orders' ||
    reason === 'ai' ||
    reason === 'voice' ||
    reason === 'returns'
  wx.showModal({
    title: isSyncish ? '需要绑定账号' : copy.title,
    content: isSyncish
      ? '请先绑定手机号或登录。绑定免费；云端同步为付费订阅。'
      : copy.content,
    confirmText: ticket ? '去绑定' : '去登录',
    cancelText: '再看看',
    success(res) {
      if (res.confirm) goBindOrLogin()
    },
  })
  return false
}

/**
 * 已登录且云同步订阅有效 → true。
 * 未登录 → 走绑号引导；已登录未订阅 → 引导订阅页。
 */
export function requireCloudSync(reason: CloudGateReason = 'sync'): boolean {
  if (!isLoggedIn()) {
    return requireCloudAccount(reason === 'generic' ? 'sync' : reason)
  }
  if (isCloudSyncAllowed()) return true
  void refreshEntitlement({ force: false }).then(() => {
    /* 后台刷新，下次进入可能已开通 */
  })
  if (isCloudSyncAllowed()) return true

  const copy = REASON_COPY[reason] || REASON_COPY.sync
  wx.showModal({
    title: copy.title,
    content: copy.content,
    confirmText: '去开通',
    cancelText: '暂不',
    success(res) {
      if (res.confirm) goSubscription(reason)
    },
  })
  return false
}

/** 退出游客浏览（不清正式会话） */
export function exitGuestBrowse() {
  clearGuestSession()
  try {
    wx.removeStorageSync('tuk_mp_bind_ticket')
  } catch (_) {}
}
