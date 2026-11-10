import { fetchAgentMe, updateAgentProfile } from '../../services/lookup'
import { assertMsgSecCheck } from '../../services/sec-check'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { peekAgentOwnerId, saveAgentProfileOk } from '../../services/workspace'

Page({
  data: {
    loading: true,
    saving: false,
    error: '',
    gate: false,
    shopName: '',
    customerName: '',
    phone: '',
    ownerUserId: 0,
    isAdmin: true,
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'agentEditProfile')
    wx.setNavigationBarTitle({ title: t('agentEditProfile') })
  },

  onLoad(query: Record<string, string | undefined>) {
    const gate = String(query.gate || '') === '1'
    this.setData({ gate })
    this.applyLocale()
    void this.refresh()
  },

  onShow() {
    this.applyLocale()
  },

  onName(e: WechatMiniprogram.Input) {
    this.setData({ customerName: String(e.detail.value || '') })
  },

  onPhone(e: WechatMiniprogram.Input) {
    this.setData({ phone: String(e.detail.value || '') })
  },

  async refresh() {
    this.setData({ loading: true, error: '' })
    const me = await fetchAgentMe(peekAgentOwnerId() || undefined, { home: true })
    if (!me.ok) {
      this.setData({
        loading: false,
        error: me.error || t('loadFailed'),
      })
      return
    }
    const cur = me.data?.current
    const profile = me.data?.profile
    this.setData({
      loading: false,
      shopName: cur?.shopName || t('allShops'),
      customerName: String(profile?.displayName || cur?.customerName || '').trim(),
      phone: String(profile?.phone || cur?.phone || '').trim(),
      ownerUserId: cur?.ownerUserId || 0,
      isAdmin: true,
    })
  },

  async onSave() {
    if (this.data.saving) return
    const name = String(this.data.customerName || '').trim()
    if (!name) {
      wx.showToast({ title: t('agentNameRequired'), icon: 'none' })
      return
    }
    const phone = String(this.data.phone || '').trim()
    if (!(await assertMsgSecCheck([name, phone].filter(Boolean)))) return
    this.setData({ saving: true })
    const res = await updateAgentProfile({
      displayName: name,
      phone,
      ownerUserId: this.data.ownerUserId || undefined,
    })
    this.setData({ saving: false })
    if (!res.ok) {
      wx.showToast({ title: res.error || t('loadFailed'), icon: 'none' })
      return
    }
    saveAgentProfileOk(true)
    this.setData({
      customerName: res.displayName || name,
      phone: res.phone || phone,
    })
    wx.showToast({ title: t('agentProfileSaved'), icon: 'none' })
    if (this.data.gate) {
      setTimeout(() => {
        wx.switchTab({ url: '/pages/home/home' })
      }, 320)
    }
  },
})
