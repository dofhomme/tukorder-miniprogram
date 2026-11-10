import { fetchSupplyAgentOrders, markSupplyAgentPaid } from '../../services/supply'

const PAGE = 10

Page({
  _all: [] as Array<Record<string, unknown>>,
  data: {
    name: '',
    loaded: false,
    more: false,
    items: [] as Array<Record<string, unknown>>,
    picked: {} as Record<string, boolean>,
  },

  onLoad(query: Record<string, string>) {
    this.setData({ name: decodeURIComponent(query.name || '') })
    wx.setNavigationBarTitle({ title: this.data.name || '代理' })
  },

  onShow() { void this.load() },

  async load() {
    const r = await fetchSupplyAgentOrders(this.data.name)
    this._all = r.data?.items || []
    this.setData({
      loaded: true,
      items: this._all.slice(0, PAGE),
      more: this._all.length > PAGE,
      picked: {},
    })
  },

  onMore() {
    if (!this.data.more) return
    const n = this.data.items.length + PAGE
    this.setData({
      items: this._all.slice(0, n),
      more: this._all.length > n,
    })
  },

  onPick(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    const row = (this.data.items || []).find((item) => String(item.id) === id)
    if (!row || row.isPaid || row.isReturn) return
    const picked = { ...this.data.picked, [id]: !this.data.picked[id] }
    this.setData({ picked })
  },

  async onRefund(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id || 0)
    const row = (this.data.items || []).find((item) => Number(item.id) === id)
    if (!id || !row || !row.isReturn || row.isPaid) return
    const r = await markSupplyAgentPaid(this.data.name, [id])
    if (!r.ok) {
      wx.showToast({ title: r.message || '失败', icon: 'none' })
      return
    }
    wx.showToast({ title: '已退款', icon: 'none' })
    void this.load()
  },

  async onPaid() {
    const orderIds = Object.keys(this.data.picked)
      .filter((id) => this.data.picked[id])
      .map((id) => Number(id))
    if (!orderIds.length) {
      wx.showToast({ title: '先勾选未付销售单', icon: 'none' })
      return
    }
    const r = await markSupplyAgentPaid(this.data.name, orderIds)
    if (!r.ok) {
      wx.showToast({ title: r.message || '失败', icon: 'none' })
      return
    }
    wx.showToast({ title: `已收 ${r.data?.count || 0} 单`, icon: 'none' })
    void this.load()
  },
})
