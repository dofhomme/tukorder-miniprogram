/** 微信订阅消息

官方：
https://developers.weixin.qq.com/miniprogram/dev/api/open-api/subscribe-message/wx.requestSubscribeMessage.html
https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/subscribe-message/api_sendmessage
*/

import { request } from './api'

/** 公众平台模板「购买成功通知」编号 556 */
export const PURCHASE_SUCCESS_TMPL_ID =
  'W1z3KaK22DH-ng4RpLmNdXYuKYZmutLKYOKFdOBzwis'

/** 自己选词的「会员到期提醒」。云同步到期前提醒续费 */
export const EXPIRE_RENEW_TMPL_ID =
  '4qxhI36f821kpcTIGoyD8e-eBh7XATfuzfGcKM1W_xY'

/** 自己选词的「账单通知」。档口名称 / 开单时间 / 货款总额 */
export const BILL_NOTICE_TMPL_ID =
  '5HTdwA7Rwvs2RZ-L3B0sjJ18YsLJoD8EotwuXekwlyM'

/** 自己选词的「新商品上架提醒」。上架商品数 / 上架时间 / 备注 */
export const NEW_ARRIVAL_TMPL_ID =
  'GMBrvPLdk0kYxIFdw5Lkjue6sO69IpT_ofCQSUdB43E'

/** 公众平台模板「发货通知」编号 469 */
export const SHIP_NOTICE_TMPL_ID =
  'VeCDQey04lOWqwQnK1fTgfm0IAOzdFC4Mqgbb0O8fck'

/** 公众平台模板「绑定用户通知」编号 681 · 代理绑定后提醒商家 */
export const BIND_NOTICE_TMPL_ID =
  'vIt_ecBdbr7HVXIBMD2uXwPNcUsk6KNAMAZdP12wY4g'

/** 自己选词的「下单结果通知」。下单时间 / 订单编号 / 下单状态 / 备注 */
export const ORDER_NOTICE_TMPL_ID =
  's-ZHdJ2732cQ6kpP40tkzwilbxnFz6pIieigQm3xlFI'

/** 自己选词的「代理人申请通知」。代理申请后提醒商家 */
export const AGENT_APPLY_NOTICE_TMPL_ID =
  'mVY3Kvy5txgRCoH5RA38aMlu5_z9ZnEKjpV3EzkHQco'

/** 自己选词的「审核结果通知」。商家审核后提醒代理 */
export const AGENT_APPLY_RESULT_TMPL_ID =
  'TJKmukPV1cVi9yHVzugx_5akkOjZUAjNZtxNCNG-r8I'

const BILL_SUB_ASKED_KEY = 'tuk_bill_sub_asked_v2'
const NEW_ARRIVAL_SUB_ASKED_KEY = 'tuk_new_arrival_sub_asked_v2'
const SHIP_SUB_ASKED_KEY = 'tuk_ship_sub_asked_v1'
const BIND_SUB_ASKED_KEY = 'tuk_bind_sub_asked_v1'
const ORDER_SUB_ASKED_KEY = 'tuk_order_sub_asked_v2'
const AGENT_APPLY_NOTICE_ASKED_KEY = 'tuk_agent_apply_notice_sub_v2'
const EXPIRE_RENEW_ASKED_KEY = 'tuk_expire_renew_sub_v3'

function peekBillSubscribeAsked(): boolean {
  try {
    return !!wx.getStorageSync(BILL_SUB_ASKED_KEY)
  } catch (_) {
    return false
  }
}

function markBillSubscribeAsked() {
  try {
    wx.setStorageSync(BILL_SUB_ASKED_KEY, Date.now())
  } catch (_) {}
}

function isAccepted(status: unknown): boolean {
  return (
    status === 'accept' ||
    status === 'acceptWithAudio' ||
    status === 'acceptWithAlert'
  )
}

function requestTmpl(tmplId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const api = wx.requestSubscribeMessage
    if (typeof api !== 'function') {
      resolve(false)
      return
    }
    api({
      tmplIds: [tmplId],
      success: (res) => {
        const rec = res as Record<string, unknown>
        resolve(isAccepted(rec[tmplId]))
      },
      fail: () => resolve(false),
    })
  })
}

