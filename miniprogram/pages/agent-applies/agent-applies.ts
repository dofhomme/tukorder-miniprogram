import {
  decideMerchantAgentApply,
  fetchMerchantAgentApplies,
  type AgentApplyItem,
  type AgentMergeCandidate,
} from '../../services/lookup'
import { bindPageI18n, i18nState, t } from '../../services/i18n'

Page({
  data: {
    ...i18nState(),
    loading: true,
    error: '',
    busyId: 0,
    items: [] as AgentApplyItem[],
  },

  onLoad() {
    bindPageI18n(this)
    void this.refresh()
  },

  onShow() {
    void this.refresh()
  },

  onPullDownRefresh() {
    void this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    this.setData({ loading: true, error: '' })
    const r = await fetchMerchantAgentApplies('pending')
    this.setData({
      loading: false,
      error: r.ok ? '' : r.error || t('loadFailed'),
      items: r.items || [],
    })
  },

  onDecide(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id || 0)
    const action = String(e.currentTarget.dataset.action || '') as 'approve' | 'reject'
    if (!id || this.data.busyId) return
    if (action === 'reject') {
      void this.runDecide(id, 'reject')
      return
    }
    const item = this.data.items.find((x) => x.id === id)
    const cands = (item && item.mergeCandidates) || []
    if (!cands.length) {
      void this.runDecide(id, 'approve', { createNew: true })
      return
    }
    const first = cands[0]
    const extra = cands.length > 1 ? ` 等${cands.length}个` : ''
    const dataHint =
      first.hasData || (first.orderCount || 0) > 0
        ? `已有${first.orderCount || 0}笔账单`
        : '通讯录已有此客户'
    wx.showModal({
      title: '合并已有客户？',
      content: `${dataHint}「${first.name}」${extra}。合并后名称：${first.mergedName || first.name + '（' + (item && item.displayName) + '）'}`,
      confirmText: '合并',
      cancelText: '新建',
      success: (res) => {
        if (res.confirm) {
          void this.runDecide(id, 'approve', { mergeCustomerUid: first.customerUid })
          return
        }
        if (res.cancel) void this.runDecide(id, 'approve', { createNew: true })
      },
    })
  },

  async runDecide(
    id: number,
    action: 'approve' | 'reject',
    opts?: { mergeCustomerUid?: string; createNew?: boolean },
  ) {
    this.setData({ busyId: id })
    const r = await decideMerchantAgentApply(id, action, opts)
    if (r.ok && r.needMerge && r.candidates.length) {
      this.setData({ busyId: 0 })
      const first = r.candidates[0] as AgentMergeCandidate
      wx.showModal({
        title: '合并已有客户？',
        content: `通讯录已有「${first.name}」。合并后名称：${first.mergedName || first.name}`,
        confirmText: '合并',
        cancelText: '新建',
        success: (res) => {
          if (res.confirm) {
            void this.runDecide(id, 'approve', { mergeCustomerUid: first.customerUid })
            return
          }
          if (res.cancel) void this.runDecide(id, 'approve', { createNew: true })
        },
      })
      return
    }
    this.setData({ busyId: 0 })
    wx.showToast({ title: (r.message || r.error || t('plazaSubmit')).slice(0, 20), icon: 'none' })
    if (r.ok && !r.needMerge) void this.refresh()
  },
})
