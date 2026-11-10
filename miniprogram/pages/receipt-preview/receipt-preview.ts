import { pickOnlineGateway, pollPrintJob, submitPrintJob } from '../../services/cloud-print'
import {
  getSavedPrinter,
  isLanPagePrinter,
  localPrintFailTitle,
  refreshBleStatus,
  tryBlePrintOrExplain,
  writeBytes,
} from '../../services/bluetooth'
import { isLanPrinterId, lanHostFromId, printLanPage } from '../../services/lan-printer'
import { shouldUseRasterPrint } from '../../services/print-settings'
import {
  buildReceiptRenderModel,
  estimateReceiptCanvasHeight,
  receiptPrintFlags,
  receiptShopTitle,
  type ReceiptRenderModel,
} from '../../services/receipt-layout'
import {
  loadPrintTemplate,
  pullPrintTemplateFromCloud,
  templateLabel,
  type PrintTemplate,
  type PrintTemplateTypeId,
} from '../../services/print-template'
import { extraReceiptQr } from '../../services/receipt-qr'
import { takeReceiptPreview } from '../../services/receipt-preview-bridge'
import { estimateQrBlockH } from '../../utils/receipt-canvas'
import { buildRasterPrintBytes, receiptFontScale, renderReceiptCanvas } from '../../utils/receipt-render'
import { getSession, isGuest, isLoggedIn } from '../../services/session'
import { lookupSharePath, lookupShareTitle, mintLookupShare } from '../../services/lookup'
import { isCloudSyncAllowed } from '../../services/subscription'
import { showBluetoothSetupDialog } from './bt-dialog'
import { applyCapsuleStyle, capsuleStyleDefaults } from '../../utils/nav'
import { uploadOrder } from '../../services/team'
import type { CartItem, ShopInfo } from '../../services/team'
import { applyAutoStockForOrder, hasAutoStockForOrderNo } from '../../services/stock-order'
import { combineDateStrWithNow } from '../../utils/util'
import { readLocalFileBase64 } from '../../utils/delivery-photo'
import { bindPageI18n, i18nState, t, uiTemplateLabel } from '../../services/i18n'

export type ReceiptPrintDraft = {
  asReturn: boolean
  orderNo: string
  createdAt?: string
  customerName: string
  customerPhone: string
  customerId?: string
  remark: string
  dateStr: string
  items: CartItem[]
  totalAmount: number
  totalQuantity: number
  isPaid?: boolean
  isPickedUp?: boolean
  isShipped?: boolean
  isDelivered?: boolean
  trackingNos?: string[]
  returnReason?: string
  returnForDate?: string
  deliveryPhotoPath?: string
  shop: ShopInfo | null
  /** 首页序号列：收起则小票不印货号前编号 */
  showLineNumber?: boolean
  /** 模板页预览：只打样张，不落单 */
  templateSample?: boolean
}

