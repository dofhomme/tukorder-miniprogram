/** 云同步购买记录：只展示现网已付款 */
import {
  decorateBillingOrders,
  fetchBillingOrders,
  type BillingOrderView,
} from '../../services/subscription'
import { isLoggedIn } from '../../services/session'
import { applyCapsuleStyle, capsuleStyleDefaults } from '../../utils/nav'
import { bindPageI18n, i18nState, t } from '../../services/i18n'

type Row = BillingOrderView & { priceNum: string }

function toRows(list: ReturnType<typeof decorateBillingOrders>): Row[] {
  return list.map((o) => ({
    ...o,
    priceNum: (Number(o.priceFen || 0) / 100).toFixed(1).replace(/\.0$/, ''),
  }))
}

Page({
  data: {
    ...capsuleStyleDefaults(),
    loggedIn: false,
    loading: true,
    orders: [] as Row[],
    count: 0,
    countLabel: '',
    totalLabel: '¥0',
    ...i18nState(),
  },

  applySummary(orders: Row[]) {
    const count = orders.length
    const fen = orders.reduce((s, o) => s + (Number(o.priceFen) || 0), 0)
    const yuan = (fen / 100).toFixed(1).replace(/\.0$/, '')
    this.setData({
      orders,
      count,
      countLabel: t('billingDelivered'),
      totalLabel: `¥${yuan}`,
    })
  },

  applyLocale() {
    bindPageI18n(this, 'billingOrders')
    this.applySummary(toRows(decorateBillingOrders(this.data.orders)))
  },

  onLoad() {
    applyCapsuleStyle(this)
    this.applyLocale()
    void this.refresh()
  },

  onShow() {
    this.applyLocale()
    void this.refresh()
  },

  onPullDownRefresh() {
    void this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    const loggedIn = isLoggedIn()
    this.setData({ loggedIn, loading: loggedIn })
    if (!loggedIn) {
      this.applySummary([])
      this.setData({ loading: false })
      return
    }
    const r = await fetchBillingOrders()
    this.applySummary(toRows(decorateBillingOrders(r.orders)))
    this.setData({ loading: false })
  },

  onGoLogin() {
    wx.navigateTo({
      url: '/pages/login/login?return=billing&stay=1',
    })
  },

  goBuy() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
      return
    }
    wx.redirectTo({ url: '/pages/subscription/subscription' })
  },

  onCopy(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '').trim()
    if (!id) return
    wx.setClipboardData({
      data: id,
      success: () => wx.showToast({ title: t('copyOrderNo'), icon: 'none' }),
    })
  },
})
