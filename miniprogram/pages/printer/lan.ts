import { connectLanPrinter, disconnectPrinter, getSavedPrinter } from '../../services/bluetooth'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { isLanAlive, lanEndpointFromId, scanLan, type LanFoundPrinter } from '../../services/lan-printer'

function savedLan(): { host: string; port: number; name: string } {
  const saved = getSavedPrinter()
  const ep = lanEndpointFromId(saved?.deviceId)
  if (!ep) return { host: '', port: 9100, name: '' }
  return { host: ep.host, port: ep.port, name: saved?.name || ep.host }
}

Page({
  data: {
    scanning: false,
    connecting: false,
    hosts: [] as LanFoundPrinter[],
    current: '',
    currentPort: 9100,
    currentName: '',
    connected: false,
    hint: '',
    ...i18nState(),
  },

  _booted: false,

  applyLocale() {
    bindPageI18n(this, 'lanTitle')
  },

  onShow() {
    this.applyLocale()
    this.refresh()
    if (!this._booted) {
      this._booted = true
      void this.scan()
    }
  },

  refresh() {
    const saved = savedLan()
    this.setData({
      current: saved.host,
      currentPort: saved.port,
      currentName: saved.name,
      connected: !!saved.host && isLanAlive(saved.host),
    })
  },

  async scan() {
    if (this.data.scanning || this.data.connecting) return
    this.setData({ scanning: true, hosts: [], hint: '' })
    try {
      const found = await scanLan()
      const current = savedLan().host
      this.setData({
        hosts: found.filter((item) => item.host !== current),
        hint: found.length ? '' : t('lanScanEmpty'),
      })
    } catch (e: any) {
      this.setData({ hint: e?.message || '扫描失败' })
    } finally {
      this.setData({ scanning: false })
      this.refresh()
    }
  },

  onRescan() {
    if (this.data.scanning || this.data.connecting) return
    void this.scan()
  },

  async onPick(e: WechatMiniprogram.TouchEvent) {
    const ip = String(e.currentTarget.dataset.ip || '')
    const port = Number(e.currentTarget.dataset.port || 9100) || 9100
    const name = String(e.currentTarget.dataset.name || '')
    if (!ip || this.data.connecting || this.data.scanning) return
    if (ip === this.data.current && this.data.connected) {
      await disconnectPrinter()
      this.refresh()
      wx.showToast({ title: '已断开', icon: 'none' })
      return
    }
    this.setData({ connecting: true })
    wx.showLoading({ title: '连接中', mask: true })
    let fail = ''
    let ok = false
    try {
      const r = await connectLanPrinter(ip, port, name)
      ok = !!r.ok
      if (!r.ok) fail = r.error || '连接失败'
    } catch (err: any) {
      fail = err?.message || '连接失败'
    } finally {
      wx.hideLoading()
      this.setData({ connecting: false })
      this.refresh()
    }
    if (ok) {
      this.setData({ hosts: this.data.hosts.filter((item) => item.host !== ip) })
      wx.showToast({ title: '已连接', icon: 'success' })
      return
    }
    wx.showModal({ title: '连接失败', content: fail || '连接失败', showCancel: false })
  },
})
