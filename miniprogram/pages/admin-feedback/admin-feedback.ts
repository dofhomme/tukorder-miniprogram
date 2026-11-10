import { deleteAdminFeedback, listAdminFeedback } from './admin'
import type { AdminFeedbackRow } from './admin'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { getSession, isLoggedIn } from '../../services/session'

type Row = AdminFeedbackRow & { displayName: string; createdLabel: string }

Page({
  data: {
    loading: true,
    items: [] as Row[],
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'feedbackTitle')
  },

  onShow() {
    this.applyLocale()
    if (!isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    if (!getSession()?.isAdmin) {
      wx.showToast({ title: '需要管理员账号', icon: 'none' })
      wx.navigateBack()
      return
    }
    void this.load()
  },

  async load() {
    this.setData({ loading: true })
    const r = await listAdminFeedback()
    this.setData({ loading: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '加载失败', icon: 'none' })
      return
    }
    this.setData({
      items: r.items.map((x) => ({
        ...x,
        displayName: (x.userNickname || '').trim() || x.userPhone || t('userWord'),
        roleLabel: (x.roleLabel || '').trim() || (x.role === 'agent' ? '代理' : '商家'),
        createdLabel: (x.createdAt || '').replace('T', ' ').slice(0, 16) || '—',
      })),
    })
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    const row = this.data.items.find((x) => x.id === id)
    const name = row?.displayName || '用户'
    const preview = (row?.message || '').slice(0, 40)
    wx.showModal({
      title: '删除留言',
      content: `确定删除「${name}」的留言？${preview ? `\n\n${preview}${preview.length >= 40 ? '…' : ''}` : ''}`,
      confirmColor: '#e53935',
      success: async (res) => {
        if (!res.confirm) return
        const r = await deleteAdminFeedback(id)
        if (!r.ok) {
          wx.showToast({ title: r.error || '失败', icon: 'none' })
          return
        }
        wx.showToast({ title: '留言已删除', icon: 'success' })
        void this.load()
      },
    })
  },
})