/** 支付成功后同时问「购买成功」和「到期提醒」。返回是否同意购买成功。 */
export function requestPurchaseSubscribe(): Promise<boolean> {
  return new Promise((resolve) => {
    const api = wx.requestSubscribeMessage
    if (typeof api !== 'function') {
      resolve(false)
      return
    }
    api({
      tmplIds: [PURCHASE_SUCCESS_TMPL_ID, EXPIRE_RENEW_TMPL_ID],
      success: (res) => {
        const rec = res as Record<string, unknown>
        resolve(isAccepted(rec[PURCHASE_SUCCESS_TMPL_ID]))
      },
      fail: () => resolve(false),
    })
  })
}

/** 已开通的店主点套餐时问一次到期提醒，便于到期前收到续费通知。 */
export function requestExpireRenewSubscribe(): Promise<boolean> {
  try {
    if (wx.getStorageSync(EXPIRE_RENEW_ASKED_KEY)) return Promise.resolve(false)
  } catch (_) {}
  return requestTmpl(EXPIRE_RENEW_TMPL_ID).then((ok) => {
    try {
      wx.setStorageSync(EXPIRE_RENEW_ASKED_KEY, Date.now())
    } catch (_) {}
    return ok
  })
}

function peekNewArrivalSubscribeAsked(): boolean {
  try {
    return !!wx.getStorageSync(NEW_ARRIVAL_SUB_ASKED_KEY)
  } catch (_) {
    return false
  }
}

function markNewArrivalSubscribeAsked() {
  try {
    wx.setStorageSync(NEW_ARRIVAL_SUB_ASKED_KEY, Date.now())
  } catch (_) {}
}

function peekShipSubscribeAsked(): boolean {
  try {
    return !!wx.getStorageSync(SHIP_SUB_ASKED_KEY)
  } catch (_) {
    return false
  }
}

function markShipSubscribeAsked() {
  try {
    wx.setStorageSync(SHIP_SUB_ASKED_KEY, Date.now())
  } catch (_) {}
}

/** 代理工作台「上新 + 发货」：一次弹窗，本机各只问一次。 */
export function requestNewArrivalSubscribe(): Promise<boolean> {
  const ids: string[] = []
  const markArrival = !!(NEW_ARRIVAL_TMPL_ID && !peekNewArrivalSubscribeAsked())
  const markShip = !!(SHIP_NOTICE_TMPL_ID && !peekShipSubscribeAsked())
  if (markArrival) ids.push(NEW_ARRIVAL_TMPL_ID)
  if (markShip) ids.push(SHIP_NOTICE_TMPL_ID)
  if (!ids.length) return Promise.resolve(false)
  return new Promise((resolve) => {
    const api = wx.requestSubscribeMessage
    if (typeof api !== 'function') {
      resolve(false)
      return
    }
    api({
      tmplIds: ids,
      success: (res) => {
        if (markArrival) markNewArrivalSubscribeAsked()
        if (markShip) markShipSubscribeAsked()
        const rec = res as Record<string, unknown>
        resolve(ids.some((id) => isAccepted(rec[id])))
      },
      fail: () => {
        if (markArrival) markNewArrivalSubscribeAsked()
        if (markShip) markShipSubscribeAsked()
        resolve(false)
      },
    })
  })
}

function peekBindSubscribeAsked(): boolean {
  try {
    return !!wx.getStorageSync(BIND_SUB_ASKED_KEY)
  } catch (_) {
    return false
  }
}

function markBindSubscribeAsked() {
  try {
    wx.setStorageSync(BIND_SUB_ASKED_KEY, Date.now())
  } catch (_) {}
}

function peekOrderSubscribeAsked(): boolean {
  try {
    return !!wx.getStorageSync(ORDER_SUB_ASKED_KEY)
  } catch (_) {
    return false
  }
}

function markOrderSubscribeAsked() {
  try {
    wx.setStorageSync(ORDER_SUB_ASKED_KEY, Date.now())
  } catch (_) {}
}

