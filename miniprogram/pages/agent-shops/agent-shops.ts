import {
  fetchAgentMe,
  merchantRenewShare,
  unbindAgentShop,
  type AgentBinding,
} from '../../services/lookup'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { peekAgentOwnerId, saveAgentOwnerId } from '../../services/workspace'

type ShopRow = {
  ownerUserId: number
  shopName: string
  customerName: string
  unpaid: string
  merchantExpired: boolean
  isAdmin: boolean
  roleLabel: string
  current: boolean
}

function money(v?: number) {
  const n = Number(v || 0)
  return n ? n.toFixed(2) : ''
}

Page({
  data: {
    ...i18nState(),
    loading: true,
    error: '',
    busyId: 0,
    rows: [] as ShopRow[],
  },

  onLoad() {
    this.applyLocale()
    void this.refresh()
  },

  onShow() {
    this.applyLocale()
  },

  onPullDownRefresh() {
    void this.refresh().finally(() => {
      try {
        wx.stopPullDownRefresh()
      } catch (_) {}
    })
  },

  applyLocale() {
    bindPageI18n(this, 'agentShops')
  },

  toRows(bindings: AgentBinding[]): ShopRow[] {
    const curId = peekAgentOwnerId()
    return (bindings || []).map((b) => {
      const isAdmin = String(b.role || 'admin') !== 'staff'
      return {
        ownerUserId: Number(b.ownerUserId || 0),
        shopName: String(b.shopName || t('stallName')).trim() || t('stallName'),
        customerName: String(b.customerName || '').trim(),
        unpaid: b.merchantExpired ? '' : money(b.unpaidAmount),
        merchantExpired: !!b.merchantExpired,
        isAdmin,
        roleLabel: isAdmin ? t('agentRoleAdmin') : t('agentRoleStaff'),
        current: !!curId && Number(b.ownerUserId) === Number(curId),
      }
    })
  },

  async refresh() {
    this.setData({ loading: true, error: '' })
    const me = await fetchAgentMe(peekAgentOwnerId() || undefined, { home: true })
    if (!me.ok) {
      this.setData({ loading: false, error: me.error || t('loadFailed') })
      return
    }
    const bindings = me.data?.bindings || []
    this.setData({
      loading: false,
      error: '',
      rows: this.toRows(bindings),
    })
  },

  onUnbind(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id || 0)
    const name = String(e.currentTarget.dataset.name || t('stallName'))
    if (!id || this.data.busyId) return
    wx.showModal({
      title: t('agentUnbindShop'),
      content: t('agentUnbindShopAsk').replace('{shop}', name),
      confirmText: t('agentUnbindShop'),
      cancelText: t('cancel'),
      confirmColor: '#be123c',
      success: (r) => {
        if (!r.confirm) return
        void this.doUnbind(id)
      },
    })
  },

  async doUnbind(ownerUserId: number) {
    this.setData({ busyId: ownerUserId })
    wx.showLoading({ title: t('loading'), mask: true })
    const res = await unbindAgentShop(ownerUserId)
    wx.hideLoading()
    this.setData({ busyId: 0 })
    if (!res.ok) {
      wx.showToast({ title: res.error || t('loadFailed'), icon: 'none' })
      return
    }
    if (Number(peekAgentOwnerId()) === Number(ownerUserId)) saveAgentOwnerId(0)
    wx.showToast({ title: t('agentUnbindShopOk'), icon: 'none' })
    const me = await fetchAgentMe(undefined, { home: true })
    const bindings = me.ok ? me.data?.bindings || [] : []
    if (!bindings.length) saveAgentOwnerId(0)
    this.setData({ rows: this.toRows(bindings), error: '' })
  },

  onOpenPlaza() {
    wx.navigateTo({ url: '/pages/agent-plaza/agent-plaza' })
  },

  onShareAppMessage(e: WechatMiniprogram.ShareAppMessageOption) {
    const shop = String((e.target && (e.target as { dataset?: { shop?: string } }).dataset?.shop) || '')
    return merchantRenewShare(shop)
  },
})
