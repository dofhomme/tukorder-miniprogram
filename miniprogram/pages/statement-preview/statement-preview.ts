import {
  markStmtStatsDirty,
  recomputeStmtTotals,
  stmtStatusMeta,
  takeStmtPreview,
} from '../../services/analytics'
import type { StmtPreviewPayload } from '../../services/analytics'
import {
  EscPosBuilder,
  buildRasterEscPosFromRgba,
  countDarkRgba,
} from '../../services/escpos'
import {
  writeBytes,
  getSavedPrinter,
  getPaperWidthMm,
  localPrintFailTitle,
  refreshBleStatus,
} from '../../services/bluetooth'
import { isLanPrinterId } from '../../services/lan-printer'
import { shouldUseRasterPrint } from '../../services/print-settings'
import { dotsPerLine, normalizePaperWidthMm } from '../../services/thermal-paper'
import { showBluetoothSetupDialog } from './bt-dialog'
import {
  applyCapsuleStyle,
  capsuleStyleDefaults,
} from '../../utils/nav'
import { collectPayQrTargets, scanReceiptQrs } from '../../utils/qr-actions'
import {
  buildStatementRenderModel,
  estimateStatementCanvasHeight,
  type StatementRenderModel,
} from './statement-layout'
import {
  loadPrintTemplate,
  pullPrintTemplateFromCloud,
  type PrintTemplate,
} from '../../services/print-template'
import { drawStatementCanvas } from './statement-canvas'
import { fitMpCanvasScale, resizeMpCanvas } from '../../utils/mp-canvas-fit'
import { canvasToShareCover } from '../../utils/receipt-render'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import {
  peekCachedOrders,
  fetchOrders,
  uploadOrder,
  mergeRemoteOrdersIntoCache,
  upsertOrderInCache,
  canEditOrder,
} from '../../services/team'
import { isGuest, isLoggedIn } from '../../services/session'
import { isCloudSyncAllowed } from '../../services/subscription'
import {
  mintStatementShare,
  statementSharePath,
  statementShareTitle,
} from '../../services/lookup'
import {
  pickOnlineGateway,
  pollPrintJob,
  submitStatementJob,
} from '../../services/cloud-print'

const STMT_CSS_W = 360

