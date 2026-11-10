/** 微信 / 支付宝收款码：生成可支付二维码（对齐 App PaymentQrService） */

import { renderQrPngBase64 } from './arrival-qr'

export function isWeChatPayload(raw: string): boolean {
  const s = String(raw || '').toLowerCase()
  return (
    s.includes('wxp://') ||
    s.includes('wx.tenpay.com') ||
    s.includes('weixin://') ||
    s.includes('payapp.wechat') ||
    s.includes('u.wechat.com')
  )
}

export function isAlipayPayload(raw: string): boolean {
  const s = String(raw || '').toLowerCase()
  return (
    s.includes('qr.alipay.com') ||
    s.includes('alipay.com') ||
    s.includes('alipays://') ||
    s.includes('render.alipay.com')
  )
}

export function looksLikePaymentPayload(raw: string): boolean {
  const t = String(raw || '').trim()
  if (!t) return false
  return isWeChatPayload(t) || isAlipayPayload(t)
}

/** 校验扫码内容与目标渠道是否匹配；返回 null 表示通过 */
export function validateForChannel(payload: string, wechat: boolean): string | null {
  const t = String(payload || '').trim()
  if (!t) return '未识别到收款码内容'
  if (!looksLikePaymentPayload(t)) {
    return '请扫描微信或支付宝个人/商家收款码'
  }
  if (wechat && isAlipayPayload(t) && !isWeChatPayload(t)) {
    return '当前为支付宝收款码，请扫描微信收款码'
  }
  if (!wechat && isWeChatPayload(t) && !isAlipayPayload(t)) {
    return '当前为微信收款码，请扫描支付宝收款码'
  }
  return null
}

/** 从收款码文本生成 PNG base64（无 data: 前缀） */
export function generatePaymentQrBase64(payload: string): string {
  return renderQrPngBase64(payload)
}
