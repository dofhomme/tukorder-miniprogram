import { bindPageI18n, i18nState } from '../../services/i18n'

Page({
  data: {
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'lookbook')
  },

  onLoad() {
    this.applyLocale()
    wx.switchTab({ url: '/pages/products/products' })
  },

  onShow() {
    wx.switchTab({ url: '/pages/products/products' })
  },
})
