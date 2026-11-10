import { getSession, isGuest, isLoggedIn } from '../../services/session'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { assertMediaCheckAsync, assertMsgSecCheck } from '../../services/sec-check'
import { softDeleteOrder } from '../../services/recycle-bin'
import { canEditOrder, fetchOrderByNo, fetchShop, findCachedOrder, hasOrderItems, peekCachedShop, uploadOrder } from '../../services/team'
import type { CartItem, OrderBrief, ShopInfo } from '../../services/team'
import {
  deliveryPhotoSrc,
  persistDeliveryLocalPath,
  pickDeliveryImage,
  readLocalFileBase64,
} from '../../utils/delivery-photo'
import {
  loadPrintTemplate,
  pullPrintTemplateFromCloud,
} from '../../services/print-template'
import { extraReceiptQr } from '../../services/receipt-qr'
import { agentOrderKind, confirmAgentRemark, parseAgentShip, parseRejectReason, rejectAgentPending } from '../../services/lookup'
import {
  buildReceiptRenderModel,
  estimateReceiptCanvasHeight,
  receiptPrintFlags,
  receiptShopTitle,
  type ReceiptRenderModel,
} from '../../services/receipt-layout'
import { estimateQrBlockH } from '../../utils/receipt-canvas'
import { receiptFontScale, renderReceiptCanvas } from '../../utils/receipt-render'
import { colorSizeFromItem } from '../../services/product-sku'

function formatTime(raw?: string | null): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return String(raw)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

function normalizeItems(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) return []
  const out: CartItem[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue
    const m = it as Record<string, unknown>
    const code = String(m.productCode || m.product_code || '')
    const name = String(m.productName || m.product_name || code)
    const price = Number(m.price || 0)
    const quantity = Number(m.quantity || 0)
    const subtotal = m.subtotal != null ? Number(m.subtotal) : price * quantity
    if (!code && !name) continue
    const sku = colorSizeFromItem({
      color: m.color as string,
      size: m.size as string,
      spec: m.spec as string,
    })
    out.push({
      productCode: code || name,
      productName: name || code,
      spec: sku.spec || undefined,
      color: sku.color || undefined,
      size: sku.size || undefined,
      unit: (m.unit as string) || '件',
      price,
      quantity,
      subtotal,
      countInStats: m.countInStats !== false && m.count_in_stats !== 0,
    })
  }
  return out
}

type OrderView = OrderBrief & { amountLabel: string; timeLabel: string }

type ItemView = CartItem & {
  subtotalLabel: string
  title: string
  subLine: string
}


