import { searchAgentCode } from '../../services/lookup'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { peekAgentOwnerId, saveAgentOwnerId } from '../../services/workspace'

type Hit = {
  ownerUserId: number
  shopName: string
  customerName: string
  code: string
  name: string
  coverUrl: string
  stockLevel: string
  stockLabel: string
  priceLabel: string
  current: boolean
}

function stockLabelOf(level?: string) {
  if (level === 'out') return t('lookStockOut')
  if (level === 'low') return t('lookStockLow')
  return t('lookStockIn')
}

Page({
  data: {
    q: '',
    loading: true,
    hits: [] as Hit[],
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'whoHas')
  },

  onLoad(query: Record<string, string | undefined>) {
    this.applyLocale()
    const q = String(query?.q || '').trim()
    this.setData({ q })
    void this.refresh(q)
  },

  onShow() {
    this.applyLocale()
  },

  async refresh(q: string) {
    if (!q) {
      this.setData({ loading: false, hits: [] })
      return
    }
    this.setData({ loading: true })
    const r = await searchAgentCode(q)
    if (!r.ok) {
      this.setData({ loading: false, hits: [] })
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    const cur = Number(peekAgentOwnerId() || 0)
    const hits = ((r.ok && r.data?.hits) || []).map((h) => ({
      ownerUserId: Number(h.ownerUserId || 0),
      shopName: String(h.shopName || ''),
      customerName: String(h.customerName || ''),
      code: String(h.code || q),
      name: String(h.name || ''),
      coverUrl: String(h.coverUrl || ''),
      stockLevel: String(h.stockLevel || 'in'),
      stockLabel: stockLabelOf(h.stockLevel),
      priceLabel: Number(h.price || 0).toFixed(2),
      current: Number(h.ownerUserId || 0) === cur,
    }))
    this.setData({ loading: false, hits })
  },

  onOpen(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id || 0)
    const code = String(e.currentTarget.dataset.code || this.data.q || '')
    if (!id) return
    saveAgentOwnerId(id)
    try {
      wx.setStorageSync('tuk_agent_catalog_q', code)
    } catch (_) {}
    wx.switchTab({ url: '/pages/products/products' })
  },
})
