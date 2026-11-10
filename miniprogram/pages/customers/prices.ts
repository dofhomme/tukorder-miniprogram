import { deleteDeal, listCustomerDeals, setDealPrice } from '../../services/customer-deal'
import { getSession, isGuest, isLoggedIn } from '../../services/session'
import { isJoinedEmployee, isOwner, peekCachedCatalog, peekCachedOrders } from '../../services/team'

function money(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const r = Math.round(n * 100) / 100
  return String(r)
}

function canManageCustomers(): boolean {
  if (isGuest() || !isLoggedIn()) return true
  isOwner()
  const role = String(getSession()?.team?.role || '')
  return role === 'owner' || isJoinedEmployee()
}

Page({
  data: {
    customerName: '',
    rows: [] as Array<{
      code: string
      price: number
      draft: string
      listText: string
    }>,
    loading: true,
    canManage: false,
    emptyText: '',
  },

  _name: '',

  onLoad(q: Record<string, string | undefined>) {
    let name = String((q && (q.name || q.code)) || '').trim()
    try {
      name = decodeURIComponent(name)
    } catch (_) {
      /* 已是明文 */
    }
    this._name = name
    this.setData({ customerName: name })
  },

  onShow() {
    if (!isLoggedIn() && !isGuest()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    wx.setNavigationBarTitle({
      title: this._name ? `${this._name}的历史价格` : '历史价格',
    })
    this.reload()
  },

  reload() {
    const name = this._name
    if (!name) {
      this.setData({
        loading: false,
        canManage: false,
        rows: [],
        emptyText: '没有客户名称',
      })
      return
    }
    const deals = listCustomerDeals(name, peekCachedOrders(), peekCachedCatalog())
    this.setData({
      loading: false,
      canManage: canManageCustomers(),
        emptyText: '没有和系统价不一样的价格',
      rows: deals.map((r) => ({
        code: r.code,
        price: r.price,
        draft: money(r.price),
        listText: r.listPrice == null ? '—' : money(r.listPrice),
      })),
    })
  },

  onDraft(e: WechatMiniprogram.Input) {
    const code = String(e.currentTarget.dataset.code || '')
    const draft = String(e.detail.value || '')
    const rows = (this.data.rows || []).map((r) => (r.code === code ? { ...r, draft } : r))
    this.setData({ rows })
  },

  onSave(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.canManage) return
    const code = String(e.currentTarget.dataset.code || '').trim()
    const row = (this.data.rows || []).find((r) => r.code === code)
    const price = Number(String(row?.draft || '').trim())
    if (!code || !(price > 0)) {
      wx.showToast({ title: '价格要大于 0', icon: 'none' })
      return
    }
    setDealPrice(this._name, code, price)
    wx.showToast({ title: '已保存', icon: 'success' })
    this.reload()
  },

  onDelete(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.canManage) return
    const code = String(e.currentTarget.dataset.code || '').trim()
    if (!code) return
    wx.showModal({
      title: '删除这条历史价格？',
      content: `删除后，${code} 不再从旧单里带出。下次再开这一货，会重新记下。`,
      confirmText: '删除',
      confirmColor: '#e53935',
      success: (r) => {
        if (!r.confirm) return
        deleteDeal(this._name, code)
        wx.showToast({ title: '已删除', icon: 'success' })
        this.reload()
      },
    })
  },
})