Page({
  data: {
    order: null as OrderView | null,
    items: [] as ItemView[],
    trackingNos: [] as string[],
    deliveryPhotoPath: '',
    delivSheetVisible: false,
    shippedLabel: t('shipped'),
    ...i18nState(),
    shop: null as ShopInfo | null,
    agentPending: false,
    agentRejected: false,
    rejectReason: '',
    shipVisible: false,
    shipName: '',
    shipPhone: '',
    shipAddress: '',
    shipUrgent: false,
    shipNote: '',
    printing: false,
    error: '',
    canEditOrder: true,
    expVisible: false,
    expTitle: t('exportSaleImage'),
    expReceiptModel: {} as ReceiptRenderModel,
    expFontScale: 1,
    expSaving: false,
    expCanvasH: 600,
  },

  _orderNo: '',
  _openPrint: false,
  _items: [] as CartItem[],
  _createdAtMs: Date.now(),
  _found: null as OrderBrief | null,
  _savingFulfill: false,

  applyLocale() {
    const nos = this.data.trackingNos || []
    const isReturn = !!this.data.order?.isReturn
    bindPageI18n(this, 'orderDetail')
    this.setData({
      shippedLabel: nos.length ? `${t('shipped')}(${nos.length})` : t('shipped'),
      expTitle: isReturn ? t('exportReturnImage') : t('exportSaleImage'),
    })
  },

  onLoad(query: Record<string, string | undefined>) {
    if (!isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this._orderNo = decodeURIComponent(query.orderNo || '')
    this._openPrint = query.openPrint === '1'
    this.applyLocale()
    void this.load()
  },

  onShow() {
    this.applyLocale()
  },

  async load() {
    const shopCached = peekCachedShop()
    const cached = findCachedOrder(this._orderNo)
    if (cached) this.applyOrder(cached, shopCached)

    const needNet =
      !hasOrderItems(cached) ||
      (!!(cached as any)?.hasDeliveryPhoto &&
        !(cached as any)?.deliveryPhotoBase64 &&
        !String((cached as any)?.deliveryPhotoPath || '').trim()) ||
      !(cached as any)?.deliveryPhotoBase64
    const [shopR, oneR] = await Promise.all([
      fetchShop(),
      needNet
        ? fetchOrderByNo(this._orderNo, { includePhoto: true })
        : Promise.resolve(null as Awaited<ReturnType<typeof fetchOrderByNo>> | null),
    ])
    const shop = shopR.shop || shopCached
    let found = cached
    if (oneR && oneR.ok && oneR.order) {
      found = {
        ...oneR.order,
        deliveryPhotoBase64:
          oneR.order.deliveryPhotoBase64 || (cached as any)?.deliveryPhotoBase64,
        deliveryPhotoPath:
          oneR.order.deliveryPhotoPath || (cached as any)?.deliveryPhotoPath,
        hasDeliveryPhoto:
          !!(oneR.order as any).hasDeliveryPhoto ||
          !!(oneR.order.deliveryPhotoBase64 || (cached as any)?.deliveryPhotoBase64),
      }
    }
    if (!found) {
      this.setData({ error: t('orderNotFound'), order: null })
      return
    }
    this.applyOrder(found, shop)
    if (this._openPrint) {
      this._openPrint = false
      setTimeout(() => {
        void this.onPrint()
      }, 50)
    }
  },

  applyOrder(found: OrderBrief, shop: ShopInfo | null) {
    this._found = found
    const items = normalizeItems(found.items)
    this._items = items
    const created = found.createdAt ? new Date(found.createdAt).getTime() : Date.now()
    this._createdAtMs = Number.isFinite(created) ? created : Date.now()
    const tracking = Array.isArray((found as any).trackingNos)
      ? ((found as any).trackingNos as string[]).filter(Boolean)
      : []
    const shippedLabel = tracking.length
      ? `${t('shipped')}(${tracking.length})`
      : t('shipped')
    const photoSrc =
      deliveryPhotoSrc((found as any).deliveryPhotoPath) ||
      deliveryPhotoSrc((found as any).deliveryPhotoBase64) ||
      ''
    const ship = parseAgentShip(found.remark)
    const shipVisible = !!(ship.name || ship.phone || ship.address || ship.urgent || ship.note)
    const kind = agentOrderKind(found.remark)
    this.setData({
      shop,
      agentPending: kind === 'pending',
      agentRejected: kind === 'rejected',
      rejectReason: parseRejectReason(found.remark),
      shipVisible,
      shipName: ship.name,
      shipPhone: ship.phone,
      shipAddress: ship.address,
      shipUrgent: ship.urgent,
      shipNote: ship.note,
      order: {
        ...found,
        amountLabel: Number(found.totalAmount || 0).toFixed(2),
        timeLabel: formatTime(found.createdAt),
      },
      items: items.map((it) => {
        const title = (it.spec || '').trim()
          ? `${it.productName} ${it.spec}`
          : it.productName
        return {
          ...it,
          title,
          subLine: `货号 ${it.productCode}  /  ¥${Number(it.price || 0).toFixed(2)} × ${fmtNum(it.quantity)}`,
          subtotalLabel: Number(it.subtotal || 0).toFixed(2),
        }
      }),
      trackingNos: tracking,
      deliveryPhotoPath: photoSrc,
      shippedLabel,
      canEditOrder: canEditOrder(found),
      error: '',
    })
  },

  denyIfCannotEdit(): boolean {
    if (canEditOrder(this._found)) return false
    wx.showToast({ title: t('orderEditOwnOnly'), icon: 'none' })
    return true
  },

  async onToggleChip(e: WechatMiniprogram.TouchEvent) {
    if (this._savingFulfill) return
    const field = e.currentTarget.dataset.field as
      | 'isPaid'
      | 'isPickedUp'
      | 'isShipped'
      | 'isDelivered'
    if (field === 'isShipped') {
      this.onToggleShipped()
      return
    }
    if (field === 'isDelivered') {
      this.onToggleDelivered()
      return
    }
    if (!this.data.order || !this._found || !field) return
    const nextVal = !this._found[field]
    const next = {
      ...this._found,
      [field]: nextVal,
    } as OrderBrief
    await this.persistFulfillment(next, this.data.trackingNos || [])
  },

  onToggleShipped() {
    const found = this._found
    if (!found) return
    const nos = this.data.trackingNos || []
    if (found.isShipped && !nos.length) {
      wx.showActionSheet({
        itemList: ['录入/扫描快递单号', '取消已发货状态'],
        success: (res) => {
          if (res.tapIndex === 0) this.openTrackingScan()
          if (res.tapIndex === 1) {
            void this.persistFulfillment(
              { ...found, isShipped: false } as OrderBrief,
              [],
            )
          }
        },
      })
      return
    }
    this.openTrackingScan()
  },

  openTrackingScan() {
    const found = this._found
    if (!found) return
    const initial = (this.data.trackingNos || []).slice()
    wx.navigateTo({
      url: '/pages/tracking-scan/tracking-scan',
      events: {
        done: (data: { nos?: string[] }) => {
          const nos = Array.isArray(data?.nos)
            ? data.nos.map((n) => String(n).trim()).filter(Boolean)
            : []
          void this.persistFulfillment(
            { ...found, isShipped: true } as OrderBrief,
            nos,
          )
        },
      },
      success: (res) => {
        res.eventChannel.emit('init', { nos: initial })
      },
    })
  },

  onRemoveTracking(e: WechatMiniprogram.TouchEvent) {
    const found = this._found
    if (!found) return
    const no = String(e.currentTarget.dataset.no || '')
    const next = (this.data.trackingNos || []).filter((n) => n !== no)
    void this.persistFulfillment(
      { ...found, isShipped: next.length > 0 } as OrderBrief,
      next,
    )
  },

  onToggleDelivered() {
    this.setData({ delivSheetVisible: true })
  },

  onDelivSheetClose() {
    this.setData({ delivSheetVisible: false })
  },

  async onDelivPick(e: WechatMiniprogram.TouchEvent) {
    const found = this._found
    if (!found) return
    const action = String(e.currentTarget.dataset.action || '')
    if (action === 'clear') {
      this.setData({ delivSheetVisible: false, deliveryPhotoPath: '' })
      await this.persistFulfillment(
        { ...found, isDelivered: false } as OrderBrief,
        this.data.trackingNos || [],
        { clearDeliveryPhoto: true },
      )
      return
    }
    if (action !== 'camera' && action !== 'album') return
    this.setData({ delivSheetVisible: false })
    try {
      const temp = await pickDeliveryImage(action)
      if (!(await assertMediaCheckAsync({ filePath: temp, mediaType: 2 }))) return
      const local = persistDeliveryLocalPath(temp)
      const b64 = readLocalFileBase64(local)
      if (!b64) {
        wx.showToast({ title: '读取图片失败', icon: 'none' })
        return
      }
      this.setData({ deliveryPhotoPath: local })
      await this.persistFulfillment(
        { ...found, isDelivered: true } as OrderBrief,
        this.data.trackingNos || [],
        { deliveryPhotoBase64: b64 },
      )
    } catch (err: any) {
      if (String(err?.message || err) === 'cancel') return
      wx.showToast({
        title: String(err?.message || '选择图片失败').slice(0, 40),
        icon: 'none',
      })
    }
  },

  onPreviewDeliveryPhoto() {
    const path = this.data.deliveryPhotoPath
    if (!path) return
    wx.previewImage({ urls: [path], current: path })
  },

  async onConfirmAgent() {
    const found = this._found
    if (!found || agentOrderKind(found.remark) !== 'pending') return
    const next = { ...found, remark: confirmAgentRemark(found.remark) }
    await this.persistFulfillment(next, this.data.trackingNos)
  },

  async onRejectAgent() {
    const found = this._found
    if (!found || agentOrderKind(found.remark) !== 'pending') return
    const reason = await new Promise<string>((resolve) => {
      wx.showModal({
        title: t('rejectPending'),
        editable: true,
        placeholderText: t('rejectReason'),
        success: (r) => resolve(r.confirm ? String(r.content || '').trim() : ''),
        fail: () => resolve(''),
      })
    })
    if (!reason) return
    if (!(await assertMsgSecCheck([reason]))) return
    wx.showLoading({ title: t('loading'), mask: true })
    const r = await rejectAgentPending(found.orderNo, reason)
    wx.hideLoading()
    if (!r.ok) {
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    const next = { ...found, remark: `代理打回 ${reason}` }
    const saved = await this.persistFulfillment(next, this.data.trackingNos, { silent: true })
    if (saved) wx.showToast({ title: t('rejectOk'), icon: 'none' })
  },

  async onQty(e: WechatMiniprogram.TouchEvent) {
    if (this.denyIfCannotEdit()) return
    const i = Number(e.currentTarget.dataset.i || -1)
    const d = Number(e.currentTarget.dataset.d || 0)
    const found = this._found
    if (!found || i < 0 || !this._items[i] || agentOrderKind(found.remark) !== 'pending') return
    const qty = Math.max(1, Math.min(999, Number(this._items[i].quantity || 0) + d))
    this._items[i] = {
      ...this._items[i],
      quantity: qty,
      subtotal: Number(this._items[i].price || 0) * qty,
    }
    const totalQty = this._items.reduce((s, x) => s + Number(x.quantity || 0), 0)
    const totalAmt = this._items.reduce((s, x) => s + Number(x.subtotal || 0), 0)
    const next = {
      ...found,
      items: this._items,
      totalQuantity: totalQty,
      totalAmount: Math.round(totalAmt * 100) / 100,
    }
    await this.persistFulfillment(next, this.data.trackingNos, { silent: true })
  },

  async persistFulfillment(
    next: OrderBrief,
    trackingNos: string[],
    photo?: { deliveryPhotoBase64?: string; clearDeliveryPhoto?: boolean; silent?: boolean },
  ) {
    if (this.denyIfCannotEdit()) return false
    if (this._savingFulfill) return false
    const withTrk = {
      ...next,
      trackingNos,
      deliveryPhotoPath: photo?.clearDeliveryPhoto
        ? ''
        : this.data.deliveryPhotoPath || (next as any).deliveryPhotoPath,
    } as OrderBrief
    this.applyOrder(withTrk, this.data.shop)
    if (
      !(await assertMsgSecCheck([
        next.customerName,
        next.customerPhone,
        next.remark,
        ...trackingNos,
      ]))
    ) {
      return false
    }
    this._savingFulfill = true
    const r = await uploadOrder({
      orderNo: next.orderNo,
      customerName: next.customerName || undefined,
      customerPhone: next.customerPhone || undefined,
      customerId: (next as any).customerId || (next as any).customerUid || undefined,
      remark: next.remark || undefined,
      totalAmount: Number(next.totalAmount || 0),
      totalQuantity: Number(next.totalQuantity || 0),
      items: this._items,
      createdAt: next.createdAt || undefined,
      isReturn: !!next.isReturn,
      returnReason: (next as any).returnReason || undefined,
      isPaid: !!next.isPaid,
      isPickedUp: !!next.isPickedUp,
      isShipped: !!next.isShipped,
      isDelivered: !!next.isDelivered,
      trackingNos,
      deliveryPhotoBase64: photo?.deliveryPhotoBase64,
      clearDeliveryPhoto: !!photo?.clearDeliveryPhoto,
      deliveryPhotoPath: withTrk.deliveryPhotoPath || this.data.deliveryPhotoPath || undefined,
    })
    this._savingFulfill = false
    if (!r.ok) {
      wx.showToast({ title: r.error || '同步失败', icon: 'none' })
      return false
    }
    if (!photo?.silent) {
      wx.showToast({ title: '履约状态已更新', icon: 'success', duration: 800 })
    }
    return true
  },

  onDelete() {
    if (this.denyIfCannotEdit()) return
    wx.showModal({
      title: '删除账单',
      content: '确定删除此账单？将移入回收站。',
      confirmColor: '#e53935',
      success: async (res) => {
        if (!res.confirm) return
        const found = this._found
        if (!found) {
          wx.showToast({ title: '账单不存在', icon: 'none' })
          return
        }
        const r = await softDeleteOrder({ ...found, items: this._items })
        if (!r.ok) {
          wx.showToast({ title: r.error || '失败', icon: 'none' })
          return
        }
        wx.navigateBack()
        wx.showToast({
          title: r.cloudError ? `已移入回收站；云端：${r.cloudError}` : '已移入回收站',
          icon: 'none',
        })
      },
    })
  },

  onLoadToHome() {
    const found = this._found
    if (!found) return
    if (this.denyIfCannotEdit()) return
    const d = found.createdAt ? new Date(found.createdAt) : new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const dateStr = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    wx.setStorageSync('tuk_pending_sheet', {
      orderNo: found.orderNo,
      createdAt: found.createdAt || '',
      customerName: found.customerName || '',
      customerPhone: found.customerPhone || '',
      customerId: (found as any).customerId || (found as any).customerUid || '',
      remark: found.remark || '',
      dateStr,
      isReturn: !!found.isReturn,
      returnReason: (found as any).returnReason || '',
      isPaid: !!found.isPaid,
      isPickedUp: !!found.isPickedUp,
      isShipped: !!found.isShipped,
      isDelivered: !!found.isDelivered,
      trackingNos: Array.isArray((found as any).trackingNos)
        ? (found as any).trackingNos
        : [],
      items: this._items,
    })
    // 先立刻切页，避免 toast / setData 抢在前面造成延迟
    wx.switchTab({ url: '/pages/home/home' })
    wx.showToast({
      title: '已在首页加载；更换客户后保存/打印将另存为新单',
      icon: 'none',
      duration: 2500,
    })
  },

  async onDownload() {
    const order = this.data.order
    if (!order || !this._items.length) {
      wx.showToast({ title: '当前无内容可导出', icon: 'none' })
      return
    }
    const session = getSession()
    const handler =
      (session?.team?.displayName || '').trim() || (session?.phone || '').trim()
    const isReturn = !!order.isReturn

    let tpl = loadPrintTemplate()
    try {
      const pulled = await pullPrintTemplateFromCloud()
      if (pulled.ok && pulled.applied) tpl = pulled.template
      else tpl = loadPrintTemplate()
    } catch (_) {
      tpl = loadPrintTemplate()
    }

    const qr = await extraReceiptQr(tpl, order.orderNo, isReturn, this.data.shop)
    const printFlags = receiptPrintFlags(order.customerName, isReturn)

    const shopName = receiptShopTitle(
      this.data.shop?.shopName,
      tpl.headerTitle,
      isGuest() || !isLoggedIn(),
    )
    const receiptModel = buildReceiptRenderModel({
      templateId: tpl.template,
      shopName,
      isReturn,
      orderNo: order.orderNo,
      dateStr: order.timeLabel.slice(0, 10) || order.timeLabel,
      customerName: order.customerName || '',
      customerPhone: order.customerPhone || '',
      handler,
      items: this._items,
      totalQuantity: order.totalQuantity || 0,
      totalAmount: Number(order.totalAmount || 0),
      footer: (tpl.footerText || this.data.shop?.footer || '').trim(),
      shopAddress: String(this.data.shop?.address || '').trim(),
      shopPhone: String(this.data.shop?.phone || '').trim(),
      ...qr,
      ...printFlags,
    })
    const qrBlockH = estimateQrBlockH(receiptModel)
    const canvasH = estimateReceiptCanvasHeight(receiptModel.templateId, this._items.length, qrBlockH, this._items)

    this.setData({
      expVisible: true,
      expTitle: isReturn ? t('exportReturnImage') : t('exportSaleImage'),
      expReceiptModel: receiptModel,
      expFontScale: receiptFontScale(),
      expSaving: false,
      expCanvasH: Math.max(560, canvasH),
    })
  },

  noop() {},

  onExportClose() {
    if (this.data.expSaving) return
    this.setData({ expVisible: false })
  },

  async onExportSave() {
    if (this.data.expSaving) return
    this.setData({ expSaving: true })
    try {
      await this.ensureAlbumAuth()
      const path = await this.renderExportCanvas()
      await new Promise<void>((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: path,
          success: () => resolve(),
          fail: (err) => reject(err),
        })
      })
      this.setData({ expVisible: false, expSaving: false })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (e: any) {
      this.setData({ expSaving: false })
      const msg = String(e?.errMsg || e?.message || e || '保存失败')
      if (msg.includes('auth deny') || msg.includes('authorize')) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许保存到相册',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) wx.openSetting({})
          },
        })
      } else {
        wx.showToast({ title: `保存失败: ${msg}`, icon: 'none' })
      }
    }
  },

  ensureAlbumAuth(): Promise<void> {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (s) => {
          if (s.authSetting['scope.writePhotosAlbum']) {
            resolve()
            return
          }
          wx.authorize({
            scope: 'scope.writePhotosAlbum',
            success: () => resolve(),
            fail: () => reject(new Error('authorize deny')),
          })
        },
        fail: reject,
      })
    })
  },

  renderExportCanvas(): Promise<string> {
    const model = this.data.expReceiptModel as ReceiptRenderModel
    if (!model?.layoutKind) return Promise.reject(new Error('预览数据未就绪'))
    return renderReceiptCanvas(this, model, { canvasH: this.data.expCanvasH }).then((r) => r.path)
  },

  async onPrint() {
    if (this.data.printing || !this.data.order) return
    const order = this.data.order
    const items = this._items || []
    if (!items.length) {
      wx.showToast({ title: '无明细可打印', icon: 'none' })
      return
    }
    // 对齐 App：先票据预览，再在预览页检查蓝牙（重打不落单）
    const dateStr =
      (order.timeLabel || '').slice(0, 10) ||
      String(order.createdAt || '').slice(0, 10)
    const draft = {
      asReturn: !!order.isReturn,
      orderNo: order.orderNo,
      customerName: order.customerName || '',
      customerPhone: order.customerPhone || '',
      customerId:
        (order as any).customerId || (order as any).customerUid || undefined,
      remark: order.remark || '',
      dateStr,
      items,
      totalAmount: Number(order.totalAmount || 0),
      totalQuantity: Number(order.totalQuantity || 0),
      isPaid: !!order.isPaid,
      isPickedUp: !!order.isPickedUp,
      isShipped: !!order.isShipped,
      isDelivered: !!order.isDelivered,
      trackingNos: this.data.trackingNos || [],
      returnReason: (order as any).returnReason || undefined,
      shop: this.data.shop,
    }
    wx.navigateTo({
      url: '/pages/receipt-preview/receipt-preview',
      success: (res) => {
        res.eventChannel.emit('init', { draft, reprintOnly: true })
      },
      fail: () => {
        wx.showToast({ title: '打开票据预览失败', icon: 'none' })
      },
    })
  },
})
