import { genJobNo } from '../../services/api'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { isLoggedIn } from '../../services/session'
import { fetchCatalog, fetchStockMovements, patchCatalog, uploadStockMovements } from '../../services/team'
import type { StockMovement } from '../../services/team'
import { applySkuStock, isSkuProduct } from '../../services/product-sku'
import { takeVoiceJump } from '../../services/voice-jump'

Page({
  data: { list: [] as StockMovement[], ...i18nState() },

  applyLocale() {
    bindPageI18n(this, 'stockLedger')
  },

  onShow() {
    this.applyLocale()
    if (!isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    const jump = takeVoiceJump('stock')
    if (jump && jump.keyword) {
      wx.showToast({ title: `货号 ${jump.keyword}`, icon: 'none' })
    }
    void this.load()
  },
  async load() {
    const r = await fetchStockMovements(300)
    if (!r.ok) {
      wx.showToast({ title: r.error || '加载失败', icon: 'none' })
      return
    }
    this.setData({ list: r.list })
  },
  onAdd() {
    wx.showModal({
      title: '登记库存',
      editable: true,
      placeholderText: '货号',
      success: async (res) => {
        if (!res.confirm) return
        const code = (res.content || '').trim()
        if (!code) return
        const cat = await fetchCatalog()
        const p = (cat.products || []).find((x) => x.code === code)
        const name = p?.name || code
        if (p && isSkuProduct(p)) {
          wx.navigateTo({
            url: `/pages/product-edit/product-edit?code=${encodeURIComponent(code)}`,
          })
          wx.showToast({ title: '该款请在商品页改各色码库存', icon: 'none' })
          return
        }
        const before = p?.stock != null ? Number(p.stock) : 0
        wx.showModal({
          title: '变动数量（正入库/负出库）',
          editable: true,
          placeholderText: '例如 10 或 -3',
          success: async (res2) => {
            if (!res2.confirm) return
            const qty = Number(res2.content)
            if (!Number.isFinite(qty) || qty === 0) {
              wx.showToast({ title: '数量无效', icon: 'none' })
              return
            }
            const after = before + qty
            const mv: StockMovement = {
              cloudUid: genJobNo(),
              productCode: code,
              productName: name,
              type: qty > 0 ? 'in' : 'out',
              quantity: qty,
              stockBefore: before,
              stockAfter: after,
              createdAt: new Date().toISOString(),
            }
            const up = await uploadStockMovements([mv])
            if (!up.ok) {
              wx.showToast({ title: up.error || '失败', icon: 'none' })
              return
            }
            if (p) {
              await patchCatalog([applySkuStock(p, qty)])
            }
            wx.showToast({ title: '已登记', icon: 'success' })
            void this.load()
          },
        })
      },
    })
  },
})