function peekAgentApplyNoticeAsked(): boolean {
  try {
    return !!wx.getStorageSync(AGENT_APPLY_NOTICE_ASKED_KEY)
  } catch (_) {
    return false
  }
}

function markAgentApplyNoticeAsked() {
  try {
    wx.setStorageSync(AGENT_APPLY_NOTICE_ASKED_KEY, Date.now())
  } catch (_) {}
}

/** 商家点绑定/保存店铺时问：绑定通知 + 下单结果 + 代理申请。本机各只问一次。 */
export function requestBindSubscribe(): Promise<boolean> {
  const ids: string[] = []
  const markBind = !!(BIND_NOTICE_TMPL_ID && !peekBindSubscribeAsked())
  const markOrder = !!(ORDER_NOTICE_TMPL_ID && !peekOrderSubscribeAsked())
  const markApply = !!(AGENT_APPLY_NOTICE_TMPL_ID && !peekAgentApplyNoticeAsked())
  if (markBind) ids.push(BIND_NOTICE_TMPL_ID)
  if (markOrder) ids.push(ORDER_NOTICE_TMPL_ID)
  if (markApply) ids.push(AGENT_APPLY_NOTICE_TMPL_ID)
  if (!ids.length) return Promise.resolve(false)
  return new Promise((resolve) => {
    const api = wx.requestSubscribeMessage
    if (typeof api !== 'function') {
      resolve(false)
      return
    }
    api({
      tmplIds: ids,
      success: (res) => {
        if (markBind) markBindSubscribeAsked()
        if (markOrder) markOrderSubscribeAsked()
        if (markApply) markAgentApplyNoticeAsked()
        const rec = res as Record<string, unknown>
        resolve(ids.some((id) => isAccepted(rec[id])))
      },
      fail: () => {
        if (markBind) markBindSubscribeAsked()
        if (markOrder) markOrderSubscribeAsked()
        if (markApply) markAgentApplyNoticeAsked()
        resolve(false)
      },
    })
  })
}

/** 商家点「代理申请」时再要一次代理人申请通知额度。 */
export function requestAgentApplyNoticeSubscribe(): Promise<boolean> {
  return requestTmpl(AGENT_APPLY_NOTICE_TMPL_ID)
}

/** 代理点提交申请时要申请进度通知额度，审核后才能收到。 */
export function requestAgentApplyResultSubscribe(): Promise<boolean> {
  return requestTmpl(AGENT_APPLY_RESULT_TMPL_ID)
}

/** 代理工作台「账单通知」：本机只弹一次，允许或取消后写入缓存 */
export function requestBillSubscribe(): Promise<boolean> {
  if (peekBillSubscribeAsked()) return Promise.resolve(false)
  return new Promise((resolve) => {
    const api = wx.requestSubscribeMessage
    if (typeof api !== 'function') {
      resolve(false)
      return
    }
    api({
      tmplIds: [BILL_NOTICE_TMPL_ID],
      success: (res) => {
        markBillSubscribeAsked()
        const rec = res as Record<string, unknown>
        resolve(isAccepted(rec[BILL_NOTICE_TMPL_ID]))
      },
      fail: () => resolve(false),
    })
  })
}

/**
 * 用户同意后，让服务端下发购买成功通知。
 * @returns true=已发送或已跳过；false=可重试（如尚未发货）
 */
export async function sendPurchaseNotice(orderId?: string): Promise<boolean> {
  try {
    const res = await request<{
      sent?: boolean
      skipped?: boolean
      reason?: string
      retry?: boolean
    }>({
      path: '/api/v1/billing/subscription/send-purchase-notice',
      method: 'POST',
      data: orderId ? { orderId } : {},
      skipAuthKick: true,
    })
    if (!res.ok) return false
    if (res.data?.sent || res.data?.skipped) return true
    // 订单尚未 delivered：调用方应稍后重试
    if (res.data?.reason === 'not_delivered' || res.data?.retry) return false
    if (res.data?.reason === 'not_subscribed') return true
    return !!res.ok
  } catch (_) {
    return false
  }
}
