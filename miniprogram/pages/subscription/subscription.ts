/**
 * 云同步开通。购买记录在独立页 /pages/subscription/history
 */
import {
  fetchPlanCatalog,
  formatExpireLabel,
  isCloudSyncAllowed,
  planCycle,
  purchasePlan,
  refreshEntitlement,
  fallbackPlanGroups,
  type CatalogGroup,
  type SubPlan,
} from '../../services/subscription'
import {
  hasPendingLocalUpload,
  markPendingLocalUpload,
  scanLocalGuestData,
  summarizeUploadResult,
  uploadLocalGuestDataToCloud,
} from '../../services/guest-migrate'
import { isLoggedIn } from '../../services/session'
import { requestExpireRenewSubscribe } from '../../services/subscribe'
import { applyCapsuleStyle, capsuleStyleDefaults } from '../../utils/nav'
import { bindPageI18n, i18nState, t } from '../../services/i18n'

Page({
  data: {
    ...capsuleStyleDefaults(),
    groups: fallbackPlanGroups(),
    selected: 'yearly' as SubPlan,
    statusLabel: t('cloudOff'),
    expireLabel: '',
    active: false,
    grantSource: 'none',
    selectedCycle: 'year',
    loading: false,
    uploading: false,
    progressText: '',
    fromUpload: false,
    fromSupply: false,
    loggedIn: false,
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'subTitlePage')
    const groups = (this.data.groups as CatalogGroup[]).map((g) => ({
      ...g,
      title: g.id === 'team' ? t('pkgTeam') : g.id === 'basic' ? t('pkgBasic') : g.title,
      seatHint: t('seatHint').replace('{n}', String(g.seatLimit || 0)),
    }))
    this.setData({
      groups,
      statusLabel: this.data.active
        ? this.data.grantSource === 'shop_seat'
          ? t('cloudOnSeat')
          : t('cloudOnFull')
        : this.data.statusLabel === t('pleaseLogin') || !isLoggedIn()
          ? t('pleaseLogin')
          : t('cloudOff'),
    })
  },

  onLoad(query: Record<string, string | undefined>) {
    applyCapsuleStyle(this)
    const from = String(query?.from || '')
    this.setData({
      fromUpload: from === 'upload' || hasPendingLocalUpload(),
      fromSupply: from === 'supply',
    })
    this.applyLocale()
    void this.refresh()
  },

  onShow() {
    this.applyLocale()
    void this.refresh()
  },

  async refresh() {
    const loggedIn = isLoggedIn()
    this.setData({ loggedIn })
    if (!loggedIn) {
      this.setData({
        active: false,
        statusLabel: t('pleaseLogin'),
        expireLabel: '',
      })
      return
    }
    const e = await refreshEntitlement({ force: true })
    const active = isCloudSyncAllowed()
    const groups = await fetchPlanCatalog()
    const localized = groups.map((g) => ({
      ...g,
      title: g.id === 'team' ? t('pkgTeam') : g.id === 'basic' ? t('pkgBasic') : g.title,
      seatHint: t('seatHint').replace('{n}', String(g.seatLimit || 0)),
    }))
    this.setData({
      active,
      grantSource: e.grantSource || 'none',
      groups: localized,
      statusLabel: active
        ? e.grantSource === 'shop_seat'
          ? t('cloudOnSeat')
          : t('cloudOnFull')
        : e.status === 'expired'
          ? t('expired')
          : t('cloudOff'),
      expireLabel: active ? formatExpireLabel(e) : '',
    })
  },

  onGoLogin() {
    const ret = this.data.fromSupply ? 'supply' : 'subscription'
    wx.navigateTo({
      url: `/pages/login/login?return=${ret}&stay=1`,
    })
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/subscription/history' })
  },

  onSelect(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '') as SubPlan
    if (id !== 'monthly' && id !== 'yearly' && id !== 'team_monthly' && id !== 'team_yearly') {
      return
    }
    this.setData({ selected: id, selectedCycle: planCycle(id) })
    if (this.data.active) void requestExpireRenewSubscribe()
  },

  async onPurchase() {
    if (this.data.loading || this.data.uploading) return
    if (!isLoggedIn()) {
      this.onGoLogin()
      return
    }
    const wasActive = isCloudSyncAllowed()
    this.setData({ loading: true })
    const r = await purchasePlan(this.data.selected, {
      onPaid: () => {
        setTimeout(() => {
          wx.showToast({
            title: '支付成功',
            icon: 'success',
            duration: 1200,
          })
        }, 200)
      },
    })
    this.setData({ loading: false })
    if (!r.ok) {
      const tip = (r.error || (wasActive ? '续费失败' : '开通失败')).slice(0, 80)
      if (r.paid) {
        wx.showModal({
          title: '支付已完成',
          content: tip,
          showCancel: false,
          confirmText: '知道了',
        })
      } else {
        setTimeout(() => {
          wx.showToast({ title: tip.slice(0, 28), icon: 'none', duration: 2500 })
        }, 200)
      }
      void this.refresh()
      return
    }

    await this.refresh()
    const doneTitle =
      r.entitlement?.source === 'local_mock'
        ? wasActive
          ? '续费成功(调试)'
          : '开通成功(调试)'
        : wasActive
          ? '续费成功'
          : '开通成功'
    if (wasActive) {
      markPendingLocalUpload(false)
      setTimeout(() => {
        wx.showToast({ title: doneTitle, icon: 'success', duration: 1600 })
      }, 200)
      this.leaveToSupply()
      return
    }
    if (scanLocalGuestData().hasData) {
      setTimeout(() => {
        wx.showToast({
          title: '开通成功，正在补齐空缺数据',
          icon: 'none',
          duration: 1500,
        })
      }, 200)
      await this.runUpload()
      this.leaveToSupply()
      return
    }
    setTimeout(() => {
      wx.showToast({ title: doneTitle, icon: 'success', duration: 1600 })
    }, 200)
    this.leaveToSupply()
  },

  leaveToSupply() {
    if (!this.data.fromSupply || !isCloudSyncAllowed()) return
    setTimeout(() => wx.switchTab({ url: '/pages/chain/chain' }), 700)
  },

  async runUpload() {
    if (this.data.uploading) return
    if (!isCloudSyncAllowed()) {
      wx.showToast({ title: '请先开通云同步', icon: 'none' })
      return
    }
    this.setData({ uploading: true, progressText: '准备上传…' })
    const r = await uploadLocalGuestDataToCloud({
      onProgress: (p) => {
        this.setData({
          progressText: `正在同步${p.phase} ${p.current}/${p.total || 1}`,
        })
      },
    })
    this.setData({ uploading: false, progressText: '' })
    if (!r.ok) {
      wx.showModal({
        title: '同步未完成',
        content: r.error || '请稍后在「我的 → 同步」重试',
        showCancel: false,
      })
      return
    }
    wx.showModal({
      title: '已对齐云端',
      content: summarizeUploadResult(r),
      showCancel: false,
    })
  },

  onUploadOnly() {
    void this.runUpload()
  },
})
