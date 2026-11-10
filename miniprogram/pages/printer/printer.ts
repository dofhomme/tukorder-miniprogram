import {
  connectPrinter,
  disconnectPrinter,
  getPaperWidthMm,
  getSavedPrinter,
  isSamePrinterName,
  prepareBleScan,
  refreshBleStatus,
  setPaperWidthMm,
  startDiscovery,
  stopDiscovery,
  writeBytes,
} from '../../services/bluetooth'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { matchThermalProfile } from '../../services/thermal-device-profiles'
import { printTestPageBytes } from './print-test-page'
import { applyCapsuleStyle, capsuleStyleDefaults } from '../../utils/nav'
import { isPaperWidthMm, type PaperWidthMm } from '../../services/thermal-paper'
import { isLanPrinterId } from '../../services/lan-printer'

type DevView = {
  deviceId: string
  name: string
  RSSI?: number
  printer?: boolean
  current?: boolean
  selected?: boolean
}

const PRINTER_TOKENS = [
  'PRINTER', 'PRINT', 'POS', 'RECEIPT', '打印', '热敏', '票据',
  'B11', 'B12', 'B16', 'B18', 'B21', 'GP-', 'XP-', 'HPRT', 'SUNMI',
  'P58', 'P80', 'MPT-', 'RPP', 'HM-A', 'GOOJPRT', 'MUNBYN',
]

const NOT_PRINTER = [
  'AIRPODS', 'BUDS', 'HEADSET', 'HEADPHONE', 'EARBUD', 'FREECLIP',
  'WATCH', 'BAND', 'SPEAKER', 'KEYBOARD', 'MOUSE', 'HUAWEI FREE',
  '耳机', '手环', '手表', '音箱',
]

function isLikelyPrinter(name?: string): boolean {
  const s = String(name || '').trim()
  if (!s) return false
  const up = s.toUpperCase()
  if (NOT_PRINTER.some((k) => up.includes(k))) return false
  if (PRINTER_TOKENS.some((k) => up.includes(k))) return true
  if (matchThermalProfile(s)) return true
  if (/^B\d{2}-/i.test(s)) return true
  if (/P-?\d{2,4}/i.test(up)) return true
  return false
}

