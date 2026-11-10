import { i18nState, t } from '../../services/i18n'
import { PRINT_MODE_OPTIONS, defaultPrintSettings, flushPushPrintSettings, fontScaleLabel, loadPrintSettings, printModeLabel, savePrintSettings } from '../../services/print-settings'
import type { PrintModeId, PrintSettings } from '../../services/print-settings'
import { canEditPrintTemplate } from '../../services/print-template'
import { requireCloudSync } from '../../services/account-gate'
import { getSavedPrinter } from '../../services/bluetooth'
import { cloudLinkStatus } from '../../services/cloud-print'
import { isLanAlive, lanEndpointFromId } from '../../services/lan-printer'

function phoneNetwork(): Promise<string> {
  return new Promise((resolve) => {
    wx.getNetworkType({
      success: (res) => resolve(String(res.networkType || '')),
      fail: () => resolve(''),
    })
  })
}

Page({
  data: {
    s: defaultPrintSettings() as PrintSettings,
    fontLabel: t('fontStd'),
    modeLabel: t('modeDefault'),
    canEditTemplate: false,
    lanStatus: '',
    cloudStatus: '查看团队里的在线云打印',
    ...i18nState(),
  },

  _stepTimer: 0 as number,
  _toastTimer: 0 as number,
  _saveGen: 0,
  _lanGen: 0,
  _onNet: null as null | ((res: { isConnected: boolean; networkType: string }) => void),

  applyLocale() {
    const s = this.data.s
    this.setData({
      ...i18nState(),
      fontLabel: fontScaleLabel(s.printFontScale),
      modeLabel: printModeLabel(s.printMode),
    })
    wx.setNavigationBarTitle({ title: t('printSettings') })
  },

  async onShow() {
    this.applyLocale()
    this.watchNetwork()
    void this.refreshLanStatus()
    void this.refreshCloudStatus()
    this.reload()
  },

  onHide() {
    this.unwatchNetwork()
    this.flushPending()
  },

  onUnload() {
    this.unwatchNetwork()
    this.flushPending()
    if (this._toastTimer) clearTimeout(this._toastTimer)
  },

  watchNetwork() {
    if (this._onNet) return
    this._onNet = (res) => {
      void this.refreshLanStatus(res.networkType)
    }
    wx.onNetworkStatusChange(this._onNet)
  },

  unwatchNetwork() {
    if (!this._onNet) return
    wx.offNetworkStatusChange(this._onNet)
    this._onNet = null
  },

  /** 没保存过打印机时保留说明；保存过则按当前 Wi-Fi 和本次连接显示已连接或已断开。 */
  async refreshLanStatus(networkType?: string) {
    const gen = ++this._lanGen
    const ep = lanEndpointFromId(getSavedPrinter()?.deviceId)
    let lanStatus = t('lanSub')
    if (ep) {
      const type = networkType == null ? await phoneNetwork() : networkType
      if (gen !== this._lanGen) return
      const linked = type === 'wifi' && isLanAlive(ep.host)
      lanStatus = linked ? `${t('connectedPrefix')}${ep.host}` : t('lanDisconnected')
    }
    if (gen !== this._lanGen) return
    this.setData({
      canEditTemplate: canEditPrintTemplate(),
      lanStatus,
    })
  },

  async refreshCloudStatus() {
    const cloudStatus = await cloudLinkStatus()
    if (!this.data) return
    this.setData({ cloudStatus })
  },

  flushPending() {
    if (this._stepTimer) {
      clearTimeout(this._stepTimer)
      this._stepTimer = 0
      try {
        savePrintSettings(this.data.s)
      } catch (_) {}
    }
    void flushPushPrintSettings()
  },

  reload() {
    const s = loadPrintSettings()
    this.setData({
      s,
      fontLabel: fontScaleLabel(s.printFontScale),
      modeLabel: printModeLabel(s.printMode),
    })
  },

  _hintSaved() {
    if (this._toastTimer) clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(() => {
      wx.showToast({ title: '已保存', icon: 'none', duration: 900 })
    }, 450) as unknown as number
  },

  /** 立即落盘；步进器可 debounce，避免连点多次写盘 */
  persist(s: PrintSettings, opts?: { debounce?: boolean; silent?: boolean }) {
    const run = () => {
      const gen = ++this._saveGen
      try {
        const saved = savePrintSettings(s)
        if (gen !== this._saveGen) return
        this.setData({
          s: saved,
          fontLabel: fontScaleLabel(saved.printFontScale),
          modeLabel: printModeLabel(saved.printMode),
        })
        if (!opts?.silent) this._hintSaved()
      } catch (_) {
        if (gen !== this._saveGen) return
        wx.showToast({ title: '保存失败，请重试', icon: 'none' })
        this.reload()
      }
    }
    if (this._stepTimer) clearTimeout(this._stepTimer)
    if (opts?.debounce) {
      this.setData({
        s,
        fontLabel: fontScaleLabel(s.printFontScale),
        modeLabel: printModeLabel(s.printMode),
      })
      this._stepTimer = setTimeout(run, 280) as unknown as number
      return
    }
    run()
  },

  patch(partial: Partial<PrintSettings>, opts?: { debounce?: boolean }) {
    const s = { ...this.data.s, ...partial }
    this.persist(s, opts)
  },

  onToggle(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || '') as keyof PrintSettings
    if (!key) return
    const cur = this.data.s[key]
    if (typeof cur !== 'boolean') return
    this.patch({ [key]: !cur } as Partial<PrintSettings>)
  },

  onStepMinus() {
    const n = this.data.s.printMissingCorrection
    if (n <= 0) return
    this.patch({ printMissingCorrection: n - 1 }, { debounce: true })
  },

  onStepPlus() {
    const n = this.data.s.printMissingCorrection
    if (n >= 99) return
    this.patch({ printMissingCorrection: Math.min(99, n + 1) }, { debounce: true })
  },

  onPickMode() {
    wx.showActionSheet({
      itemList: PRINT_MODE_OPTIONS.map((x) => printModeLabel(x.id)),
      success: (res) => {
        const opt = PRINT_MODE_OPTIONS[res.tapIndex]
        if (!opt) return
        this.patch({ printMode: opt.id as PrintModeId })
      },
    })
  },

  onBluetooth() {
    wx.navigateTo({
      url: '/pages/printer/printer',
      fail: () => {
        wx.redirectTo({ url: '/pages/printer/printer' })
      },
    })
  },

  onWifi() {
    wx.navigateTo({ url: '/pages/printer/lan' })
  },

  onTemplate() {
    wx.navigateTo({ url: '/pages/print-template/print-template' })
  },

  onCloud() {
    if (!requireCloudSync('print_cloud')) return
    wx.navigateTo({ url: '/pages/cloud-printer/cloud-printer' })
  },
})
