import { deleteAdminUser, grantUserTrial, listAdminUsers, updateAdminUser } from './admin'
import type { AdminUserRow } from './admin'
import { bindPageI18n, i18nState } from '../../services/i18n'
import { getSession, isLoggedIn } from '../../services/session'

type Row = AdminUserRow & { createdLabel: string }

Page({
  data: {
    loading: true,
    loadError: '',
    users: [] as Row[],
    myPhone: '',
    adminPhone: '',
    menuId: 0,
    showEdit: false,
    editId: 0,
    editPhone: '',
    editPwd: '',
    editNick: '',
    editClient: '',
    editIsAdmin: false,
    trialUserId: 0,
    trialPhone: '',
    trialDays: '7',
    trialSaving: false,
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'usersTitle')
  },

  _menuUser: null as Row | null,

  onShow() {
    this.applyLocale()
    if (!isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    const s = getSession()
    if (!s?.isAdmin) {
      wx.showToast({ title: '需要管理员账号', icon: 'none' })
      wx.navigateBack()
      return
    }
    this.setData({ myPhone: s.phone || '', adminPhone: s.phone || '' })
    void this.load()
  },

  onTrial(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    const u = this.data.users.find((x) => x.id === id)
    if (!u) return
    if (u.paid) {
      wx.showToast({ title: '该账号已付费', icon: 'none' })
      return
    }
    this.setData({ trialUserId: u.id, trialPhone: u.phone, trialDays: '7' })
  },

  onTrialDays(e: WechatMiniprogram.Input) {
    this.setData({ trialDays: e.detail.value })
  },

  onTrialCancel() {
    this.setData({ trialUserId: 0, trialPhone: '' })
  },

  async onGrantTrial() {
    if (this.data.trialSaving || !this.data.trialUserId) return
    const days = Number(String(this.data.trialDays || '').trim())
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      wx.showToast({ title: '天数填 1 到 365', icon: 'none' })
      return
    }
    this.setData({ trialSaving: true })
    const r = await grantUserTrial(this.data.trialUserId, Math.floor(days))
    this.setData({ trialSaving: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '开通失败', icon: 'none' })
      return
    }
    this.setData({ trialUserId: 0, trialPhone: '' })
    wx.showToast({ title: '已开通试用', icon: 'success' })
    void this.load()
  },

  noop() {},

  async load() {
    this.setData({ loading: true, loadError: '' })
    const r = await listAdminUsers()
    if (!r.ok) {
      this.setData({
        loading: false,
        users: [],
        loadError: r.error || '加载失败',
      })
      wx.showToast({ title: r.error || '加载失败', icon: 'none' })
      return
    }
    const admin = r.users.find((u) => u.isAdmin)
    this.setData({
      loading: false,
      loadError: '',
      adminPhone: admin?.phone || this.data.myPhone || '',
      users: r.users.map((u) => ({
        ...u,
        createdLabel: (u.createdAt || '').replace('T', ' ').slice(0, 16) || '—',
        trialBtn: u.paid
          ? '已付费'
          : String(u.accessLabel || '').indexOf('试用至') === 0
            ? '改试用'
            : '开通试用',
      })),
    })
  },

  onMore(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    const u = this.data.users.find((x) => x.id === id) || null
    this._menuUser = u
    this.setData({ menuId: id })
  },

  onCloseMenu() {
    this.setData({ menuId: 0 })
    this._menuUser = null
  },

  onEdit(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id)
    const u = this.data.users.find((x) => x.id === id)
    if (!u) return
    this.openEdit(u)
  },

  onMenuEdit() {
    const u = this._menuUser
    this.setData({ menuId: 0 })
    if (u) this.openEdit(u)
  },

  onMenuCopy() {
    const u = this._menuUser
    this.setData({ menuId: 0 })
    if (!u?.clientId) {
      wx.showToast({ title: '无 clientId', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: u.clientId,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
    })
  },

  openEdit(u: Row) {
    this.setData({
      showEdit: true,
      editId: u.id,
      editPhone: u.phone,
      editPwd: '',
      editNick: u.nickname || '',
      editClient: u.clientId || '',
      editIsAdmin: !!u.isAdmin,
    })
  },

  onEditCancel() {
    this.setData({ showEdit: false })
  },

  onEditPhone(e: WechatMiniprogram.Input) {
    this.setData({ editPhone: e.detail.value })
  },
  onEditPwd(e: WechatMiniprogram.Input) {
    this.setData({ editPwd: e.detail.value })
  },
  onEditNick(e: WechatMiniprogram.Input) {
    this.setData({ editNick: e.detail.value })
  },
  onEditClient(e: WechatMiniprogram.Input) {
    this.setData({ editClient: e.detail.value })
  },

  async onEditSave() {
    const r = await updateAdminUser({
      userId: this.data.editId,
      phone: this.data.editPhone.trim(),
      password: this.data.editPwd || undefined,
      nickname: this.data.editNick.trim(),
      clientId: this.data.editClient.trim(),
    })
    if (!r.ok) {
      wx.showToast({ title: r.error || '保存失败', icon: 'none' })
      return
    }
    this.setData({ showEdit: false })
    wx.showToast({ title: '已保存', icon: 'success' })
    void this.load()
  },

  onMenuDelete() {
    const u = this._menuUser
    this.setData({ menuId: 0 })
    if (!u) return
    if (u.isAdmin) {
      wx.showToast({ title: '不能删除管理员', icon: 'none' })
      return
    }
    wx.showModal({
      title: '删除用户',
      content: `确定删除用户 ${u.phone}？将同时删除其团队、档口、账单、商品等相关数据，此操作不可恢复。`,
      confirmColor: '#e53935',
      success: async (res) => {
        if (!res.confirm) return
        const r = await deleteAdminUser(u.id)
        if (!r.ok) {
          wx.showToast({ title: r.error || '删除失败', icon: 'none' })
          return
        }
        wx.showToast({ title: '已删除', icon: 'success' })
        void this.load()
      },
    })
  },
})
