import {
  applyAgentShop,
  fetchAgentMe,
  fetchAgentPlaza,
  plazaLogoSrc,
  type PlazaShop,
} from '../../services/lookup'
import { requestAgentApplyResultSubscribe } from '../../services/subscribe'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { saveAgentOwnerId } from '../../services/workspace'

Page({
  data: {
    loading: true,
    error: '',
    hasMore: false,
    shops: [] as Array<PlazaShop & { logoSrc: string; shopMark: string; arrivalText: string; btnText: string }>,
    applyOpen: false,
    applyShopName: '',
    applyName: '',
    applyPhone: '',
    applyNote: '',
    applyBusy: false,
    ...i18nState(),
  },

  _page: 1,
  _applyOwnerId: 0,

  applyLocale() {
    bindPageI18n(this, 'plazaTitle')
    wx.setNavigationBarTitle({ title: t('plazaTitle') })
  },

  onLoad() {
    this.applyLocale()
    void this.bootstrap()
  },

  onShow() {
    this.applyLocale()
    if (this.data.shops.length) void this.load(true)
  },

  onPullDownRefresh() {
    void this.load(true).then(() => wx.stopPullDownRefresh())
  },

  plazaBtnText(status: string) {
    if (status === 'joined') return t('plazaEnter')
    if (status === 'pending') return t('plazaPending')
    return t('plazaApply')
  },

  mapPlaza(shops: PlazaShop[]) {
    return shops.map((s) => ({
      ...s,
      logoSrc: plazaLogoSrc(s),
      shopMark: String(s.shopName || '档').slice(0, 1),
      arrivalText: t('newArrivalCount').replace('{n}', String(s.newArrivalCount || 0)),
      btnText: this.plazaBtnText(String(s.applyStatus || '')),
    }))
  },

  async bootstrap() {
    const me = await fetchAgentMe(undefined, { home: true })
    const name = String(me.data?.profile?.displayName || me.data?.current?.customerName || '').trim()
    const phone = String(me.data?.profile?.phone || me.data?.current?.phone || '').trim()
    this.setData({ applyName: name, applyPhone: phone })
    await this.load(true)
  },

  async load(reset: boolean) {
    const page = reset ? 1 : (this._page || 1) + 1
    this.setData({ loading: true })
    const plaza = await fetchAgentPlaza({ page })
    this._page = page
    const shops = plaza.ok ? this.mapPlaza(plaza.shops) : this.data.shops
    this.setData({
      loading: false,
      shops: plaza.ok ? (reset ? shops : this.data.shops.concat(shops)) : this.data.shops,
      hasMore: plaza.ok ? !!plaza.hasMore : this.data.hasMore,
      error: plaza.ok ? '' : (plaza.error || t('loadFailed')),
    })
  },

  onMore() {
    if (!this.data.hasMore || this.data.loading) return
    void this.load(false)
  },

  onEnter(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id || 0)
    const status = String(e.currentTarget.dataset.status || '')
    const name = String(e.currentTarget.dataset.name || '')
    if (!id) return
    if (status === 'joined') {
      saveAgentOwnerId(id)
      wx.switchTab({ url: '/pages/home/home' })
      return
    }
    if (status === 'pending') {
      wx.showToast({ title: t('plazaPending'), icon: 'none' })
      return
    }
    this._applyOwnerId = id
    this.setData({
      applyOpen: true,
      applyShopName: name,
      applyNote: '',
    })
  },

  noop() {},

  onCloseApply() {
    this.setData({ applyOpen: false })
  },

  onApplyName(e: WechatMiniprogram.Input) {
    this.setData({ applyName: e.detail.value })
  },

  onApplyPhone(e: WechatMiniprogram.Input) {
    this.setData({ applyPhone: e.detail.value })
  },

  onApplyNote(e: WechatMiniprogram.Input) {
    this.setData({ applyNote: e.detail.value })
  },

  async onSubmitApply() {
    if (this.data.applyBusy) return
    const name = String(this.data.applyName || '').trim()
    if (!name) {
      wx.showToast({ title: t('plazaNamePh'), icon: 'none' })
      return
    }
    const ownerId = this._applyOwnerId
    if (!ownerId) return
    this.setData({ applyBusy: true })
    await requestAgentApplyResultSubscribe()
    const r = await applyAgentShop({
      ownerUserId: ownerId,
      displayName: name,
      phone: String(this.data.applyPhone || '').trim(),
      note: String(this.data.applyNote || '').trim(),
    })
    this.setData({ applyBusy: false, applyOpen: false })
    wx.showToast({ title: (r.message || r.error || t('plazaSubmit')).slice(0, 20), icon: 'none' })
    void this.load(true)
  },
})
