import {
  clearCloudLink,
  gatewayTitle,
  listGateways,
  loadCloudLink,
  saveCloudLink,
  type PrintGateway,
} from '../../services/cloud-print'
import { bindPageI18n, i18nState } from '../../services/i18n'

interface CloudRow {
  clientId: string
  name: string
  printerName: string
}

Page({
  data: {
    loading: true,
    linked: false,
    linkName: '',
    linkId: '',
    hosts: [] as CloudRow[],
    hint: '',
    ...i18nState(),
  },

  _gen: 0,

  onShow() {
    bindPageI18n(this, 'cloudPrinterTitle')
    wx.setNavigationBarTitle({ title: '云打印机' })
    void this.refresh()
  },

  async refresh() {
    const gen = ++this._gen
    this.setData({ loading: true, hint: '' })
    const saved = loadCloudLink()
    const gw = await listGateways()
    if (gen !== this._gen) return
    const list = gw.gateways || []
    const current = saved
      ? list.find((item) => item.clientId === saved.clientId)
      : undefined
    const online = list.filter((item) => item.online)
    if (current?.online) saveCloudLink(current)
    if (gen !== this._gen) return
    const linked = !!current?.online
    const linkId = (linked ? current?.clientId : saved?.clientId) || ''
    const hosts = online
      .filter((item) => item.clientId !== linkId)
      .map((item) => rowOf(item))
    let hint = ''
    if (!gw.ok) hint = gw.error || '读取失败'
    else if (!hosts.length && !linked) {
      hint = '团队里没有在线的云打印。请在电脑端打开「云打印机」，名称用电脑上保存的显示名。'
    }
    this.setData({
      loading: false,
      linked,
      linkId,
      linkName: linked && current ? gatewayTitle(current) : saved?.name || '',
      hosts,
      hint,
    })
  },

  onPick(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    if (id === this.data.linkId) {
      clearCloudLink()
      this.setData({ linked: false, linkId: '', linkName: '' })
      wx.showToast({ title: '已断开', icon: 'none' })
      void this.refresh()
      return
    }
    if (this.data.loading) return
    const hit = this.data.hosts.find((item) => item.clientId === id)
    if (!hit) return
    saveCloudLink({ clientId: hit.clientId, name: hit.name, online: true })
    wx.showToast({ title: '已连接', icon: 'success' })
    void this.refresh()
  },
})

function rowOf(g: PrintGateway): CloudRow {
  return {
    clientId: g.clientId,
    name: gatewayTitle(g),
    printerName: String(g.printerName || '').trim(),
  }
}
