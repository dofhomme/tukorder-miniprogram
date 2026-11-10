import { getSession, isGuest, isLoggedIn } from '../../services/session'
import { i18nState, t } from '../../services/i18n'
import { assertMediaCheckAsync, assertMsgSecCheck } from '../../services/sec-check'
import { softDeleteOrder } from '../../services/recycle-bin'
import {
  canEditOrder,
  fetchOrderByNo,
  fetchShop,
  hasOrderItems,
  peekCachedOrders,
  peekCachedShop,
  uploadOrder,
} from '../../services/team'
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
  const s = String(raw).trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
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


Component({
  data: {
    visible: false,
    loading: false,
    refreshing: false,
    order: null as OrderView | null,
    items: [] as ItemView[],
    trackingNos: [] as string[],
    deliveryPhotoPath: '',
    delivSheetVisible: false,
    shippedLabel: t('shipped'),
    ...i18nState(),
    shop: null as ShopInfo | null,
    printing: false,
    error: '',
    canEditOrder: true,
    expVisible: false,
    expTitle: '导出销售单图片',
    expReceiptModel: {} as ReceiptRenderModel,
    expFontScale: 1,
    expSaving: false,
    expCanvasH: 600,
  },

  lifetimes: {
    attached() {
      ;(this as any)._orderNo = ''
      ;(this as any)._items = [] as CartItem[]
      ;(this as any)._createdAtMs = Date.now()
      ;(this as any)._found = null as OrderBrief | null
      ;(this as any)._savingFulfill = false
      ;(this as any)._loadSeq = 0
    },
  },

  methods: {
    applyLocale() {
      const nos = this.data.trackingNos || []
      this.setData({
        ...i18nState(),
        shippedLabel: nos.length ? `${t('shipped')}(${nos.length})` : t('shipped'),
      })
    },

    /** 由订单列表立刻打开弹出层；seed 来自列表内存，避免先清空再等网络 */
    open(orderNo: string, seed?: OrderBrief | null) {
      const no = String(orderNo || '').trim()
      if (!no) return
      this.applyLocale()
      ;(this as any)._orderNo = no
      const seq = ((this as any)._loadSeq as number) + 1
      ;(this as any)._loadSeq = seq

      const fromSeed =
        seed && String(seed.orderNo || '') === no ? seed : null
      const fromPeek = peekCachedOrders().find((o) => o.orderNo === no) || null
      const fromCache = hasOrderItems(fromSeed)
        ? fromSeed
        : hasOrderItems(fromPeek)
          ? fromPeek
          : fromSeed || fromPeek
      const shop = peekCachedShop()
      const hasDetail = hasOrderItems(fromCache)

      if (fromCache) {
        this.applyOrder(fromCache, shop)
        this.setData({
          visible: true,
          loading: !hasDetail,
          refreshing: false,
          error: '',
          delivSheetVisible: false,
          expVisible: false,
        })
      } else {
        this.setData({
          visible: true,
          loading: true,
          refreshing: false,
          error: '',
          order: null,
          items: [],
          trackingNos: [],
          deliveryPhotoPath: '',
          delivSheetVisible: false,
          expVisible: false,
        })
      }
      this.triggerEvent('open')
      void this.load(seq)
    },

    close() {
      if (!this.data.visible) return
      ;(this as any)._loadSeq = ((this as any)._loadSeq as number) + 1
      this.setData({
        visible: false,
        expVisible: false,
        printing: false,
        refreshing: false,
      })
      this.triggerEvent('close')
    },

    onMaskClose() {
      if (this.data.expVisible || this.data.printing) return
      this.close()
    },

    noop() {},

    async load(seq?: number) {
      const my = seq != null ? seq : ++(this as any)._loadSeq
      const orderNo = String((this as any)._orderNo || '')
      if (!orderNo) return

      let found = (this as any)._found as OrderBrief | null
      const cached = peekCachedOrders().find((o) => o.orderNo === orderNo) || null
      if (!hasOrderItems(found) && hasOrderItems(cached)) {
        found = cached
      } else if (!found || found.orderNo !== orderNo) {
        found = cached
      }

      const needOrders = !hasOrderItems(found)
      const needPhoto =
        !!(found as any)?.hasDeliveryPhoto &&
        !(found as any)?.deliveryPhotoBase64 &&
        !String((found as any)?.deliveryPhotoPath || '').trim()
      const shopCached = peekCachedShop() || this.data.shop

      // 有明细时先落屏，店信息 / 必要时全量订单并行补齐，避免串行等 fetchShop
      if (hasOrderItems(found) && my === (this as any)._loadSeq) {
        this.applyOrder(found!, shopCached)
        this.setData({ loading: false })
      }

      const [shopR, oneR] = await Promise.all([
        fetchShop(),
        needOrders || needPhoto || !(found as any)?.deliveryPhotoBase64
          ? fetchOrderByNo(orderNo, { includePhoto: true })
          : Promise.resolve(null as Awaited<ReturnType<typeof fetchOrderByNo>> | null),
      ])
      if (my !== (this as any)._loadSeq) return

      if (oneR && oneR.ok && oneR.order) {
        // 保留刚拉到的送货照（缓存会剥 base64，展示用返回对象）
        found = {
          ...oneR.order,
          deliveryPhotoBase64:
            oneR.order.deliveryPhotoBase64 || (found as any)?.deliveryPhotoBase64,
          deliveryPhotoPath:
            oneR.order.deliveryPhotoPath || (found as any)?.deliveryPhotoPath,
          hasDeliveryPhoto:
            !!(oneR.order as any).hasDeliveryPhoto ||
            !!(oneR.order.deliveryPhotoBase64 || (found as any)?.deliveryPhotoBase64),
        }
      }

      if (!found) {
        this.setData({ loading: false, error: '未找到该账单', order: null })
        return
      }
      this.applyOrder(found, shopR.shop || shopCached)
      this.setData({ loading: false })
    },

    /** 总价旁宝石图标：立刻拉云端覆盖本机，不重试等待、不先清空界面 */
    async onRefreshFromCloud() {
      if (this.data.refreshing) return
      const orderNo = String(
        (this as any)._orderNo || this.data.order?.orderNo || '',
      ).trim()
      if (!orderNo) return
      const seq = ((this as any)._loadSeq as number) + 1
      ;(this as any)._loadSeq = seq
      this.setData({ refreshing: true })
      try {
        const oneR = await fetchOrderByNo(orderNo, {
          includePhoto: true,
          fresh: true,
        })
        if (seq !== (this as any)._loadSeq) return
        if (!oneR.ok || !oneR.order) {
          wx.showToast({
            title: oneR.error || t('cloudAlignFail'),
            icon: 'none',
          })
          return
        }
        this.applyOrder(oneR.order, this.data.shop || peekCachedShop())
        this.triggerEvent('updated', { order: oneR.order, fromCloud: true })
        wx.showToast({ title: t('cloudAligned'), icon: 'success', duration: 800 })
      } catch (_) {
        wx.showToast({ title: t('cloudAlignFail'), icon: 'none' })
      } finally {
        if (seq === (this as any)._loadSeq) {
          this.setData({ refreshing: false })
        }
      }
    },

    applyOrder(found: OrderBrief, shop: ShopInfo | null) {
      ;(this as any)._found = found
      const items = normalizeItems(found.items)
      ;(this as any)._items = items
      const created = found.createdAt ? new Date(found.createdAt).getTime() : Date.now()
      ;(this as any)._createdAtMs = Number.isFinite(created) ? created : Date.now()
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
      this.setData({
        shop,
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
      const found = (this as any)._found as OrderBrief | null
      if (canEditOrder(found)) return false
      wx.showToast({ title: t('orderEditOwnOnly'), icon: 'none' })
      return true
    },

    async onToggleChip(e: WechatMiniprogram.TouchEvent) {
      if ((this as any)._savingFulfill) return
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
      const order = this.data.order
      const found = (this as any)._found as OrderBrief | null
      if (!order || !found || !field) return
      const nextVal = !found[field]
      const next = {
        ...found,
        [field]: nextVal,
      } as OrderBrief
      await this.persistFulfillment(next, this.data.trackingNos || [])
    },

    /** 对齐 App：点已发货 → 录入/扫描运单号 */
    onToggleShipped() {
      const found = (this as any)._found as OrderBrief | null
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
      const found = (this as any)._found as OrderBrief | null
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
      const found = (this as any)._found as OrderBrief | null
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
      const found = (this as any)._found as OrderBrief | null
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

    async persistFulfillment(
      next: OrderBrief,
      trackingNos: string[],
      photo?: { deliveryPhotoBase64?: string; clearDeliveryPhoto?: boolean },
    ) {
      if (this.denyIfCannotEdit()) return
      if ((this as any)._savingFulfill) return
      const withTrk = {
        ...next,
        trackingNos,
        deliveryPhotoPath: photo?.clearDeliveryPhoto
          ? ''
          : this.data.deliveryPhotoPath || (next as any).deliveryPhotoPath,
      } as OrderBrief
      ;(this as any)._found = withTrk
      this.applyOrder(withTrk, this.data.shop)
      if (
        !(await assertMsgSecCheck([
          next.customerName,
          next.customerPhone,
          next.remark,
          ...trackingNos,
        ]))
      ) {
        return
      }
      ;(this as any)._savingFulfill = true
      const r = await uploadOrder({
        orderNo: next.orderNo,
        customerName: next.customerName || undefined,
        customerPhone: next.customerPhone || undefined,
        customerId: (next as any).customerId || (next as any).customerUid || undefined,
        remark: next.remark || undefined,
        totalAmount: Number(next.totalAmount || 0),
        totalQuantity: Number(next.totalQuantity || 0),
        items: (this as any)._items,
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
      ;(this as any)._savingFulfill = false
      if (!r.ok) {
        wx.showToast({ title: r.error || '同步失败', icon: 'none' })
        return
      }
      this.triggerEvent('updated', { order: withTrk })
      wx.showToast({ title: '履约状态已更新', icon: 'success', duration: 800 })
    },

    onDelete() {
      if (this.denyIfCannotEdit()) return
      wx.showModal({
        title: '删除账单',
        content: '确定删除此账单？将移入回收站。',
        confirmColor: '#e53935',
        success: async (res) => {
          if (!res.confirm) return
          const found = (this as any)._found as OrderBrief | null
          if (!found) {
            wx.showToast({ title: '账单不存在', icon: 'none' })
            return
          }
          const r = await softDeleteOrder({
            ...found,
            items: (this as any)._items || found.items || [],
          })
          if (!r.ok) {
            wx.showToast({ title: r.error || '失败', icon: 'none' })
            return
          }
          this.close()
          this.triggerEvent('deleted')
          wx.showToast({
            title: r.cloudError ? `已移入回收站；云端：${r.cloudError}` : '已移入回收站',
            icon: 'none',
          })
        },
      })
    },

    onLoadToHome() {
      const found = (this as any)._found as OrderBrief | null
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
        items: (this as any)._items,
      })
      this.close()
      wx.switchTab({ url: '/pages/home/home' })
      wx.showToast({
        title: '已在首页加载；更换客户后保存/打印将另存为新单',
        icon: 'none',
        duration: 2500,
      })
    },

    async onDownload() {
      const order = this.data.order
      const items = (this as any)._items as CartItem[]
      if (!order || !items.length) {
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
        items,
        totalQuantity: order.totalQuantity || 0,
        totalAmount: Number(order.totalAmount || 0),
        footer: (tpl.footerText || this.data.shop?.footer || '').trim(),
        shopAddress: String(this.data.shop?.address || '').trim(),
        shopPhone: String(this.data.shop?.phone || '').trim(),
        ...qr,
        ...printFlags,
      })
      const qrBlockH = estimateQrBlockH(receiptModel)
      const canvasH = estimateReceiptCanvasHeight(receiptModel.templateId, items.length, qrBlockH, items)

      this.setData({
        expVisible: true,
        expTitle: isReturn ? '导出退货单图片' : '导出销售单图片',
        expReceiptModel: receiptModel,
        expFontScale: receiptFontScale(),
        expSaving: false,
        expCanvasH: Math.max(560, canvasH),
      })
    },

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
      const items = ((this as any)._items || []) as CartItem[]
      if (!items.length) {
        wx.showToast({ title: '无明细可打印', icon: 'none' })
        return
      }
      // 对齐 App：先打开票据预览，再在预览页检查蓝牙（reprintOnly 不落单）
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
          res.eventChannel.emit('init', {
            draft,
            reprintOnly: true,
          })
        },
        fail: () => {
          wx.showToast({ title: '打开票据预览失败', icon: 'none' })
        },
      })
    },
  },
})
