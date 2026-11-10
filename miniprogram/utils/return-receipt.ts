/** 退单导出/打印与 App 对齐的固定文案与资源 */



import type { PrintTemplate } from '../services/print-template'
import { fetchNewArrivalLink } from '../services/lookup'
import { isGuest, isLoggedIn } from '../services/session'
import { ensureArrivalQrImage } from './arrival-qr'



export const RETURN_ORDER_MARK = '【退单】'

/** 退单抬头：【退单】单独一行，店名在下方 */
export function formatReturnShopTitle(shopName?: string): string {
  const name = String(shopName || '图可开单').trim() || '图可开单'
  return `${RETURN_ORDER_MARK}\n${name}`
}

export const RETURN_RECEIPT_QR_HINT = '查看最新款发布'

export const DEFAULT_NEW_ARRIVAL_URL = 'https://imageok.cn'

/** 票头右侧新款码下方文字 */
export const HEADER_ARRIVAL_CAPTION = '查看新款'

/** 新款码下方文字固定为「查看新款」 */
export function arrivalQrCaption(_raw?: string): string {
  return HEADER_ARRIVAL_CAPTION
}

/** 导出/打印画布二维码边长（CSS 像素） */

export const RECEIPT_QR_CANVAS_SIZE = 108

/** 票头角码打印边长：1.2cm @ 203dpi = 96 点 */
export const RECEIPT_HEADER_QR_PRINT_DOTS = 96

/** 按纸宽把 1.2cm 换算成画布 CSS 像素（画布宽 360，打印时再放大到纸宽点数） */
export function receiptHeaderQrCssSize(cssW: number, paperDots: number): number {
  const w = Math.max(1, cssW)
  const dots = Math.max(1, paperDots)
  return Math.max(32, Math.round((RECEIPT_HEADER_QR_PRINT_DOTS * w) / dots))
}

export const RECEIPT_QR_BLOCK_H_RETURN = 250

export const RECEIPT_QR_BLOCK_H_PAY = 230

/** 查账码改到票头后，只需额外抬高抬头区域 */
export const RECEIPT_QR_BLOCK_H_LOOKUP = 100



function normalizeArrivalUrl(raw?: string): string {

  const s = String(raw || '').trim()

  if (!s) return ''

  if (/^https?:\/\//i.test(s)) return s

  return `https://${s.replace(/^\/+/, '')}`

}



/** 小票上展示的网址（去掉协议头）；留空则不显示 */

export function formatArrivalDisplayUrl(url: string): string {

  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '')

}



export function isDefaultArrivalUrl(raw?: string): boolean {
  const s = String(raw || '').trim().replace(/\/+$/, '').toLowerCase()
  return !s || s === 'https://imageok.cn' || s === 'http://imageok.cn' || s === 'imageok.cn'
}

/** 二维码实际编码的跳转地址：商家主页留空时仍默认 imageok.cn */

export function resolveArrivalEncodeUrl(raw?: string): string {

  const s = String(raw || '').trim()

  if (!s) return DEFAULT_NEW_ARRIVAL_URL

  return normalizeArrivalUrl(s)

}



/** 按打印模版解析退单「新款发布」二维码展示 */

export function resolveNewArrivalQr(tpl: PrintTemplate | null | undefined): {

  visible: boolean

  hint: string

  encodeUrl: string

  displayUrl: string

  qrPath: string

} {

  const visible = tpl ? tpl.printNewArrivalQr !== false : true

  const hint = arrivalQrCaption(tpl?.newArrivalQrHintText)

  const urlRaw = (tpl?.newArrivalQrUrl || '').trim()

  const encodeUrl = resolveArrivalEncodeUrl(urlRaw)

  const displayUrl = urlRaw ? formatArrivalDisplayUrl(encodeUrl) : ''

  return {

    visible,

    hint,

    encodeUrl,

    displayUrl,

    qrPath: '',

  }

}



/** 解析并生成二维码图片（按 encodeUrl 动态绘制，非静态 wsy 图） */

export async function resolveNewArrivalQrWithImage(

  tpl: PrintTemplate | null | undefined,

): Promise<{

  visible: boolean

  hint: string

  encodeUrl: string

  displayUrl: string

  qrPath: string

}> {

  const base = resolveNewArrivalQr(tpl)

  if (!base.visible) return base
  let encodeUrl = base.encodeUrl
  let displayUrl = base.displayUrl
  if (isLoggedIn() && !isGuest()) {
    try {
      const link = await fetchNewArrivalLink()
      if (link.ok && link.url) {
        encodeUrl = link.url
        displayUrl = formatArrivalDisplayUrl(encodeUrl)
      }
    } catch (_) {}
  }
  if (!encodeUrl) return base

  try {

    const qrPath = await ensureArrivalQrImage(encodeUrl)

    return { ...base, encodeUrl, displayUrl, qrPath }

  } catch (_) {

    return { ...base, encodeUrl, displayUrl }

  }

}


