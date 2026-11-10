/** 小票/对账单二维码：转发、保存、扫一扫打开 */

import { t } from '../services/i18n'

export type QrKind = 'lookup' | 'arrival' | 'pay' | 'wechatPay' | 'alipayPay'

export type ReceiptQrTarget = {
  id: 'lookup' | 'wechat' | 'alipay' | 'arrival'
  label: string
  kind: QrKind
  url?: string
  src: string
}

const IMAGEOK_HOST = /^https:\/\/([\w-]+\.)?imageok\.cn(\/|$)/i

export function absHttpUrl(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return `https://${s.replace(/^\/+/, '')}`
}

export function extractArrivalToken(raw: string): string {
  const full = absHttpUrl(raw)
  const m = full.match(/\/n\/([^/?#]+)/i)
  return m ? decodeURIComponent(m[1]) : ''
}

export function ensureLocalImage(src: string): Promise<string> {
  const s = String(src || '').trim()
  if (!s) return Promise.reject(new Error('no image'))
  if (/^https?:\/\//i.test(s)) {
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: s,
        success: (r) => {
          if (r.statusCode === 200 && r.tempFilePath) resolve(r.tempFilePath)
          else reject(new Error('download fail'))
        },
        fail: reject,
      })
    })
  }
  return Promise.resolve(s)
}

export function shareQrImage(src: string) {
  void ensureLocalImage(src)
    .then((path) => {
      const fn = (wx as WechatMiniprogram.Wx & {
        showShareImageMenu?: (opt: { path: string; fail?: () => void }) => void
      }).showShareImageMenu
      if (typeof fn === 'function') {
        fn({
          path,
          fail: () => wx.previewImage({ urls: [path], current: path }),
        })
      } else {
        wx.previewImage({ urls: [path], current: path })
      }
    })
    .catch(() => wx.showToast({ title: '图片无法转发', icon: 'none' }))
}

export function saveQrImage(src: string) {
  void ensureLocalImage(src)
    .then((path) => {
      wx.saveImageToPhotosAlbum({
        filePath: path,
        success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
        fail: (e) => {
          const msg = String(e?.errMsg || '')
          if (msg.includes('auth deny') || msg.includes('authorize')) {
            wx.showModal({
              title: '需要相册权限',
              content: '请在设置中允许保存到相册',
              confirmText: '去设置',
              success: (r) => {
                if (r.confirm) wx.openSetting({})
              },
            })
          } else {
            wx.showToast({ title: '保存失败', icon: 'none' })
          }
        },
      })
    })
    .catch(() => wx.showToast({ title: '保存失败', icon: 'none' }))
}

export function collectReceiptQrTargets(model: {
  showLookupQr?: boolean
  lookupQr?: string
  lookupQrUrl?: string
  lookupQrHint?: string
  showHeaderNewArrivalQr?: boolean
  headerNewArrivalQr?: string
  headerNewArrivalUrl?: string
  showPayQr?: boolean
  wechatQr?: string
  alipayQr?: string
  showReturnQr?: boolean
  returnQr?: string
  returnQrUrl?: string
  returnQrHint?: string
}): ReceiptQrTarget[] {
  const out: ReceiptQrTarget[] = []
  if (model.showLookupQr && (model.lookupQr || model.lookupQrUrl)) {
    out.push({
      id: 'lookup',
      label: t('qrLookup'),
      kind: 'lookup',
      url: model.lookupQrUrl || '',
      src: model.lookupQr || '',
    })
  }
  if (model.showHeaderNewArrivalQr && (model.headerNewArrivalQr || model.headerNewArrivalUrl)) {
    out.push({
      id: 'arrival',
      label: t('qrArrival'),
      kind: 'arrival',
      url: model.headerNewArrivalUrl || '',
      src: model.headerNewArrivalQr || '',
    })
  }
  if (model.showPayQr && model.wechatQr) {
    out.push({
      id: 'wechat',
      label: t('qrWechatPay'),
      kind: 'wechatPay',
      src: model.wechatQr,
    })
  }
  if (model.showPayQr && model.alipayQr) {
    out.push({
      id: 'alipay',
      label: t('qrAlipayPay'),
      kind: 'alipayPay',
      src: model.alipayQr,
    })
  }
  if (model.showReturnQr && (model.returnQr || model.returnQrUrl || model.headerNewArrivalUrl)) {
    out.push({
      id: 'arrival',
      label: t('qrArrival'),
      kind: 'arrival',
      url: model.returnQrUrl || model.headerNewArrivalUrl || '',
      src: model.returnQr || '',
    })
  }
  return out
}

export function collectPayQrTargets(opts: {
  wechatQr?: string
  alipayQr?: string
}): ReceiptQrTarget[] {
  return collectReceiptQrTargets({
    showPayQr: true,
    wechatQr: opts.wechatQr || '',
    alipayQr: opts.alipayQr || '',
  })
}

/** 打开此图，交给微信识别图中二维码，由用户自己选（付款/打开网页等） */
export function recognizeQrInImage(src: string) {
  const s = String(src || '').trim()
  if (!s) {
    wx.showToast({ title: t('qrNoneOnPage'), icon: 'none' })
    return
  }
  const run = (path: string) => {
    wx.previewImage({
      urls: [path],
      current: path,
      showmenu: true,
    })
  }
  void ensureLocalImage(s)
    .then((path) => {
      // 长按菜单刚关，立刻预览可能失败
      setTimeout(() => run(path), 80)
    })
    .catch(() => wx.showToast({ title: '无法识别此码', icon: 'none' }))
}

/** @deprecated 长按已改为识别当前这张图，不再列出整页码 */
export function scanReceiptQrs(targets: ReceiptQrTarget[]) {
  const src = String(targets?.[0]?.src || '').trim()
  recognizeQrInImage(src)
}

/** 打开此码：查账进公开页，上新/官网进 web-view；收款码交给微信识别图中二维码 */
export function openQrScan(kind: QrKind, url: string, src: string) {
  if (kind === 'alipayPay' || kind === 'wechatPay' || kind === 'pay') {
    if (src) {
      recognizeQrInImage(src)
      return
    }
    wx.showToast({ title: t('wechatPayOpenFail'), icon: 'none' })
    return
  }
  if (kind === 'lookup') {
    const token = extractLookupToken(url)
    if (token) {
      wx.navigateTo({
        url: `/pages/order-lookup/order-lookup?token=${encodeURIComponent(token)}`,
      })
      return
    }
  }
  if (kind === 'arrival') {
    const token = extractArrivalToken(url)
    if (token) {
      wx.navigateTo({
        url: `/pages/agent-share/agent-share?t=${encodeURIComponent(token)}`,
      })
      return
    }
  }
  const full = absHttpUrl(url)
  if (full && IMAGEOK_HOST.test(full)) {
    wx.navigateTo({
      url: `/pages/web/web?url=${encodeURIComponent(full)}&title=${encodeURIComponent('扫一扫')}`,
    })
    return
  }
  if (full) {
    wx.setClipboardData({
      data: full,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' }),
    })
    return
  }
  wx.showToast({ title: '无法识别此码', icon: 'none' })
}
