import {
  fetchStatementLookup,
  statementSharePath,
  statementShareTitle,
  type StatementLookup,
} from '../../services/lookup'
import { writeLookupPayQr } from '../../services/print-template'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { collectPayQrTargets, scanReceiptQrs } from '../../utils/qr-actions'

Page({
  data: {
    loading: true,
    error: '',
    shopName: '',
    customerName: '',
    customerPhone: '',
    rangeLabel: '',
    printTime: '',
    unpaidOnly: false,
    orders: [] as NonNullable<StatementLookup['orders']>,
    totals: {} as NonNullable<StatementLookup['totals']>,
    readonly: true,
    publicChain: true,
    chainId: '',
    chainIdShort: '',
    sealedAt: '',
    chainHint: '',
    signatureValid: false,
    showPayQr: false,
    qrHint: '',
    wechatQr: '',
    alipayQr: '',
    ...i18nState(),
  },

  _token: '',
  _loadedOnce: false,

  applyLocale() {
    bindPageI18n(this, 'statementLookupTitle')
    try {
      wx.setNavigationBarTitle({ title: t('statementLookupTitle') })
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
      return { title: t('statementLookupTitle'), path: '/pages/home/home' }
    }
    return {
      title: statementShareTitle(this.data.shopName, this.data.customerName),
      path: statementSharePath(token),
    }
  },

  async load(token: string) {
    if (!token) {
      this.setData({ loading: false, error: '缺少对账码' })
      return
    }
    this.setData({ loading: true, error: '' })
    const res = await fetchStatementLookup(token)
    if (!res.ok || !res.data) {
      this.setData({ loading: false, error: res.error || '对账失败' })
      return
    }
    const o = res.data
    const orders = (o.orders || []).map((row) => ({
      orderNo: String(row.orderNo || ''),
      orderNoLabel: String(row.orderNoLabel || (row.orderNo ? `NO.${row.orderNo}` : '')),
      createdAt: String(row.createdAt || ''),
      totalAmount: Number(row.totalAmount || 0),
      totalQuantity: Number(row.totalQuantity || 0),
      isReturn: !!row.isReturn,
      isPaid: !!row.isPaid,
      amountLabel: String(row.amountLabel || Number(row.totalAmount || 0).toFixed(2)),
      qtyLabel: String(row.qtyLabel || `${Number(row.totalQuantity || 0)}件`),
      statusLabel: String(row.statusLabel || ''),
      statusClass: String(row.statusClass || 'unpaid'),
    }))
    const tip = String(token || o.customerName || 'stmt').slice(-12)
    let wechatQr = ''
    let alipayQr = ''
    try {
      if (o.wechatQrBase64) wechatQr = writeLookupPayQr('wechat', o.wechatQrBase64, tip)
    } catch (_) {}
    try {
      if (o.alipayQrBase64) alipayQr = writeLookupPayQr('alipay', o.alipayQrBase64, tip)
    } catch (_) {}
    const showPayQr =
      o.showPayQr !== false &&
      o.printPaymentQr !== false &&
      (!!wechatQr || !!alipayQr)
    this.setData({
      loading: false,
      error: '',
      shopName: String(o.shopName || '').trim() || '图可开单',
      customerName: String(o.customerName || '').trim(),
      customerPhone: String(o.customerPhone || '').trim(),
      rangeLabel: String(o.rangeLabel || '').trim(),
      printTime: String(o.printTime || '').trim(),
      unpaidOnly: !!o.unpaidOnly,
      orders,
      totals: o.totals || {},
      readonly: o.readonly !== false,
      publicChain: o.publicChain !== false,
      chainId: o.chainId || '',
      chainIdShort: (o.chainId || '').slice(0, 12) + ((o.chainId || '').length > 12 ? '…' : ''),
      sealedAt: String(o.sealedAt || '').slice(0, 19).replace('T', ' '),
      chainHint: t('statementChainHint'),
      signatureValid: o.signatureValid === true,
      showPayQr,
      qrHint: String(o.qrHint || '扫以下二维码可直接支付').trim(),
      wechatQr,
      alipayQr,
    })
    this.applyLocale()
    this._loadedOnce = true
  },

  onScanPageQrs() {
    scanReceiptQrs(
      collectPayQrTargets({
        wechatQr: this.data.wechatQr,
        alipayQr: this.data.alipayQr,
      }),
    )
  },
})
