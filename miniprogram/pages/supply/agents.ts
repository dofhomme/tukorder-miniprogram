import {
  agentInviteShareTitle,
  fetchBindStatus,
  MERCHANT_OPEN_SHARE_IMAGE,
  mintAgentCustomerInvite,
} from '../../services/lookup'
import { fetchSupplyAgentOrders, fetchSupplyAgents, markSupplyAgentPaid, type SupplyAgent } from '../../services/supply'
import { fetchCustomers, type Customer } from '../../services/team'

const PAGE = 10

type AgentRow = SupplyAgent & { unpaidSalesText: string; unpaidRefundText: string }

function moneyOrEmpty(value: unknown) {
  const n = Number(value) || 0
  if (Math.abs(n) < 0.005) return ''
  return n.toFixed(2)
}

Page({
  _all: [] as AgentRow[],
  _orders: [] as Array<Record<string, unknown>>,
  _inviteAll: [] as Customer[],
  data: {
    loaded: false,
    q: '',
    more: false,
    items: [] as AgentRow[],
    orderOn: false,
    orderName: '',
    orders: [] as Array<Record<string, unknown>>,
    orderMore: false,
    picked: {} as Record<string, boolean>,
    inviteOn: false,
    inviteQ: '',
    inviteList: [] as Array<{ id: string; name: string; wxBound: boolean }>,
    invitePick: '',
    inviteToken: '',
    inviteShop: '',
    inviteLabel: '先选择客户',
    inviteBusy: false,
  },
  noop() {},
  onShow() { void this.load() },
  async load() {
    const r = await fetchSupplyAgents()
    if (!r.ok || !r.data) {
      wx.showToast({ title: r.message || '加载失败', icon: 'none' })
      return
    }
    this._all = (r.data.items || []).map((item) => ({
      ...item,
      unpaidSalesText: moneyOrEmpty(item.unpaidSales),
      unpaidRefundText: moneyOrEmpty(item.unpaidRefund),
    }))
    this.paint(PAGE)
  },

  matched() {
    const q = String(this.data.q || '').trim().toLowerCase()
    if (!q) return this._all
    return this._all.filter((item) => String(item.name || '').toLowerCase().indexOf(q) >= 0)
  },

  paint(count: number) {
    const all = this.matched()
    this.setData({
      loaded: true,
      items: all.slice(0, count),
      more: all.length > count,
    })
  },

  onFind(e: WechatMiniprogram.Input) {
    this.data.q = String(e.detail.value || '')
    const all = this.matched()
    this.setData({
      q: this.data.q,
      items: all.slice(0, PAGE),
      more: all.length > PAGE,
    })
  },

  onMore() {
    if (!this.data.more) return
    this.paint(this.data.items.length + PAGE)
  },
  onOpen(e: WechatMiniprogram.TouchEvent) {
    const name = String(e.currentTarget.dataset.name || '')
    if (!name) return
    this._orders = []
    this.setData({ orderOn: true, orderName: name, orders: [], picked: {}, orderMore: false })
    void this.loadOrders(name)
  },

  onCloseOrder() {
    this.setData({ orderOn: false, orderName: '' })
    void this.load()
  },

  async loadOrders(name: string) {
    const r = await fetchSupplyAgentOrders(name)
    this._orders = r.data?.items || []
    this.setData({
      orders: this._orders.slice(0, PAGE),
      orderMore: this._orders.length > PAGE,
      picked: {},
    })
  },

  onOrderMore() {
    if (!this.data.orderMore) return
    const n = this.data.orders.length + PAGE
    this.setData({
      orders: this._orders.slice(0, n),
      orderMore: this._orders.length > n,
    })
  },

  onPick(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    const row = (this.data.orders || []).find((item) => String(item.id) === id)
    if (!row || row.isPaid || row.isReturn) return
    const picked = { ...this.data.picked, [id]: !this.data.picked[id] }
    this.setData({ picked })
  },

  async onRefund(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id || 0)
    const row = (this.data.orders || []).find((item) => Number(item.id) === id)
    if (!id || !row || !row.isReturn || row.isPaid || this.data.orderName === '') return
    const r = await markSupplyAgentPaid(this.data.orderName, [id])
    if (!r.ok) {
      wx.showToast({ title: r.message || '失败', icon: 'none' })
      return
    }
    wx.showToast({ title: '已退款', icon: 'none' })
    void this.loadOrders(this.data.orderName)
  },

  async onPaid() {
    const orderIds = Object.keys(this.data.picked)
      .filter((id) => this.data.picked[id])
      .map((id) => Number(id))
    if (!orderIds.length) {
      wx.showToast({ title: '先勾选未付销售单', icon: 'none' })
      return
    }
    const r = await markSupplyAgentPaid(this.data.orderName, orderIds)
    if (!r.ok) {
      wx.showToast({ title: r.message || '失败', icon: 'none' })
      return
    }
    wx.showToast({ title: `已收 ${r.data?.count || 0} 单`, icon: 'none' })
    void this.loadOrders(this.data.orderName)
  },

  onInvite() {
    this.setData({
      inviteOn: true,
      orderOn: false,
      inviteQ: '',
      invitePick: '',
      inviteToken: '',
      inviteShop: '',
      inviteLabel: '先选择客户',
      inviteBusy: false,
    })
    void this.loadInviteCustomers()
  },

  onCloseInvite() {
    this.setData({
      inviteOn: false,
      invitePick: '',
      inviteToken: '',
      inviteLabel: '先选择客户',
      inviteBusy: false,
    })
  },

  async loadInviteCustomers() {
    const [cust, binds] = await Promise.all([fetchCustomers(), fetchBindStatus()])
    if (!cust.ok) {
      wx.showToast({ title: cust.error || '客户加载失败', icon: 'none' })
    }
    const bound = new Map(binds.map((item) => [item.customerUid, item.wxBound]))
    this._inviteAll = (cust.customers || []).map((item) => ({
      ...item,
      wxBound: !!bound.get(item.id),
    }))
    this.applyInvite()
  },

  onInviteQ(e: WechatMiniprogram.Input) {
    this.setData({ inviteQ: e.detail.value })
    this.applyInvite()
  },

  applyInvite() {
    const q = String(this.data.inviteQ || '').trim().toLowerCase()
    let list = this._inviteAll
    if (q) {
      list = list.filter(
        (item) =>
          String(item.name || '').toLowerCase().includes(q) ||
          String(item.phone || '').includes(q),
      )
    }
    this.setData({
      inviteList: list.slice(0, 80).map((item) => ({
        id: item.id,
        name: item.name,
        wxBound: !!item.wxBound,
      })),
    })
  },

  async onInvitePick(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    const row = this._inviteAll.find((item) => item.id === id)
    if (!row || this.data.inviteBusy) return
    if (row.wxBound) {
      wx.showToast({ title: '该客户已绑定微信', icon: 'none' })
      return
    }
    this.setData({
      inviteBusy: true,
      invitePick: id,
      inviteToken: '',
      inviteLabel: '正在生成邀请…',
    })
    const r = await mintAgentCustomerInvite(id)
    if (!r.ok || !r.token) {
      this.setData({ inviteBusy: false, invitePick: '', inviteLabel: '先选择客户' })
      wx.showToast({ title: (r.error || '无法生成邀请').slice(0, 20), icon: 'none' })
      return
    }
    const name = r.customerName || row.name
    this.setData({
      inviteBusy: false,
      inviteToken: r.token,
      inviteShop: r.shopName || '',
      inviteLabel: `发给代理 · ${name}`,
    })
  },

  onShareAppMessage() {
    const token = String(this.data.inviteToken || '').trim()
    if (!token) return { title: '代理', path: '/pages/chain/chain' }
    return {
      title: agentInviteShareTitle(this.data.inviteShop),
      path: `/pages/login/login?mode=agent&stay=1&invite=${encodeURIComponent(token)}`,
      imageUrl: MERCHANT_OPEN_SHARE_IMAGE,
    }
  },
})
