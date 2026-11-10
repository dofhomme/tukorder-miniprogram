import { genJobNo } from '../../services/api'
import { softDeleteCustomer } from '../../services/recycle-bin'
import { getSession, isGuest, isLoggedIn } from '../../services/session'
import { assertMsgSecCheck } from '../../services/sec-check'
import { fetchCustomerUnpaidTotals, fetchCustomers, isJoinedEmployee, isOwner, peekCachedOrders, uploadCustomers } from '../../services/team'
import type { Customer } from '../../services/team'
import {
  agentInviteShareTitle,
  fetchBindStatus,
  nudgeAgentStatement,
  unbindAgent,
} from '../../services/lookup'
import { requireCloudSync } from '../../services/account-gate'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { takeVoiceJump } from '../../services/voice-jump'

const PAGE_SIZE = 40

type Row = Customer & {
  avatar: string
  boundHint: string
  arrearsLabel: string
  arrearsOwed: boolean
}

function unpaidByCustomer(): Map<string, number> {
  const map = new Map<string, number>()
  for (const o of peekCachedOrders()) {
    const name = String(o.customerName || '').trim()
    if (!name || o.isPaid) continue
    const total = Math.abs(Number(o.totalAmount || 0))
    if (!Number.isFinite(total)) continue
    const signed = o.isReturn ? -total : total
    map.set(name, Math.round(((map.get(name) || 0) + signed) * 100) / 100)
  }
  return map
}

function rowOf(c: Customer, unpaid: Map<string, number>): Row {
  const amt = unpaid.get(String(c.name || '').trim()) || 0
  const owed = amt > 0.004
  return {
    ...c,
    avatar: avatarOf(c.name),
    boundHint: c.wxBound ? t('boundWechat') : '',
    arrearsOwed: owed,
    arrearsLabel: owed ? `欠 ¥${amt.toFixed(2)}` : '',
  }
}

function avatarOf(name: string): string {
  const n = (name || '').trim()
  return n ? n[0] : '?'
}

function localCustomerMode(): boolean {
  return isGuest() || !isLoggedIn()
}

