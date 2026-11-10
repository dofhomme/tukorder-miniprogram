import { fetchSupplyMargin } from '../../services/supply'

const PAGE = 10

Page({
  _all: [] as Array<Record<string, unknown>>,
  data: {
    loaded: false,
    more: false,
    code: '',
    items: [] as Array<Record<string, unknown>>,
  },
  onLoad(query: Record<string, string>) {
    const code = decodeURIComponent(query.code || '').trim()
    const q = code ? `&code=${encodeURIComponent(code)}` : ''
    wx.redirectTo({ url: `/pages/analytics/analytics?tab=2${q}` })
  },
  onShow() {},
  onJump(e: WechatMiniprogram.TouchEvent) {
    const to = String(e.currentTarget.dataset.to || '')
    const code = encodeURIComponent(String(e.currentTarget.dataset.code || ''))
    if (!code) return
    if (to === 'style') wx.navigateTo({ url: `/pages/supply/styles?code=${code}` })
    if (to === 'cost') wx.navigateTo({ url: `/pages/supply/cost?code=${code}` })
    if (to === 'sales') wx.navigateTo({ url: `/pages/analytics/analytics?tab=2&code=${code}` })
  },
  async load() {
    const code = this.data.code
    const r = await fetchSupplyMargin(code || undefined)
    const body = (r.data || {}) as { item?: Record<string, unknown>; items?: Array<Record<string, unknown>> }
    const items = (code ? (body.item ? [body.item] : []) : (body.items || [])) as Array<Record<string, unknown>>
    this._all = items.map((item) => ({
      ...item,
      marginText: item.margin == null ? '还没有成衣成本' : `毛利 ¥${item.margin}`,
    }))
    this.setData({
      loaded: true,
      items: this._all.slice(0, PAGE),
      more: this._all.length > PAGE,
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
})