Page({
  data: {
    ...capsuleStyleDefaults(),
    scanning: false,
    connected: false,
    connecting: false,
    testing: false,
    autoConnecting: false,
    connectEnabled: false,
    printers: [] as DevView[],
    others: [] as DevView[],
    deviceTotal: 0,
    savedName: '',
    savedId: '',
    paperWidth: 80 as PaperWidthMm,
    selectedId: '',
    connectedMark: t('connectedPrefix').replace(/[:：\s]+$/, ''),
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'connectPrinter')
    this.setData({
      connectedMark: t('connectedPrefix').replace(/[:：\s]+$/, ''),
    })
  },

  _map: {} as Record<string, DevView>,
  _auto: false,
  _openSheet: false,
  _sheetSearching: true,
  _triedAuto: false,
  _pageReady: false,
  _booting: false,
  _scanGen: 0,
  _connectGen: 0,
  _skipAuto: false,

  onLoad(q: Record<string, string>) {
    this._auto = q.auto === '1' || q.reconnect === '1'
    this._openSheet = q.sheet === '1'
    this._sheetSearching = q.searching !== '0'
  },

  onReady() {
    applyCapsuleStyle(this)
    this._pageReady = true
    void this.runBoot()
  },

  async onShow() {
    this.applyLocale()
    try {
      await this.refreshSaved()
      if (!this._pageReady || this._booting) return
      if (
        !this._openSheet &&
        !this.data.connected &&
        !this.data.scanning &&
        !this.data.connecting
      ) {
        void this.onScan()
      }
    } catch (_) {
      wx.hideLoading()
    }
  },

  async runBoot() {
    if (this._booting) return
    this._booting = true
    try {
      await this.refreshSaved()
      if (this._openSheet) {
        this._openSheet = false
        const sheet = this.selectComponent('#btSheet') as any
        if (sheet && typeof sheet.open === 'function') {
          sheet.open({
            searching: this._sheetSearching,
            title: this._sheetSearching ? '蓝牙搜索中' : '未连接打印机',
            hint: '请打开蓝牙打印机，并确认手机已开启蓝牙与定位权限。',
            printerUrl: 'local',
          })
        }
        return
      }
      this._auto = false
      const saved = getSavedPrinter()
      const bleSaved = !!saved && !isLanPrinterId(saved.deviceId)
      if (bleSaved && !this.data.connected && !this._skipAuto) {
        this.setData({ autoConnecting: true, connecting: true })
        await this.onReconnect()
      } else if (!this.data.connected && !this.data.scanning && !this.data.connecting) {
        await this.onScan()
      }
    } catch (_) {
      wx.hideLoading()
    } finally {
      this._booting = false
    }
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.navigateTo({ url: '/pages/print-settings/print-settings' }) })
  },

  onSheetReconnect() {
    if (this._skipAuto || this.data.connected) void this.onScan()
    else void this.onReconnect()
  },

  onHide() {
    void stopDiscovery()
    this.setData({ scanning: false })
  },

  onUnload() {
    void stopDiscovery()
  },

  async refreshSaved() {
    const raw = getSavedPrinter()
    const s = raw && !isLanPrinterId(raw.deviceId) ? raw : null
    const st = await refreshBleStatus()
    const live = !!s && st.connected
    const selectedId = this.data.selectedId || (live ? s?.deviceId || '' : '')
    this.setData(
      {
        savedName: s?.name || '',
        savedId: s?.deviceId || '',
        connected: live,
        paperWidth: getPaperWidthMm(),
        selectedId,
      },
      () => this.publishLists(),
    )
  },

  onPaper(e: WechatMiniprogram.TouchEvent) {
    const mm = Number(e.currentTarget.dataset.mm)
    if (!isPaperWidthMm(mm)) return
    setPaperWidthMm(mm)
    this.setData({ paperWidth: mm })
    wx.showToast({ title: `已设 ${mm}mm`, icon: 'none' })
  },

  onOpenPerm() {
    wx.openAppAuthorizeSetting({})
  },

  onPairHelp() {
    wx.showModal({
      title: '如何配对打印机',
      content:
        '1. 打开手机的「设置 → 蓝牙」\n2. 打印机开机（B 系列常显示为 B11-xxxx）\n3. 点打印机名称完成配对\n4. 输入 PIN（常见 0000 或 1234）\n5. 回到本页点右上角刷新，选中后点「连接」',
      showCancel: false,
      confirmText: '知道了',
    })
  },

  seedSavedDevice() {
    if (!this.data.connected) return
    const s = getSavedPrinter()
    if (!s?.deviceId || isLanPrinterId(s.deviceId)) return
    const prev = this._map[s.deviceId]
    this._map[s.deviceId] = {
      deviceId: s.deviceId,
      name: s.name || prev?.name || t('printerBadge'),
      RSSI: prev?.RSSI,
      printer: true,
    }
    this.publishLists()
  },

  publishLists() {
    const saved = getSavedPrinter()
    const selectedId = this.data.selectedId
    const connected = this.data.connected
    const all = Object.values(this._map).map((d) => {
      const current =
        connected &&
        !!saved &&
        (d.deviceId === saved.deviceId || isSamePrinterName(d.name, saved.name))
      const printer = d.printer || isLikelyPrinter(d.name) || current
      return {
        ...d,
        printer,
        current,
        selected: d.deviceId === selectedId,
      }
    })
    const printers = all.filter((d) => d.printer).sort((a, b) => {
      if (!!a.current !== !!b.current) return a.current ? -1 : 1
      return (b.RSSI || -999) - (a.RSSI || -999)
    })
    const others = all.filter((d) => !d.printer)
    const canConnect = !this.data.connecting && !!selectedId && !printers.some((d) => d.current && d.deviceId === selectedId)
    this.setData({
      printers,
      others,
      deviceTotal: all.length,
      connectEnabled: canConnect,
    })
  },

  upsertDevice(d: DevView) {
    const saved = getSavedPrinter()
    const old = this._map[d.deviceId]
    let name = (d.name || '').trim()
    if (saved && (d.deviceId === saved.deviceId || isSamePrinterName(name, saved.name))) {
      name = saved.name || name
    }
    const better =
      name && old?.name && name.length > old.name.length && !/^[\da-f-]{8,}$/i.test(name)
        ? name
        : name || old?.name || d.deviceId.slice(-8)
    this._map[d.deviceId] = {
      deviceId: d.deviceId,
      name: better,
      RSSI: d.RSSI != null ? d.RSSI : old?.RSSI,
      printer: isLikelyPrinter(better),
    }
    this.publishLists()
  },

  async onScan() {
    const gen = ++this._scanGen
    this._connectGen++
    wx.hideLoading()
    this.setData({ connecting: false, autoConnecting: false, connectEnabled: false, scanning: true })
    if (!this.data.connected) await prepareBleScan()
    await stopDiscovery()
    if (gen !== this._scanGen) return
    this._map = {}
    if (this.data.connected) this.seedSavedDevice()
    else this.publishLists()
    try {
      const r = await startDiscovery((d) => {
        if (gen !== this._scanGen) return
        this.upsertDevice(d)
      })
      if (gen !== this._scanGen) return
      if (!r.ok) {
        this.setData({ scanning: false })
        const err = r.error || '扫描失败'
        if (/微信.*蓝牙|蓝牙权限/.test(err)) {
          wx.showModal({
            title: '需要蓝牙权限',
            content: err,
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) wx.openAppAuthorizeSetting({})
            },
          })
          return
        }
        wx.showToast({ title: err, icon: 'none' })
        return
      }
      setTimeout(async () => {
        if (gen !== this._scanGen) return
        await stopDiscovery()
        if (gen !== this._scanGen) return
        this.setData({ scanning: false })
      }, 12000)
    } catch (e: any) {
      if (gen !== this._scanGen) return
      this.setData({ scanning: false })
      wx.showToast({ title: e?.message || '扫描失败', icon: 'none' })
    }
  },

  onSelect(e: WechatMiniprogram.TouchEvent) {
    const deviceId = String(e.currentTarget.dataset.id || '')
    if (!deviceId) return
    this.setData({ selectedId: deviceId })
    this.publishLists()
  },

  async onConnectTap() {
    if (!this.data.connectEnabled) return
    const id = this.data.selectedId
    const hit = [...this.data.printers, ...this.data.others].find((d) => d.deviceId === id)
    if (!hit) {
      wx.showToast({ title: '请先点选一台设备', icon: 'none' })
      return
    }
    this.setData({ connecting: true, connectEnabled: false })
    wx.showLoading({ title: '连接中', mask: true })
    try {
      await stopDiscovery()
      this.setData({ scanning: false })
      const r = await Promise.race([
        connectPrinter({ deviceId: hit.deviceId, name: hit.name }),
        new Promise<{ ok: false; error: string }>((resolve) => {
          setTimeout(() => resolve({ ok: false, error: '连接超时，请重新搜索后再连接' }), 15000)
        }),
      ])
      if (!r.ok) {
        await prepareBleScan()
        this.publishLists()
        wx.showModal({
          title: '连接失败',
          content: r.error || '请先在系统蓝牙中配对打印机，再返回连接。常见 PIN：0000 或 1234',
          showCancel: false,
        })
        return
      }
      await this.refreshSaved()
      wx.showToast({ title: '已连接，可点「打印测试页」', icon: 'success' })
    } catch (e: any) {
      this.publishLists()
      wx.showToast({ title: e?.message || '连接失败', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ connecting: false })
      this.publishLists()
    }
  },

  async onReconnect() {
    const saved = getSavedPrinter()
    if (!saved || isLanPrinterId(saved.deviceId) || this._skipAuto) {
      await this.onScan()
      return
    }
    const gen = ++this._connectGen
    this.setData({ autoConnecting: true, connecting: true })
    wx.showLoading({ title: `正在连接 ${saved.name || '打印机'}`, mask: true })
    let result: { ok: boolean; error?: string } = { ok: false, error: '连接失败' }
    try {
      result = await Promise.race([
        connectPrinter({ deviceId: saved.deviceId, name: saved.name }),
        new Promise<{ ok: false; error: string }>((resolve) => {
          setTimeout(() => resolve({ ok: false, error: '连接超时' }), 10000)
        }),
      ])
    } catch (e: any) {
      result = { ok: false, error: e?.message || '连接失败' }
    }
    if (gen !== this._connectGen) return
    wx.hideLoading()
    this.setData({ autoConnecting: false, connecting: false })
    await this.refreshSaved()
    if (result.ok && this.data.connected) {
      wx.showToast({ title: '已连接', icon: 'success' })
      return
    }
    wx.showToast({ title: '未连上，请重新选择', icon: 'none' })
    await this.onScan()
  },

  async onDisconnect() {
    this._skipAuto = true
    this._connectGen++
    wx.hideLoading()
    await disconnectPrinter()
    this._map = {}
    this.setData({ connected: false, selectedId: '', autoConnecting: false, connecting: false }, () => {
      this.publishLists()
      wx.showToast({ title: '已断开，请重新选择', icon: 'none' })
      void this.onScan()
    })
  },

  async onTest() {
    if (!this.data.connected) return
    this.setData({ testing: true })
    wx.showLoading({ title: '打印中', mask: true })
    try {
      const bytes = await printTestPageBytes(this)
      await writeBytes(bytes)
      wx.hideLoading()
      wx.showToast({ title: '测试页已发送', icon: 'success' })
    } catch (e: any) {
      wx.hideLoading()
      wx.showToast({ title: e?.message || '失败', icon: 'none' })
    } finally {
      this.setData({ testing: false })
    }
  },
})