Page({
  data: {
    ...capsuleStyleDefaults(),
    ready: false,
    printing: false,
    saving: false,
    showExport: false,
    navTitle: t('statementPreview'),
    btConnected: false,
    linkWifi: false,
    btLabel: t('autoConnect'),
    shopName: '',
    customerName: '',
    customerPhone: '',
    rangeLabel: '',
    printTime: '',
    unpaidOnly: false,
    orders: [] as StmtPreviewPayload['orders'],
    totals: {} as StmtPreviewPayload['totals'],
    unpaidEditableCount: 0,
    markingAll: false,
    shareReady: false,
    shareToken: '',
    shareImage: '',
    cloudPrintVisible: false,
    showPayQr: false,
    qrHint: '',
    wechatQr: '',
    alipayQr: '',
    ...i18nState(),
  },

  applyLocale() {
    const unpaid = this.data.unpaidOnly
    bindPageI18n(this, unpaid ? 'unpaidStatementPreview' : 'statementPreview')
    this.setData({
      navTitle: unpaid ? t('unpaidStatementPreview') : t('statementPreview'),
    })
    void this.refreshBtLabel()
  },

  onScanPageQrs() {
    scanReceiptQrs(
      collectPayQrTargets({
        wechatQr: this.data.wechatQr,
        alipayQr: this.data.alipayQr,
      }),
    )
  },

  _payload: null as StmtPreviewPayload | null,
  _template: null as PrintTemplate | null,
  _statementModel: null as StatementRenderModel | null,
  _toggling: false,
  _markingAll: false,

  unpaidEditableCount(orders: StmtPreviewPayload['orders']) {
    const cached = peekCachedOrders()
    return (orders || []).filter((o) => {
      if (o.isPaid || !o.orderNo) return false
      const found = cached.find((x) => x.orderNo === o.orderNo)
      return canEditOrder(found)
    }).length
  },

  canToggleStmtOrder(orderNo: string): boolean {
    const found = peekCachedOrders().find((o) => o.orderNo === orderNo)
    return canEditOrder(found)
  },

  async onLoad() {
    const payload = takeStmtPreview()
    if (!payload || !payload.customerName) {
      wx.showToast({ title: '预览数据丢失', icon: 'none' })
      setTimeout(() => wx.navigateBack({ fail() {} }), 450)
      return
    }
    this._payload = payload
    // 先用本地模版立刻出界面，避免等云端 prefs 时整页白屏像「打不开」
    const localTpl = loadPrintTemplate()
    this._template = localTpl
    try {
      this.syncStatementModel(payload, localTpl)
    } catch (err) {
      console.error('[statement-preview] render fail', err)
      wx.showToast({ title: '预览渲染失败', icon: 'none' })
      return
    }
    this.applyLocale()
    void this.refreshTemplateFromCloud()
  },

  async refreshTemplateFromCloud() {
    try {
      const pulled = await pullPrintTemplateFromCloud()
      if (!pulled.ok || !pulled.applied || !this._payload) return
      this._template = pulled.template
      this.syncStatementModel(this._payload, pulled.template)
    } catch (_) {
      /* ignore */
    }
  },

  syncStatementModel(payload: StmtPreviewPayload, tpl: PrintTemplate) {
    const model = buildStatementRenderModel(payload, tpl)
    this._statementModel = model
    this.setData({
      ready: true,
      navTitle: payload.unpaidOnly ? t('unpaidStatementPreview') : t('statementPreview'),
      shopName: model.shopName,
      customerName: payload.customerName,
      customerPhone: payload.customerPhone || '',
      rangeLabel: payload.rangeLabel,
      printTime: payload.printTime || '',
      unpaidOnly: payload.unpaidOnly,
      orders: payload.orders,
      totals: model.totals,
      unpaidEditableCount: this.unpaidEditableCount(payload.orders),
      shareReady: false,
      shareToken: '',
      cloudPrintVisible: isLoggedIn() && !isGuest(),
      showPayQr: !!(model.showPayQr && (model.wechatQr || model.alipayQr)),
      qrHint: model.qrHint || '',
      wechatQr: model.wechatQr || '',
      alipayQr: model.alipayQr || '',
    })
  },

  onReady() {
    applyCapsuleStyle(this)
  },

  onShow() {
    this.applyLocale()
    try {
      wx.showShareMenu({ menus: ['shareAppMessage'] })
    } catch (_) {}
  },

  onShareAppMessage() {
    const token = String(this.data.shareToken || '').trim()
    if (token) {
      const imageUrl = String(this.data.shareImage || '').trim()
      return {
        title: statementShareTitle(this.data.shopName, this.data.customerName),
        path: statementSharePath(token),
        ...(imageUrl ? { imageUrl } : {}),
      }
    }
    return {
      title: this.data.shopName || t('brand'),
      path: '/pages/analytics/analytics',
    }
  },

  async prepareStatementShare() {
    if (!isLoggedIn() || isGuest()) {
      this.setData({ shareReady: false, shareToken: '' })
      return false
    }
    const orders = this.data.orders || []
    const orderNos = orders.map((o) => String(o.orderNo || '').trim()).filter(Boolean)
    if (!orderNos.length) {
      wx.showToast({ title: t('shareStatementEmpty'), icon: 'none' })
      return false
    }
    try {
      const share = await mintStatementShare({
        customerName: this.data.customerName,
        unpaidOnly: this.data.unpaidOnly,
        rangeLabel: this.data.rangeLabel,
        orderNos,
      })
      this.setData({
        shareReady: share.ok && !!share.token,
        shareToken: share.token || '',
      })
      if (share.ok) {
        try {
          wx.showShareMenu({ menus: ['shareAppMessage'] })
        } catch (_) {}
        await this.prepareShareCover()
        return true
      }
      wx.showToast({ title: share.error || t('shareStatementFail'), icon: 'none' })
      return false
    } catch (_) {
      this.setData({ shareReady: false, shareToken: '' })
      wx.showToast({ title: t('shareStatementFail'), icon: 'none' })
      return false
    }
  },

  async onShareTap() {
    if (this.data.shareReady && this.data.shareToken) return
    if (!isLoggedIn() || isGuest()) {
      wx.showToast({ title: t('shareStatementNeedLogin'), icon: 'none' })
      return
    }
    wx.showLoading({ title: t('shareStatementPreparing'), mask: true })
    const ok = await this.prepareStatementShare()
    try {
      wx.hideLoading()
    } catch (_) {}
    if (ok) {
      wx.showToast({ title: t('shareStatementReady'), icon: 'none' })
    }
  },

  async prepareShareCover() {
    try {
      await this.renderStatementCanvas()
      const path = await new Promise<string>((resolve, reject) => {
        wx.createSelectorQuery()
          .in(this)
          .select('#stmtCanvas')
          .fields({ node: true })
          .exec((res) => {
            const canvas = res?.[0]?.node as WechatMiniprogram.Canvas
            if (!canvas) {
              reject(new Error('画布未就绪'))
              return
            }
            canvasToShareCover(canvas).then(resolve).catch(reject)
          })
      })
      if (path) this.setData({ shareImage: path })
    } catch (_) {}
  },

  noop() {},

  async refreshBtLabel() {
    const saved = getSavedPrinter()
    const st = await refreshBleStatus({ tryReconnect: true })
    const name = (st.name || saved?.name || '').trim()
    this.setData({
      btConnected: st.connected,
      linkWifi: !!saved && isLanPrinterId(saved.deviceId),
      btLabel: st.connected
        ? `${t('connectedPrefix')}${name}`.trim()
        : name
          ? `${name}·${t('tapConnect')}`
          : t('autoConnect'),
    })
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/analytics/analytics' }) })
  },

  async onBluetoothSearch() {
    // 打开搜索页，从搜到的设备里再选，不自动连上次的打印机
    const result = await showBluetoothSetupDialog({
      searching: true,
      title: '蓝牙搜索中',
      hint: '正在搜索附近蓝牙打印机，请保持打印机开机。',
      printerUrl: '/pages/printer/printer',
    })
    if (result === 'reconnect') {
      // 已跳转打印机页自动连接；返回本页时 onShow 刷新
      return
    }
    this.refreshBtLabel()
  },

  onBtReconnect() {
    wx.navigateTo({ url: '/pages/printer/printer' })
  },

  onToggleStatus(e: WechatMiniprogram.TouchEvent) {
    if (this._toggling || this._markingAll) return
    const index = Number(e.currentTarget.dataset.index)
    const row = this.data.orders[index]
    if (!row || !row.orderNo) return
    if (!this.canToggleStmtOrder(row.orderNo)) {
      wx.showToast({ title: t('orderEditOwnOnly'), icon: 'none' })
      return
    }

    const toPaid = !row.isPaid
    const actionText = row.isReturn
      ? toPaid
        ? '标记为已退款'
        : '改回未退款'
      : toPaid
        ? '标记为已付款'
        : '改回未付款'

    wx.showModal({
      title: `确认${actionText}？`,
      content: `账单 ¥${row.amountLabel}（${row.createdAt || row.orderNo}）`,
      confirmText: '确认',
      success: async (r) => {
        if (!r.confirm) return
        await this.applyPaidToggle(index, toPaid, actionText)
      },
    })
  },

  onMarkAllPaid() {
    if (this._toggling || this._markingAll) return
    const targets = (this.data.orders || []).filter(
      (o) => !o.isPaid && !!o.orderNo && this.canToggleStmtOrder(o.orderNo),
    )
    if (!targets.length) {
      wx.showToast({ title: t('noUnpaidToMark'), icon: 'none' })
      return
    }
    wx.showModal({
      title: t('confirmMarkAllPaid'),
      content: `${t('confirmMarkAllPaidD')}\n共 ${targets.length} 笔`,
      confirmText: '确认',
      success: async (r) => {
        if (!r.confirm) return
        await this.applyMarkAllPaid(targets.map((o) => o.orderNo))
      },
    })
  },

  async applyMarkAllPaid(orderNos: string[]) {
    if (this._markingAll || this._toggling) return
    const nos = [...new Set(orderNos.filter(Boolean))]
    if (!nos.length) return
    this._markingAll = true
    this.setData({ markingAll: true })
    wx.showLoading({ title: t('markingAllPaid'), mask: true })
    try {
      let cached = peekCachedOrders()
      let needFetch = false
      for (const no of nos) {
        const found = cached.find((o) => o.orderNo === no)
        if (!found || !found.items || !found.items.length) {
          needFetch = true
          break
        }
      }
      if (needFetch) {
        const r = await fetchOrders({ full: true, limit: 500, allCreators: true })
        if (r.ok) cached = mergeRemoteOrdersIntoCache(r.orders)
      }

      let okCount = 0
      let lastErr = ''
      const paidSet = new Set<string>()
      for (const no of nos) {
        const found = cached.find((o) => o.orderNo === no)
        if (!found) {
          lastErr = '未找到该账单'
          continue
        }
        if (!canEditOrder(found)) {
          lastErr = t('orderEditOwnOnly')
          continue
        }
        const items = Array.isArray(found.items) ? found.items : []
        if (!items.length) {
          lastErr = '账单明细缺失'
          continue
        }
        const up = await uploadOrder({
          orderNo: found.orderNo,
          customerName: found.customerName || this.data.customerName || undefined,
          customerPhone:
            found.customerPhone || this.data.customerPhone || undefined,
          customerId: (found as any).customerId || undefined,
          remark: found.remark || undefined,
          totalAmount: Number(found.totalAmount || 0),
          totalQuantity: Number(found.totalQuantity || 0),
          items,
          createdAt: found.createdAt || undefined,
          isReturn: !!found.isReturn,
          returnReason: (found as any).returnReason || undefined,
          isPaid: true,
          isPickedUp: !!found.isPickedUp,
          isShipped: !!found.isShipped,
          isDelivered: !!found.isDelivered,
          trackingNos: Array.isArray(found.trackingNos) ? found.trackingNos : [],
        })
        if (!up.ok) {
          lastErr = up.error || '更新失败'
          continue
        }
        okCount++
        paidSet.add(no)
        const ci = cached.findIndex((o) => o.orderNo === no)
        if (ci >= 0) {
          upsertOrderInCache({ ...cached[ci], isPaid: true })
          cached[ci] = { ...cached[ci], isPaid: true }
        }
      }

      if (okCount <= 0) {
        wx.showToast({ title: lastErr || t('noUnpaidToMark'), icon: 'none' })
        return
      }
      markStmtStatsDirty()

      const orders = this.data.orders.map((row) => {
        if (!paidSet.has(row.orderNo)) return row
        const meta = stmtStatusMeta(row.isReturn, true)
        return {
          ...row,
          isPaid: true,
          statusLabel: meta.statusLabel,
          statusClass: meta.statusClass,
        }
      })
      const totals = recomputeStmtTotals(orders)
      if (this._payload && this._template) {
        this._payload = { ...this._payload, orders, totals }
        this.syncStatementModel(this._payload, this._template)
      } else {
        this.setData({
          orders,
          totals,
          unpaidEditableCount: this.unpaidEditableCount(orders),
        })
      }
      wx.showToast({
        title: okCount >= nos.length ? t('markedAllPaid') : `已更新 ${okCount}/${nos.length} 笔`,
        icon: 'success',
        duration: 1200,
      })
    } catch (e: any) {
      wx.showToast({
        title: (e?.message || '更新失败').toString().slice(0, 40),
        icon: 'none',
      })
    } finally {
      wx.hideLoading()
      this._markingAll = false
      this.setData({ markingAll: false })
    }
  },

  async applyPaidToggle(index: number, toPaid: boolean, actionText: string) {
    if (this._toggling || this._markingAll) return
    const row = this.data.orders[index]
    if (!row) return
    this._toggling = true
    wx.showLoading({ title: '更新中…', mask: true })
    try {
      let cached = peekCachedOrders()
      let found = cached.find((o) => o.orderNo === row.orderNo)
      if (!found || !found.items || !found.items.length) {
        const r = await fetchOrders({ full: true, limit: 500, allCreators: true })
        if (r.ok) {
          cached = mergeRemoteOrdersIntoCache(r.orders)
          found = cached.find((o) => o.orderNo === row.orderNo)
        }
      }
      if (!found) {
        wx.showToast({ title: '未找到该账单', icon: 'none' })
        return
      }
      if (!canEditOrder(found)) {
        wx.showToast({ title: t('orderEditOwnOnly'), icon: 'none' })
        return
      }
      const items = Array.isArray(found.items) ? found.items : []
      if (!items.length) {
        wx.showToast({ title: '账单明细缺失，请先同步数据', icon: 'none' })
        return
      }

      const up = await uploadOrder({
        orderNo: found.orderNo,
        customerName: found.customerName || this.data.customerName || undefined,
        customerPhone:
          found.customerPhone || this.data.customerPhone || undefined,
        customerId: (found as any).customerId || undefined,
        remark: found.remark || undefined,
        totalAmount: Number(found.totalAmount || Math.abs(row.totalAmount) || 0),
        totalQuantity: Number(found.totalQuantity || row.totalQuantity || 0),
        items,
        createdAt: found.createdAt || undefined,
        isReturn: !!found.isReturn || row.isReturn,
        returnReason: (found as any).returnReason || undefined,
        isPaid: toPaid,
        isPickedUp: !!found.isPickedUp,
        isShipped: !!found.isShipped,
        isDelivered: !!found.isDelivered,
        trackingNos: Array.isArray(found.trackingNos) ? found.trackingNos : [],
      })
      if (!up.ok) {
        wx.showToast({ title: up.error || '更新失败', icon: 'none' })
        return
      }
      markStmtStatsDirty()

      const meta = stmtStatusMeta(row.isReturn, toPaid)
      const orders = this.data.orders.slice()
      orders[index] = {
        ...row,
        isPaid: toPaid,
        statusLabel: meta.statusLabel,
        statusClass: meta.statusClass,
      }
      const totals = recomputeStmtTotals(orders)
      if (this._payload && this._template) {
        this._payload = { ...this._payload, orders, totals }
        this.syncStatementModel(this._payload, this._template)
      } else {
        this.setData({
          orders,
          totals,
          unpaidEditableCount: this.unpaidEditableCount(orders),
        })
      }

      const ci = cached.findIndex((o) => o.orderNo === row.orderNo)
      if (ci >= 0) {
        upsertOrderInCache({ ...cached[ci], isPaid: toPaid })
      }

      wx.showToast({ title: `已${actionText}`, icon: 'success', duration: 900 })
    } catch (e: any) {
      wx.showToast({
        title: (e?.message || '更新失败').toString().slice(0, 40),
        icon: 'none',
      })
    } finally {
      wx.hideLoading()
      this._toggling = false
    }
  },

  onOpenExport() {
    this.setData({ showExport: true })
  },

  onCloseExport() {
    this.setData({ showExport: false })
  },

  async onSaveImage() {
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      const path = await this.renderStatementImage()
      await this.saveToAlbum(path)
      this.setData({ showExport: false })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (e: any) {
      const msg = e?.message || String(e || '保存失败')
      wx.showToast({ title: msg.slice(0, 40), icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  saveToAlbum(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => resolve(),
        fail: (err) => {
          const msg = err?.errMsg || ''
          if (/auth deny|authorize|permission/i.test(msg)) {
            wx.showModal({
              title: '需要相册权限',
              content: '请在设置中允许保存图片到相册',
              confirmText: '去设置',
              success: (r) => {
                if (r.confirm) wx.openSetting({})
              },
            })
            reject(new Error('无相册权限'))
            return
          }
          reject(new Error(msg || '保存失败'))
        },
      })
    })
  },

  renderStatementImage(): Promise<string> {
    return this.renderStatementCanvas({ forPrint: false }).then((r) => {
      if (!r.path) return Promise.reject(new Error('导出图片失败'))
      return r.path
    })
  },

  renderStatementCanvas(opts?: { forPrint?: boolean }): Promise<{
    path: string
    rgba: Uint8ClampedArray | Uint8Array
    width: number
    height: number
    dark: number
  }> {
    const p = this._payload
    const tpl = this._template
    const model = this._statementModel
    if (!p || !tpl || !model) return Promise.reject(new Error('无预览数据'))
    const forPrint = !!opts?.forPrint
    const paperW = dotsPerLine(getPaperWidthMm())
    const W = forPrint ? STMT_CSS_W : 750
    const orderLimit = forPrint ? 100 : 80
    const printPayload = {
      ...p,
      orders: p.orders.slice(0, orderLimit),
    }
    const drawModel = buildStatementRenderModel(printPayload, tpl)
    let H = estimateStatementCanvasHeight(
      drawModel.templateId,
      drawModel.orders.length,
      !!p.customerPhone,
      !!drawModel.footer,
      !!(drawModel.showPayQr && (drawModel.wechatQr || drawModel.alipayQr)),
    )
    const wantScale = forPrint ? paperW / W : wx.getSystemInfoSync().pixelRatio || 2

    const loadCanvasImage = (
      canvas: WechatMiniprogram.Canvas,
      src: string,
    ): Promise<any | null> =>
      new Promise((resolve) => {
        if (!src) {
          resolve(null)
          return
        }
        const img = canvas.createImage()
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = src
      })

    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select('#stmtCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res?.[0]?.node as WechatMiniprogram.Canvas
          if (!canvas) {
            reject(new Error('画布不可用'))
            return
          }
          const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
          void Promise.all([
            loadCanvasImage(canvas, drawModel.wechatQr || ''),
            loadCanvasImage(canvas, drawModel.alipayQr || ''),
          ]).then(([wxImg, aliImg]) => {
            let scale = fitMpCanvasScale(W, H, wantScale)
            resizeMpCanvas(canvas, ctx, W, H, scale)
            let needed = drawStatementCanvas(ctx, drawModel, W, H, {
              forPrint,
              wxImg,
              aliImg,
            })
            for (let i = 0; i < 3 && needed > H + 1; i++) {
              H = Math.ceil(needed + 16)
              scale = fitMpCanvasScale(W, H, wantScale)
              resizeMpCanvas(canvas, ctx, W, H, scale)
              needed = drawStatementCanvas(ctx, drawModel, W, H, {
                forPrint,
                wxImg,
                aliImg,
              })
            }
            // 预估画布常常比账单高。只去掉多余空白；内容超出时上面已加高，不再裁短。
            const tight = Math.ceil(Math.max(160, needed))
            if (tight + 1 < H) {
              H = tight
              scale = fitMpCanvasScale(W, H, wantScale)
              resizeMpCanvas(canvas, ctx, W, H, scale)
              needed = drawStatementCanvas(ctx, drawModel, W, H, {
                forPrint,
                wxImg,
                aliImg,
              })
              if (needed > H + 1) {
                H = Math.ceil(needed + 16)
                scale = fitMpCanvasScale(W, H, wantScale)
                resizeMpCanvas(canvas, ctx, W, H, scale)
                needed = drawStatementCanvas(ctx, drawModel, W, H, {
                  forPrint,
                  wxImg,
                  aliImg,
                })
              }
            }
            const cropCssH = Math.min(needed, H)

          setTimeout(() => {
            try {
              ctx.setTransform(1, 0, 0, 1, 0, 0)
              const pw = canvas.width || 1
              const ph = Math.max(1, Math.min(canvas.height || 1, Math.round(cropCssH * scale)))
              const img = ctx.getImageData(0, 0, pw, ph)
              const dark = countDarkRgba(img.data, forPrint ? 2 : 1)
              const payload = {
                path: '',
                rgba: img.data,
                width: img.width,
                height: img.height,
                dark,
              }
              if (forPrint) {
                resolve(payload)
                return
              }
              wx.canvasToTempFilePath({
                canvas,
                fileType: 'png',
                quality: 1,
                success: (r) => resolve({ ...payload, path: r.tempFilePath }),
                fail: (e) => reject(new Error(e.errMsg || '导出图片失败')),
              })
            } catch (e) {
              reject(e)
            }
          }, forPrint ? 0 : 50)
          })
        })
    })
  },

  buildStatementTextBytes(): Uint8Array {
    const m = this._statementModel!
    const b = new EscPosBuilder(true)
    b.text(m.shopName, { align: 1, bold: true, zoom: 2 })
    b.text(m.subtitle, { align: 1, bold: true })
    b.text(`客户:${m.customerName}`)
    if (m.customerPhone) b.text(`电话:${m.customerPhone}`)
    b.text(`时段:${m.rangeLabel}`)
    if (m.printTime) b.text(`打印:${m.printTime}`)
    b.dash()
    for (const o of m.orders.slice(0, 100)) {
      const mark = o.isReturn ? '[退]' : ''
      b.text(
        `${o.createdAt} ${mark}¥${o.amountLabel} ${o.qtyLabel} ${o.statusLabel}`,
      )
    }
    b.dash()
    b.text(
      `合计:${m.totals.orderCount}单/${m.totals.qty}件 ¥${m.totals.totalLabel}`,
      { bold: true },
    )
    b.text(`已付:${m.totals.paidCount}单 ¥${m.totals.paidLabel}`)
    b.text(
      `未付:${m.totals.unpaidCount}单 ¥${m.totals.unpaidLabel}`,
      { bold: true },
    )
    b.text(`应收款:¥${m.totals.receivableLabel || m.totals.unpaidLabel}`, {
      bold: true,
    })
    if (m.footer) b.textBlock(m.footer, { align: 1 })
    b.finish(4)
    return b.build()
  },

  async buildStatementRasterBytes(): Promise<Uint8Array> {
    const painted = await this.renderStatementCanvas({ forPrint: true })
    if (painted.dark < 40) {
      throw new Error('预览图是空白，位图没有字')
    }
    const paper = normalizePaperWidthMm(getPaperWidthMm())
    return buildRasterEscPosFromRgba(
      painted.rgba,
      painted.width,
      painted.height,
      paper,
    )
  },

  async onPrint() {
    const p = this._payload
    if (!p) return
    if (this.data.printing || this.data.markingAll) return
    if (!this.data.btConnected && getSavedPrinter()) {
      await this.refreshBtLabel()
    }
    if (!this.data.btConnected) {
      const goCloud = await this.askCloudFallback(localPrintFailTitle(false))
      if (goCloud) {
        await this.runCloudPrint()
        return
      }
      wx.showToast({ title: localPrintFailTitle(false), icon: 'none' })
      return
    }
    if (!getSavedPrinter()) {
      await showBluetoothSetupDialog({
        title: '未连接打印机',
        hint: '尚未绑定手机蓝牙打印机，请先连接后再打印对账单。',
      })
      return
    }
    const rasterJob = shouldUseRasterPrint() ? this.buildStatementRasterBytes() : null
    this.setData({ printing: true })
    try {
      const st = await refreshBleStatus({ tryReconnect: true })
      if (!st.connected) {
        const goCloud = await this.askCloudFallback(localPrintFailTitle(false))
        if (goCloud) {
          const printed = await this.printCloudOnce()
          if (printed) wx.showToast({ title: '已打印', icon: 'success' })
          return
        }
        await showBluetoothSetupDialog({
          title: '未连接打印机',
          hint: `${localPrintFailTitle(false)}，请先连接后再打印对账单。`,
          printerUrl: '/pages/printer/printer',
        })
        return
      }
      wx.showToast({
        title: rasterJob ? '按预览打印中' : '指令打印中',
        icon: 'none',
        duration: 800,
      })
      if (rasterJob) {
        try {
          const bytes = await rasterJob
          await writeBytes(bytes)
          wx.showToast({ title: '已打印', icon: 'success' })
          return
        } catch (_) {
          /* 位图失败时回退文本指令 */
        }
      }
      await writeBytes(this.buildStatementTextBytes())
      wx.showToast({ title: '已打印', icon: 'success' })
    } catch (e: any) {
      const msg = e?.message || '打印失败'
      if (/未绑定|未连接|自动重连失败|连接打印机失败/.test(msg)) {
        const goCloud = await this.askCloudFallback(localPrintFailTitle(true), msg)
        if (goCloud) {
          const printed = await this.printCloudOnce()
          if (printed) wx.showToast({ title: '已打印', icon: 'success' })
          return
        }
        await showBluetoothSetupDialog({
          title: '未连接打印机',
          hint: msg,
        })
      } else {
        const goCloud = await this.askCloudFallback(localPrintFailTitle(true), msg)
        if (goCloud) {
          const printed = await this.printCloudOnce()
          if (printed) wx.showToast({ title: '已打印', icon: 'success' })
          return
        }
        wx.showToast({ title: msg, icon: 'none' })
      }
    } finally {
      this.setData({ printing: false })
    }
  },

  askCloudFallback(title: string, error?: string): Promise<boolean> {
    if (!this.data.cloudPrintVisible || !isCloudSyncAllowed()) {
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

  async onCloudPrint() {
    if (this.data.printing || this.data.markingAll) return
    await this.runCloudPrint()
  },

  async runCloudPrint() {
    this.setData({ printing: true })
    try {
      const printed = await this.printCloudOnce()
      if (printed) wx.showToast({ title: '已打印', icon: 'success' })
    } finally {
      this.setData({ printing: false })
    }
  },

  async printCloudOnce(): Promise<boolean> {
    const p = this._payload
    if (!p) return false
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
    const cached = peekCachedOrders()
    const orders = (p.orders || []).map((row) => {
      const found = cached.find((o) => o.orderNo === row.orderNo)
      return {
        orderNo: row.orderNo,
        createdAt: found?.createdAt || row.createdAt,
        totalAmount: row.totalAmount,
        totalQuantity: row.totalQuantity,
        isReturn: row.isReturn,
        isPaid: row.isPaid,
        customerName: found?.customerName || p.customerName,
        customerPhone: found?.customerPhone || p.customerPhone,
        amountLabel: row.amountLabel,
        qtyLabel: row.qtyLabel,
        statusLabel: row.statusLabel,
        items: found?.items || [],
      }
    })
    wx.showLoading({ title: '云打印中…', mask: true })
    const job = await submitStatementJob({
      shopName: p.shopName || this.data.shopName,
      customerName: p.customerName,
      customerPhone: p.customerPhone,
      unpaidOnly: p.unpaidOnly,
      rangeLabel: p.rangeLabel,
      printTime: p.printTime,
      title: p.unpaidOnly ? '未付款对账单' : '对账单',
      orders,
      targetClientId: picked.gateway.clientId,
    })
    if (!job.ok || !job.jobNo) {
      wx.hideLoading()
      wx.showToast({ title: job.error || '提交云打印失败', icon: 'none' })
      return false
    }
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
})
