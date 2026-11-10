import {
  fetchOrderLookup,
  lookupSharePath,
  lookupShareTitle,
  type LookupOrder,
} from '../../services/lookup'
import {
  buildReceiptRenderModel,
  type ReceiptRenderModel,
} from '../../services/receipt-layout'
import {
  normalizeTemplateId,
  writeLookupPayQr,
  type PrintTemplateTypeId,
} from '../../services/print-template'
import { receiptFontScale } from '../../utils/receipt-render'
import type { CartItem } from '../../services/team'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import {
  courierColor,
  courierLabel,
  detectCourier,
} from '../../services/courier'

type ShipParcel = {
  no: string
  courier: string
  color: string
}

/** 已发货且有运单号时展示物流卡（有单号即展示） */
function buildShipParcels(o: LookupOrder): ShipParcel[] {
  const nos = (o.trackingNos || [])
    .map((n) => String(n || '').trim())
    .filter(Boolean)
  // 必须有单号；无单号的纯「已发货」标记不展示明细卡
  if (!nos.length) return []
  return nos.map((no) => {
    const kind = detectCourier(no)
    return {
      no,
      courier: courierLabel(kind),
      color: courierColor(kind),
    }
  })
}

/** 销售单误带的退单自动备注，公开预览不展示 */
function displayRemark(o: LookupOrder) {
  const r = String(o.remark || '').trim()
  if (!r) return ''
  if (!o.isReturn && /^【\d{4}-\d{2}-\d{2}退单】/.test(r)) return ''
  return r
}

function toCartItems(o: LookupOrder): CartItem[] {
  return (o.items || []).map((it, idx) => {
    const qty = Number(it.quantity || 0)
    const price = Number(it.price || 0)
    const sub = Number(it.subtotal != null ? it.subtotal : qty * price)
    return {
      productCode: String(it.productCode || '').trim(),
      productName: String(it.productName || it.productCode || '').trim() || `商品${idx + 1}`,
      spec: String(it.spec || '').trim(),
      unit: String(it.unit || '').trim() || '件',
      quantity: qty,
      price,
      subtotal: sub,
      countInStats: true,
    } as CartItem
  })
}