type ViewItem = {
  code: string
  name: string
  qtyLabel: string
  priceLabel: string
  subLabel: string
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

Page({
  data: {
    ...capsuleStyleDefaults(),
    ready: false,
    loading: true,
    busy: false,
    printing: false,
    btConnected: false,
    linkWifi: false,
    btConnecting: false,
    btLabel: t('tapConnect'),
    navTitle: t('receiptPreview'),
    templateLabel: '收银小票',
    templateId: 'cashier' as PrintTemplateTypeId,
    receiptModel: {} as ReceiptRenderModel,
    fontScale: 1,
    canvasH: 600,
    shareReady: false,
    shareToken: '',
    shareImage: '',
    cloudPrintVisible: false,
    templateSample: false,
    ...i18nState(),
  },

  applyLocale() {
    const isReturn = !!(this._receiptModel?.isReturn || this._draft?.asReturn)
    bindPageI18n(this, isReturn ? 'returnReceiptPreview' : 'receiptPreview')
    this.setData({
      ...this.chromeLabels(),
      templateLabel: uiTemplateLabel(this._templateId || this.data.templateId),
    })
  },

  chromeLabels(opts?: { connected?: boolean; name?: string }) {
    const connected = opts?.connected ?? this.data.btConnected
    const name = (opts?.name ?? this._btName ?? '').trim()
    const isReturn = !!(this._receiptModel?.isReturn || this._draft?.asReturn)
    const shopName = this._receiptModel?.shopName || this._draft?.shop?.shopName || ''
    let navTitle = this._templateSample
      ? isReturn
        ? t('returnReceiptPreview')
        : t('receiptPreview')
      : connected && shopName
        ? `${t('print')}-${shopName}`
        : isReturn
          ? t('returnReceiptPreview')
          : t('receiptPreview')
    if (this._templateSample && navTitle.slice(-2) !== '模板') navTitle += '模板'
    return {
      navTitle,
      btLabel: connected
        ? `${t('connectedPrefix')}${name}`.trim()
        : name
          ? `${name}·${t('tapConnect')}`
          : t('tapConnect'),
    }
  },

  _btName: '',
  _draft: null as ReceiptPrintDraft | null,
  _receiptModel: null as ReceiptRenderModel | null,
  _templateId: 'cashier' as PrintTemplateTypeId,
  _channel: null as WechatMiniprogram.EventChannel | null,
  _btSheetOpen: false,
  _saved: false,
  /** 历史订单重打：不落单、不扣库存 */
  _reprintOnly: false,
  _templateSample: false,
  _previewStarted: false,

  onLoad() {
    const staged = takeReceiptPreview()
    const begin = (payload?: {
      draft?: ReceiptPrintDraft
      reprintOnly?: boolean
    }) => {
      if (this._previewStarted) return
      const draft = payload?.draft
      if (!draft) return
      this._previewStarted = true
      this._templateSample = !!draft.templateSample
      this._reprintOnly = !!payload?.reprintOnly || this._templateSample
      void this.bootstrap(draft)
    }
    if (staged?.draft) begin(staged as { draft: ReceiptPrintDraft; reprintOnly?: boolean })
    try {
      this._channel = this.getOpenerEventChannel()
      this._channel.on('init', begin)
    } catch (_) {
      if (!this._previewStarted) void this.bootstrap(null)
    }
  },

  onReady() {
    applyCapsuleStyle(this)
  },

  onShow() {
    this.applyLocale()
    if (this.data.ready) {
      this.setData({ fontScale: receiptFontScale() })
      void this.refreshSavedTemplate()
      void this.syncBluetooth({ showSheetIfNeeded: false })
    }
  },

  onPickTemplate() {
    wx.navigateTo({ url: '/pages/print-template/print-template' })
  },

  /** 从打印模板设置返回后，按刚保存的模板重画这张小票。 */
  async refreshSavedTemplate() {
    const draft = this._draft
    if (!draft || !this.data.ready) return
    await this.renderPreview(draft, loadPrintTemplate(), false)
  },

  onUnload() {
    // 未打印成功离开：不保存订单
    if (!this._saved && this._channel) {
      try {
        this._channel.emit('done', { saved: false })
      } catch (_) {
        /* ignore */
      }
    }
  },

  async bootstrap(draft: ReceiptPrintDraft | null) {
    if (!draft || !Array.isArray(draft.items) || !draft.items.length) {
      wx.showToast({ title: '预览数据无效', icon: 'none' })
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 400)
      return
    }
    this._draft = draft
    this._templateSample = !!draft.templateSample
    if (this._templateSample) this._reprintOnly = true
    let tpl = loadPrintTemplate()
    if (!this._templateSample) {
      try {
        const pulled = await pullPrintTemplateFromCloud()
        if (pulled.ok && pulled.applied) tpl = pulled.template
        else tpl = loadPrintTemplate()
      } catch (_) {
        tpl = loadPrintTemplate()
      }
    }

    await this.renderPreview(draft, tpl, true)

    // 已有云端单（重打）可直接签发；新建单等用户点分享时再落云上链
    if ((this._reprintOnly || this._saved) && !this._templateSample) {
      void this.prepareLookupShare(false)
    }

    await this.syncBluetooth({ showSheetIfNeeded: true })
  },

  async renderPreview(draft: ReceiptPrintDraft, tpl: PrintTemplate, leaveOnError: boolean) {
    const session = getSession()
    const handler =
      (session?.team?.displayName || '').trim() || (session?.phone || '').trim()
    const isReturn = !!draft.asReturn
    let shopName = ''
    let qr: Awaited<ReturnType<typeof extraReceiptQr>>
    try {
      shopName = receiptShopTitle(
        draft.shop?.shopName,
        tpl.headerTitle,
        isGuest() || !isLoggedIn(),
      )
      qr = await extraReceiptQr(tpl, draft.orderNo, isReturn, draft.shop, {
        localOnly: this._templateSample,
      })
    } catch (err) {
      wx.showToast({
        title: err instanceof Error ? err.message : '预览失败',
        icon: 'none',
      })
      if (!leaveOnError) return
      this.setData({ loading: false, ready: false })
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 600)
      return
    }
    const printFlags = receiptPrintFlags(draft.customerName, isReturn)
    const receiptModel = buildReceiptRenderModel({
      templateId: tpl.template,
      layoutTemplate: tpl,
      shopName,
      isReturn,
      orderNo: draft.orderNo,
      dateStr: draft.dateStr,
      customerName: draft.customerName || '',
      customerPhone: draft.customerPhone || '',
      handler,
      items: draft.items,
      totalQuantity: draft.totalQuantity,
      totalAmount: draft.totalAmount,
      footer: (tpl.footerText || draft.shop?.footer || '').trim(),
      shopAddress: String(draft.shop?.address || '').trim(),
      shopPhone: String(draft.shop?.phone || '').trim(),
      ...qr,
      ...printFlags,
    })
    this._receiptModel = receiptModel
    this._templateId = receiptModel.templateId
    const qrBlockH = estimateQrBlockH(receiptModel)
    const canvasH = estimateReceiptCanvasHeight(
      receiptModel.templateId,
      draft.items.length,
      qrBlockH,
      draft.items,
    )
    const patch: Record<string, unknown> = {
      ready: true,
      loading: false,
      templateLabel: `${isReturn ? '退单 · ' : ''}${uiTemplateLabel(receiptModel.templateId)}`,
      templateId: receiptModel.templateId,
      receiptModel,
      fontScale: receiptFontScale(),
      canvasH: Math.max(560, canvasH),
      ...this.chromeLabels(),
    }
    if (leaveOnError) {
      patch.shareReady = false
      patch.shareToken = ''
      patch.cloudPrintVisible = isLoggedIn() && !isGuest()
      patch.templateSample = this._templateSample
    }
    this.setData(patch)
  },

  async syncBluetooth(opts: { showSheetIfNeeded: boolean; tryReconnect?: boolean }) {
    const st = await refreshBleStatus({ tryReconnect: !!opts.tryReconnect })
    const saved = getSavedPrinter()
    const connected = st.connected
    const linkWifi = !!saved && isLanPrinterId(saved.deviceId)
    const name = (st.name || saved?.name || '').trim()
    this._btName = name
    this.setData({
      btConnected: connected,
      linkWifi,
      ...this.chromeLabels({ connected, name }),
    })
    if (!connected && opts.showSheetIfNeeded) {
      await this.openBtSheet(true)
    }
    return connected
  },

  async openBtSheet(searching: boolean) {
    if (this._btSheetOpen) return
    this._btSheetOpen = true
    await showBluetoothSetupDialog({
      searching,
      title: searching ? '蓝牙搜索中' : '未连接打印机',
      hint: '请打开蓝牙打印机，并确认手机已开启蓝牙与定位权限。',
      printerUrl: '/pages/printer/printer',
    })
    this._btSheetOpen = false
    await this.syncBluetooth({ showSheetIfNeeded: false })
  },

  onBack() {
    if (this.data.busy) return
    wx.navigateBack({ fail: () => {} })
  },

  async onBluetoothTap() {
    if (this.data.btConnecting || this.data.busy) return
    if (this.data.btConnected) {
      wx.showToast({ title: this.data.btLabel || '已连接', icon: 'none' })
      return
    }
    this.setData({ btConnecting: true })
    try {
      await this.openBtSheet(true)
    } finally {
      this.setData({ btConnecting: false })
    }
  },

  async onPrint() {
    if (this.data.busy || !this._draft) return
    const savedNow = getSavedPrinter()
    const lanReady = !!savedNow && isLanPrinterId(savedNow.deviceId)
    if (!this.data.btConnected && !lanReady) {
      wx.showToast({ title: '请先搜索并连接打印机', icon: 'none' })
      await this.openBtSheet(true)
      return
    }
    await this.runPrintCopies(1)
  },

  async onCloudPrint() {
    if (this.data.busy || !this._draft) return
    await this.runCloudPrint()
  },

  async runPrintCopies(copies: number) {
    if (this.data.busy || !this._draft || copies < 1) return
    let connected = await this.syncBluetooth({ showSheetIfNeeded: false })
    const savedNow = getSavedPrinter()
    const lanReady = !!savedNow && isLanPrinterId(savedNow.deviceId)
    if (!connected && !lanReady) {
      await this.openBtSheet(true)
      connected = await this.syncBluetooth({ showSheetIfNeeded: false })
    }

    this.setData({ busy: true, printing: true })
    try {
      let printed = false
      let bleError = ''
      if (connected || lanReady) {
        const ble = await this.printBleCopies()
        printed = ble.ok
        bleError = ble.error || ''
      }
      if (!printed) {
        const goCloud = await this.askCloudFallback(
          localPrintFailTitle(connected),
          bleError,
        )
        if (!goCloud) return
        printed = await this.printCloudOnce()
      }
      if (!printed) return
      await this.afterPrinted()
    } finally {
      this.setData({ busy: false, printing: false })
    }
  },

  async runCloudPrint() {
    if (this.data.busy || !this._draft) return
    this.setData({ busy: true, printing: true })
    try {
      const printed = await this.printCloudOnce()
      if (!printed) return
      await this.afterPrinted()
    } finally {
      this.setData({ busy: false, printing: false })
    }
  },

  async afterPrinted() {
    if (this._reprintOnly) {
      this._saved = true
      wx.showToast({
        title: '打印完成（不扣库存）',
        icon: 'success',
      })
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 450)
      return
    }

    const saved = await this.persistAfterPrint()
    if (!saved) return
    this._saved = true
    try {
      this._channel?.emit('done', {
        saved: true,
        orderNo: this._draft!.orderNo,
      })
    } catch (_) {
      /* ignore */
    }
    wx.showToast({
      title: '打印完成',
      icon: 'success',
    })
    setTimeout(() => wx.navigateBack({ fail: () => {} }), 450)
  },

  async printTextCopy(): Promise<{ ok: boolean; error?: string }> {
    const d = this._draft!
    return tryBlePrintOrExplain({
      shop: d.shop,
      orderNo: d.orderNo,
      customerName: d.customerName,
      customerPhone: d.customerPhone,
      remark: d.remark,
      items: d.items,
      totalAmount: d.totalAmount,
      totalQuantity: d.totalQuantity,
      createdAt: d.dateStr,
      isReturn: d.asReturn,
      handler: this._receiptModel?.handler || '',
      template: this._templateId,
    })
  },

  async printBleCopies(): Promise<{ ok: boolean; error?: string }> {
    const preferRaster = shouldUseRasterPrint()
    wx.showToast({
      title: isLanPagePrinter() ? '激光打印中' : preferRaster ? '按预览打印中' : '指令打印中',
      icon: 'none',
      duration: 800,
    })
    {
      if (preferRaster || isLanPagePrinter()) {
        try {
          if (!this._receiptModel) throw new Error('预览未就绪')
          if (isLanPagePrinter()) {
            const painted = await renderReceiptCanvas(this, this._receiptModel, {
              forPrint: true,
              canvasH: this.data.canvasH,
            })
            if (painted.dark < 40) throw new Error('预览图是空白，已取消打印')
            const host = lanHostFromId(getSavedPrinter()?.deviceId)
            if (!host) throw new Error('激光打印机未连接')
            await printLanPage(host, painted.rgba, painted.width, painted.height)
          } else {
            const bytes = await buildRasterPrintBytes(this, this._receiptModel, this.data.canvasH)
            await writeBytes(bytes)
          }
        } catch (err) {
          if (isLanPagePrinter()) {
            const message = err instanceof Error ? err.message : '激光打印失败'
            return { ok: false, error: message || '激光打印失败' }
          }
          const fallback = await this.printTextCopy()
          if (!fallback.ok) {
            return { ok: false, error: fallback.error || '位图失败，指令也失败' }
          }
        }
      } else {
        const ble = await this.printTextCopy()
        if (!ble.ok) {
          return { ok: false, error: ble.error || '打印失败' }
        }
      }
    }
    await this.syncBluetooth({ showSheetIfNeeded: false })
    return { ok: true }
  },

  askCloudFallback(title: string, error?: string): Promise<boolean> {
    if (!isCloudSyncAllowed()) {
      return Promise.resolve(false)
    }
    return new Promise((resolve) => {
      wx.showModal({
        title,
        content: error
          ? `${error}\n可改用电脑端云打印。是否云打印？`
          : '可改用电脑端云打印。是否云打印？',
        confirmText: '云打印',
        cancelText: '取消',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false),
      })
    })
  },

  async printCloudOnce(): Promise<boolean> {
    const d = this._draft!
    const picked = await pickOnlineGateway()
    if (!picked.ok || !picked.gateway) {
      if (!picked.ok && picked.cancelled) return false
      wx.showModal({
        title: '请先连接',
        content: picked.error || '请先在打印设置里连接云打印机，再点云打印到电脑。',
        showCancel: false,
      })
      return false
    }
    const target = picked.gateway
    const session = getSession()
    const job = await submitPrintJob({
      shop: d.shop,
      orderNo: d.orderNo,
      customerName: d.customerName,
      customerPhone: d.customerPhone,
      remark: d.remark,
      items: d.items,
      totalAmount: d.totalAmount,
      totalQuantity: d.totalQuantity,
      creatorPhone: session?.phone,
      creatorName: (session?.team?.displayName as string) || undefined,
      targetClientId: target.clientId,
      isReturn: !!d.asReturn,
    })
    if (!job.ok || !job.jobNo) {
      wx.showToast({ title: job.error || '提交云打印失败', icon: 'none' })
      return false
    }
    wx.showLoading({ title: '云打印中…', mask: true })
    const poll = pollPrintJob(job.jobNo, () => {})
    const finalJob = await poll.done
    wx.hideLoading()
    if (finalJob?.status === 'done') return true
    wx.showModal({
      title: '打印未完成',
      content: finalJob?.errorMsg || `状态: ${finalJob?.status || '超时'}`,
      showCancel: false,
    })
    return false
  },

  /** 仅在打印成功后落单（用户要求：不要一开始就保存） */
  async persistAfterPrint(): Promise<boolean> {
    const d = this._draft!
    const createdAt = String(d.createdAt || '').trim() || combineDateStrWithNow(d.dateStr)
    const photoB64 = d.deliveryPhotoPath
      ? readLocalFileBase64(d.deliveryPhotoPath)
      : ''
    const r = await uploadOrder({
      orderNo: d.orderNo,
      customerName: d.customerName,
      customerPhone: d.customerPhone,
      customerId: d.customerId || undefined,
      remark: d.remark,
      totalAmount: d.totalAmount,
      totalQuantity: d.totalQuantity,
      items: d.items,
      isReturn: d.asReturn,
      returnReason: d.asReturn ? d.returnReason || '其他' : undefined,
      returnForDate: d.asReturn ? d.returnForDate || d.dateStr : undefined,
      isPaid: !!d.isPaid,
      isPickedUp: !!d.isPickedUp,
      isShipped: !!d.isShipped,
      isDelivered: !!d.isDelivered,
      trackingNos: d.trackingNos || [],
      createdAt,
      deliveryPhotoBase64: photoB64 || undefined,
      deliveryPhotoPath: d.deliveryPhotoPath || undefined,
    })
    if (!r.ok) {
      wx.showModal({
        title: '打印已完成',
        content: `本机保存失败：${r.error || '未知错误'}。请返回首页点「保存」补存。`,
        showCancel: false,
      })
      return false
    }
    await applyAutoStockForOrder({
      orderNo: d.orderNo,
      items: d.items || [],
      isReturn: !!d.asReturn,
      replaceExisting: hasAutoStockForOrderNo(d.orderNo),
    })
    return true
  },

  /** 微信分享公开查账：同扫码查账，正文上链只读 */
  async prepareLookupShare(persistIfNeeded: boolean) {
    const d = this._draft
    if (!d?.orderNo) return false
    if (!isLoggedIn() || isGuest()) {
      this.setData({ shareReady: false, shareToken: '' })
      return false
    }
    try {
      if (persistIfNeeded && !this._reprintOnly && !this._saved) {
        const ok = await this.persistAfterPrint()
        if (!ok) {
          this.setData({ shareReady: false, shareToken: '' })
          return false
        }
        this._saved = true
        try {
          this._channel?.emit('done', { saved: true, orderNo: d.orderNo })
        } catch (_) {}
      }
      const share = await mintLookupShare(d.orderNo)
      this.setData({
        shareReady: share.ok && !!share.token,
        shareToken: share.token || '',
      })
      if (share.ok) {
        try {
          wx.showShareMenu({ menus: ['shareAppMessage'] })
        } catch (_) {}
        if (this._receiptModel) {
          try {
            const painted = await renderReceiptCanvas(this, this._receiptModel, {
              canvasH: this.data.canvasH,
              shareCover: true,
            })
            if (painted.path) this.setData({ shareImage: painted.path })
          } catch (_) {}
        }
        return true
      }
      wx.showToast({ title: share.error || t('shareLookupFail'), icon: 'none' })
      return false
    } catch (_) {
      this.setData({ shareReady: false, shareToken: '' })
      return false
    }
  },

  async onShareTap() {
    if (this.data.shareReady && this.data.shareToken) return
    if (!isLoggedIn() || isGuest()) {
      wx.showToast({ title: t('shareLookupNeedLogin'), icon: 'none' })
      return
    }
    wx.showLoading({ title: t('shareLookupPreparing'), mask: true })
    const ok = await this.prepareLookupShare(true)
    try {
      wx.hideLoading()
    } catch (_) {}
    if (ok) {
      wx.showToast({ title: '凭证已就绪，请再点分享', icon: 'none' })
    }
  },

  onShareAppMessage() {
    const token = String(this.data.shareToken || '').trim()
    const d = this._draft
    if (token) {
      const imageUrl = String(this.data.shareImage || '').trim()
      return {
        title: lookupShareTitle(d?.shop?.shopName, d?.orderNo),
        path: lookupSharePath(token),
        ...(imageUrl ? { imageUrl } : {}),
      }
    }
    return {
      title: d?.shop?.shopName || t('brand'),
      path: '/pages/home/home',
    }
  },

  async onDownload() {
    if (this.data.busy || !this._draft) return
    this.setData({ busy: true })
    try {
      await this.ensureAlbumAuth()
      const painted = await renderReceiptCanvas(this, this._receiptModel!, {
        canvasH: this.data.canvasH,
      })
      const path = painted.path
      await new Promise<void>((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: path,
          success: () => resolve(),
          fail: reject,
        })
      })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (e: any) {
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
        wx.showToast({ title: msg.slice(0, 40), icon: 'none' })
      }
    } finally {
      this.setData({ busy: false })
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
})