Page({
  data: {
    keyword: '',
    list: [] as Row[],
    total: 0,
    hasMore: false,
    loading: false,
    canManage: true,
    canDelete: true,
    guestMode: false,
    syncHint: '',
    syncFail: false,
    menuId: '',
    menuName: '',
    menuWxBound: false,
    showEdit: false,
    editTitle: t('newCustomer'),
    editName: '',
    editPhone: '',
    editSaving: false,
    ...i18nState(),
  },

  applyLocale() {
    bindPageI18n(this, 'customers')
    this.setData({
      editTitle: this._editId ? t('editCustomer') : t('newCustomer'),
    })
    if (this._all.length) this.apply()
  },

  _all: [] as Customer[],
  _filtered: [] as Customer[],
  _unpaid: null as Map<string, number> | null,
  _showCount: PAGE_SIZE,
  _editId: '' as string,
  _menuCust: null as Customer | null,
  _ready: false,

  onLoad() {
    isOwner()
    const s = getSession()
    const role = String(s?.team?.role || '')
    // 游客、店主、已入职店员可管客户。代理号不行。
    const canManage = localCustomerMode() || role === 'owner' || isJoinedEmployee()
    const canDelete = localCustomerMode() || role === 'owner'
    this.setData({ canManage, canDelete, guestMode: localCustomerMode() })
  },

  onShow() {
    this.applyLocale()
    if (!isLoggedIn() && !isGuest()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.setData({ guestMode: localCustomerMode() })
    const jump = takeVoiceJump('customers')
    if (jump && jump.keyword) this.setData({ keyword: jump.keyword })
    if (jump && jump.action === 'add') this.onAdd()
    void this.load({ pullCloud: true })
  },

  onReachBottom() {
    this.loadMore()
  },

  noop() {},

  async load(opts?: { pullCloud?: boolean }) {
    const pullCloud = opts?.pullCloud !== false
    this._ready = false
    this._all = []
    this.setData({ loading: true })

    if (pullCloud) {
      const r = await fetchCustomers()
      if (!r.ok) {
        if (!localCustomerMode()) {
          this._unpaid = await fetchCustomerUnpaidTotals()
        }
        this.apply()
        this.setData({
          loading: false,
          syncHint: `加载失败：${r.error || '请检查网络'}`,
          syncFail: true,
        })
        if (!this._all.length) {
          wx.showToast({ title: r.error || '加载失败', icon: 'none' })
        }
        return
      }
      this._all = await this.mergeBind(r.customers)
      const local = localCustomerMode() || !!r.fromCache
      this.setData({
        syncHint:
          r.customers.length > 0
            ? local
              ? `本机客户 ${r.customers.length} 位`
              : `已从云端同步 ${r.customers.length} 位客户`
            : local
              ? '暂无本机客户'
              : '',
        syncFail: false,
      })
    } else {
      const r = await fetchCustomers()
      if (r.ok) this._all = await this.mergeBind(r.customers)
    }

    if (!localCustomerMode()) {
      this._unpaid = await fetchCustomerUnpaidTotals()
    } else {
      this._unpaid = null
    }

    this._ready = true
    this.setData({ loading: false })
    this.apply()
  },

  unpaidMap(): Map<string, number> {
    return this._unpaid || unpaidByCustomer()
  },

  async mergeBind(list: Customer[]) {
    if (localCustomerMode()) return list.map((c) => ({ ...c, wxBound: false }))
    const items = await fetchBindStatus()
    if (!items.length) return list
    const map = new Map(items.map((x) => [x.customerUid, x.wxBound]))
    return list.map((c) => ({ ...c, wxBound: !!map.get(c.id) }))
  },

  apply() {
    const q = (this.data.keyword || '').trim().toLowerCase()
    let list = this._all
    if (q) {
      list = list.filter(
        (c) =>
          (c.name || '').toLowerCase().includes(q) ||
          (c.phone || '').includes(q),
      )
    }
    this._filtered = list
    this._showCount = PAGE_SIZE
    const n = Math.min(this._showCount, list.length)
    const unpaid = this.unpaidMap()
    this.setData({
      list: list.slice(0, n).map((c) => rowOf(c, unpaid)),
      total: list.length,
      hasMore: n < list.length,
    })
  },

  loadMore() {
    if (!this.data.hasMore) return
    this._showCount += PAGE_SIZE
    const list = this._filtered
    const n = Math.min(this._showCount, list.length)
    const unpaid = this.unpaidMap()
    this.setData({
      list: list.slice(0, n).map((c) => rowOf(c, unpaid)),
      hasMore: n < list.length,
    })
  },

  onKeyword(e: WechatMiniprogram.Input) {
    this.setData({ keyword: e.detail.value })
    this.apply()
  },

  onClearKeyword() {
    this.setData({ keyword: '' })
    this.apply()
  },

  onSync() {
    void this.load({ pullCloud: true })
  },

  onAdd() {
    if (!this.data.canManage) return
    this._editId = ''
    this.setData({
      showEdit: true,
      editTitle: t('newCustomer'),
      editName: '',
      editPhone: '',
      editSaving: false,
      menuId: '',
    })
  },

  onOpenArrears(e: WechatMiniprogram.TouchEvent) {
    const name = String(e.currentTarget.dataset.name || '').trim()
    if (!name) return
    wx.navigateTo({
      url: `/pages/analytics/analytics?intent=stats&customer=${encodeURIComponent(name)}`,
    })
  },

  onRowTap(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.canManage) return
    const id = e.currentTarget.dataset.id as string
    const c = this._all.find((x) => x.id === id)
    if (!c) return
    this.openEdit(c)
  },

  onMore(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string
    const c = this._all.find((x) => x.id === id)
    if (!c) return
    this._menuCust = c
    this.setData({ menuId: id, menuName: c.name || '', menuWxBound: !!c.wxBound })
  },

  onCloseMenu() {
    this.setData({ menuId: '', menuName: '', menuWxBound: false })
    this._menuCust = null
  },

  onMenuAct(e: WechatMiniprogram.TouchEvent) {
    const act = e.currentTarget.dataset.act as string
    const c = this._menuCust
    this.setData({ menuId: '', menuName: '', menuWxBound: false })
    if (!c) return
    if (act === 'prices') {
      wx.navigateTo({
        url: `/pages/customers/prices?name=${encodeURIComponent(c.name || '')}`,
      })
    } else if (act === 'edit') this.openEdit(c)
    else if (act === 'delete') this.confirmDelete(c)
    else if (act === 'unbind') this.confirmUnbind(c)
    else if (act === 'nudge') void this.onNudge(c)
  },

  confirmUnbind(c: Customer) {
    wx.showModal({
      title: '解绑微信？',
      content: `解绑后，「${c.name}」不再对应这个微信。可再绑别人。`,
      confirmText: '解绑',
      confirmColor: '#e53935',
      success: (r) => {
        if (r.confirm) void this.doUnbind(c)
      },
    })
  },

  async doUnbind(c: Customer) {
    const r = await unbindAgent(c.id)
    if (!r.ok) {
      wx.showToast({ title: r.error || '解绑失败', icon: 'none' })
      return
    }
    wx.showToast({ title: '已解绑', icon: 'none' })
    void this.load({ pullCloud: true })
  },

  async onNudge(c: Customer) {
    if (localCustomerMode() || !requireCloudSync('sync')) return
    wx.showLoading({ title: t('loading'), mask: true })
    const r = await nudgeAgentStatement(c.id, c.name)
    wx.hideLoading()
    wx.showToast({ title: r.ok ? t('nudgedOk') : r.error || t('loadFailed'), icon: 'none' })
  },

  onShareAppMessage() {
    return {
      title: agentInviteShareTitle(),
      path: '/pages/login/login?mode=agent',
    }
  },

  openEdit(c: Customer) {
    this._editId = c.id
    this.setData({
      showEdit: true,
      editTitle: t('editCustomer'),
      editName: c.name || '',
      editPhone: c.phone || '',
      editSaving: false,
    })
  },

  onEditCancel() {
    if (this.data.editSaving) return
    this.setData({ showEdit: false })
  },

  onEditName(e: WechatMiniprogram.Input) {
    this.setData({ editName: e.detail.value })
  },

  onEditPhone(e: WechatMiniprogram.Input) {
    this.setData({ editPhone: e.detail.value })
  },

  async onEditSave() {
    if (this.data.editSaving) return
    if (!this._ready) {
      wx.showToast({ title: '客户名单还在加载', icon: 'none' })
      return
    }
    const name = (this.data.editName || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写客户名称', icon: 'none' })
      return
    }
    const phone = (this.data.editPhone || '').trim()
    if (!(await assertMsgSecCheck([name, phone]))) return
    this.setData({ editSaving: true })

    let next: Customer[]
    if (this._editId) {
      next = this._all.map((c) =>
        c.id === this._editId ? { ...c, name, phone } : c,
      )
    } else {
      next = [...this._all, { id: genJobNo(), name, phone }]
    }

    const up = await uploadCustomers(next)
    this.setData({ editSaving: false })
    if (!up.ok) {
      wx.showToast({ title: up.error || '保存失败', icon: 'none' })
      return
    }
    this.setData({ showEdit: false })
    const local = !!(up as { localOnly?: boolean }).localOnly || localCustomerMode()
    wx.showToast({
      title: this._editId
        ? local
          ? '已保存到本机'
          : '已保存，正在同步云端'
        : local
          ? '已添加到本机'
          : '已添加，正在同步云端',
      icon: 'none',
    })
    void this.load({ pullCloud: false })
  },

  confirmDelete(c: Customer) {
    wx.showModal({
      title: '删除客户？',
      content: `确定删除「${c.name}」？将移入回收站。`,
      confirmText: '删除',
      confirmColor: '#e53935',
      success: async (res) => {
        if (!res.confirm) return
        const up = await softDeleteCustomer(c)
        if (!up.ok) {
          wx.showToast({ title: up.error || '失败', icon: 'none' })
          return
        }
        wx.showToast({
          title: localCustomerMode() ? '已删除（本机回收站）' : '已删除，正在同步云端',
          icon: 'none',
        })
        void this.load({ pullCloud: false })
      },
    })
  },
})