Page({
  data: {
    loading: true,
    error: '',
    shopName: '',
    orderNo: '',
    readonly: true,
    publicChain: true,
    chainId: '',
    chainIdShort: '',
    sealedAt: '',
    chainHint: '',
    signatureValid: false,
    receiptReady: false,
    receiptModel: {} as ReceiptRenderModel,
    fontScale: 1,
    shipVisible: false,
    shipParcels: [] as ShipParcel[],
    photoUrl: '',
    rejectReason: '',
    ...i18nState(),
  },

  _order: null as LookupOrder | null,
  _token: '',
  _loadedOnce: false,

  applyLocale() {
    const isReturn = !!this._order?.isReturn
    bindPageI18n(this, isReturn ? 'returnReceiptPreview' : 'exportSaleImage')
    try {
      wx.setNavigationBarTitle({
        title: isReturn ? t('returnReceiptPreview') : t('exportSaleImage'),
      })
    } catch (_) {}
  },

  onLoad(query: Record<string, string | undefined>) {
    const token = String(query.token || '').trim()
    this._token = token
    void this.load(token)
  },

  onShow() {
    this.applyLocale()
    try {
      wx.showShareMenu({ menus: ['shareAppMessage'] })
    } catch (_) {}
    try {
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        this.getTabBar().setData({ hidden: true })
      }
    } catch (_) {}
    if (this._loadedOnce && this._token) void this.load(this._token)
  },

  onShareAppMessage() {
    const token = String(this._token || '').trim()
    if (!token) {
      return { title: t('lookupTitle'), path: '/pages/home/home' }
    }
    return {
      title: lookupShareTitle(this.data.shopName, this.data.orderNo),
      path: lookupSharePath(token),
    }
  },

  onCopyTracking(e: WechatMiniprogram.TouchEvent) {
    const no = String(e.currentTarget.dataset.no || '').trim()
    if (!no) return
    wx.setClipboardData({
      data: no,
      success: () => wx.showToast({ title: '单号已复制', icon: 'none' }),
    })
  },

  onPreviewPhoto() {
    const url = String(this.data.photoUrl || '')
    if (!url) return
    wx.previewImage({ current: url, urls: [url] })
  },

  async load(token: string) {
    if (!token) {
      this.setData({ loading: false, error: '缺少查账码' })
      return
    }
    this.setData({ loading: true, error: '' })
    const res = await fetchOrderLookup(token)
    if (!res.ok || !res.data) {
      this.setData({ loading: false, error: res.error || '查账失败' })
      return
    }
    const o = res.data
    this._order = o
    const tip = String(o.orderNo || token).slice(-12)
    let wechatQr = ''
    let alipayQr = ''
    try {
      if (o.wechatQrBase64) wechatQr = writeLookupPayQr('wechat', o.wechatQrBase64, tip)
    } catch (_) {}
    try {
      if (o.alipayQrBase64) alipayQr = writeLookupPayQr('alipay', o.alipayQrBase64, tip)
    } catch (_) {}

    const isReturn = !!o.isReturn
    const showPayQr =
      !isReturn &&
      o.showPayQr !== false &&
      o.printPaymentQr !== false &&
      (!!wechatQr || !!alipayQr)

    const templateId = normalizeTemplateId(o.templateId || 'cashier') as PrintTemplateTypeId
    const shopName = String(o.headerTitle || o.shopName || '').trim() || '图可开单'
    const dateStr = String(o.createdAt || '').slice(0, 16).replace('T', ' ')
    const items = toCartItems(o)
    const receiptModel = buildReceiptRenderModel({
      templateId,
      shopName,
      isReturn,
      orderNo: String(o.orderNo || ''),
      dateStr,
      customerName: o.customerName || '',
      customerPhone: o.customerPhone || '',
      handler: '',
      items,
      totalQuantity: Number(o.totalQuantity || 0),
      totalAmount: Number(o.totalAmount || 0),
      footer: String(o.footer || '').trim(),
      showPayQr,
      wechatQr,
      alipayQr,
      qrHint: String(o.qrHint || '扫以下二维码可直接支付').trim(),
      showLookupQr: false,
      lookupQr: '',
      lookupQrHint: '',
      lookupQrUrl: '',
      showReturnQr: false,
      returnQr: '',
      returnQrHint: '',
      returnQrUrl: '',
    })

    const remark = displayRemark(o)
    if (remark) {
      const lines = [...(receiptModel.footerLines || [])]
      lines.push(`备注：${remark}`)
      receiptModel.footerLines = lines
      receiptModel.footer = lines.join('\n')
    }

    const shipParcels = buildShipParcels(o)

    this.setData({
      loading: false,
      error: o.synced === false ? o.message || '单据尚未同步云端' : '',
      shopName,
      orderNo: o.orderNo || '',
      readonly: o.readonly !== false,
      publicChain: o.publicChain !== false,
      chainId: o.chainId || '',
      chainIdShort: (o.chainId || '').slice(0, 12) + ((o.chainId || '').length > 12 ? '…' : ''),
      sealedAt: String(o.sealedAt || '').slice(0, 19).replace('T', ' '),
      chainHint: t('lookupChainHint'),
      signatureValid: o.signatureValid === true,
      receiptReady: true,
      receiptModel,
      fontScale: receiptFontScale(),
      shipVisible: shipParcels.length > 0,
      shipParcels,
      photoUrl: o.hasDeliveryPhoto ? o.photoUrl || '' : '',
      rejectReason: o.rejectReason || '',
    })
    this.applyLocale()
    this._loadedOnce = true
  },
})
