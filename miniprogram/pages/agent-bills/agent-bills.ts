import {
  fetchAgentMe,
  agentOrderKind,
  ackAgentStatement,
  merchantRenewShare,
  type AgentBinding,
  type LookupOrder,
} from '../../services/lookup'
import { requestBillSubscribe } from '../../services/subscribe'
import { bindPageI18n, i18nState, t } from '../../services/i18n'
import { peekAgentOwnerId, saveAgentOwnerId } from '../../services/workspace'

const PAGE_SIZE = 10

type BillRow = {
  orderNo: string
  token: string
  dateLabel: string
  amountLabel: string
  amountNeg: boolean
  flagLabel: string
  isReturn: boolean
  amount: number
  _ts: number
}

function money(v?: number) {
  return Number(v || 0).toFixed(2)
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n)
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function defaultRange() {
  const to = new Date()
  const from = new Date(to.getFullYear(), to.getMonth() - 1, to.getDate())
  return { dateFrom: ymd(from), dateTo: ymd(to) }
}

function parseOrderTs(createdAt?: string | null) {
  const s = String(createdAt || '').trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return 0
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

function dayStart(ymdStr: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymdStr)
  if (!m) return 0
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

function dayEnd(ymdStr: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymdStr)
  if (!m) return 0
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999).getTime()
}

function flagLabel(o: LookupOrder) {
  if (o.isReturn) return o.isPaid ? t('refunded') : t('unrefunded')
  const bits: string[] = []
  bits.push(o.isPaid ? t('tagPaid') : t('tagUnpaid'))
  if (agentOrderKind(o.remark) === 'pending') bits.push(t('agentPendingStat'))
  else if (agentOrderKind(o.remark) === 'rejected') bits.push(t('agentRejected'))
  else if (agentOrderKind(o.remark) === 'agent') bits.push(t('agentBadge'))
  if (o.isShipped) bits.push(t('tagShipped'))
  return bits.join(' · ')
}

function toBillRow(o: LookupOrder): BillRow {
  const amt = Number(o.totalAmount || 0)
  return {
    orderNo: o.orderNo || '',
    token: o.token || '',
    dateLabel: String(o.createdAt || '').slice(0, 16).replace('T', ' '),
    amountLabel: Math.abs(amt).toFixed(2),
    amountNeg: amt < 0 || !!o.isReturn,
    flagLabel: flagLabel(o),
    isReturn: !!o.isReturn,
    amount: amt,
    _ts: parseOrderTs(o.createdAt),
  }
}

function pageInfoText(page: number, pages: number, total: number) {
  return t('billPageInfo')
    .replace('{page}', String(page))
    .replace('{pages}', String(Math.max(pages, 1)))
    .replace('{total}', String(total))
}

Page({
  data: {
    loading: true,
    error: '',
    bound: false,
    invite: '',
    shopName: '',
    customerName: '',
    ownerUserId: 0,
    phone: '',
    unpaidAmount: '0.00',
    canSwitch: false,
    bindings: [] as AgentBinding[],
    dateFrom: defaultRange().dateFrom,
    dateTo: defaultRange().dateTo,
    page: 1,
    pageCount: 1,
    totalCount: 0,
    pageInfo: '',
    pageRows: [] as BillRow[],
    summaryOrderCount: 0,
    summaryReturnCount: 0,
    summarySales: '0.00',
    summaryRefund: '0.00',
    listMode: 'all' as 'all' | 'sales' | 'returns',
    ackAt: '',
    acking: false,
    merchantExpired: false,
    booksClosed: false,
    expireShop: '',
    ...i18nState(),
  },

  _allOrders: [] as LookupOrder[],
  _filtered: [] as BillRow[],

  applyLocale() {
    bindPageI18n(this, 'myBills')
    this.setData({
      pageInfo: pageInfoText(this.data.page, this.data.pageCount, this.data.totalCount),
    })
  },

  onLoad(_query: Record<string, string | undefined>) {
    const range = defaultRange()
    this.setData({ dateFrom: range.dateFrom, dateTo: range.dateTo, ownerUserId: peekAgentOwnerId() })
    this.applyLocale()
    void this.refresh()
  },

  onShow() {
    this.applyLocale()
    void requestBillSubscribe()
  },

  onPullDownRefresh() {
    void this.refresh().then(() => wx.stopPullDownRefresh())
  },

  applyFilterAndPage(resetPage = false) {
    const from = dayStart(this.data.dateFrom)
    const to = dayEnd(this.data.dateTo)
    const lo = Math.min(from, to)
    const hi = Math.max(from, to)
    const period = this._allOrders
      .map(toBillRow)
      .filter((r) => r._ts >= lo && r._ts <= hi)
      .sort((a, b) => b._ts - a._ts)
    let orderCount = 0
    let returnCount = 0
    let sales = 0
    let refund = 0
    for (const r of period) {
      const amt = Math.abs(Number(r.amount || 0))
      if (r.isReturn) {
        returnCount += 1
        refund += amt
      } else {
        orderCount += 1
        sales += amt
      }
    }
    const mode = this.data.listMode || 'all'
    const filtered =
      mode === 'returns'
        ? period.filter((r) => r.isReturn)
        : mode === 'sales'
          ? period.filter((r) => !r.isReturn)
          : period
    this._filtered = filtered
    const total = filtered.length
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
    let page = resetPage ? 1 : this.data.page
    if (page > pageCount) page = pageCount
    if (page < 1) page = 1
    const start = (page - 1) * PAGE_SIZE
    const pageRows = filtered.slice(start, start + PAGE_SIZE)
    this.setData({
      page,
      pageCount,
      totalCount: total,
      pageRows,
      pageInfo: pageInfoText(page, pageCount, total),
      summaryOrderCount: orderCount,
      summaryReturnCount: returnCount,
      summarySales: money(sales),
      summaryRefund: money(refund),
    })
  },

  async refresh() {
    this.setData({ loading: true, error: '' })
    try {
      const me = await fetchAgentMe(this.data.ownerUserId || undefined, {
        allOrders: true,
        dateFrom: this.data.dateFrom,
        dateTo: this.data.dateTo,
      })
      if (!me.ok || !me.data) {
        this.setData({ loading: false, error: me.error || '加载失败' })
        return
      }
      const cur = me.data.current
      const bindings = me.data.bindings || []
      this._allOrders = me.data.orders || []
      this.setData({
        loading: false,
        bound: !!me.data.bound,
        bindings,
        canSwitch: bindings.length > 1,
        shopName: cur?.shopName || (peekAgentOwnerId() ? '' : t('allShops')),
        customerName: cur?.customerName || '',
        ownerUserId: peekAgentOwnerId(),
        phone: cur?.phone || '',
        unpaidAmount: money(cur?.unpaidAmount),
        merchantExpired: !!(me.data.merchantExpired || cur?.merchantExpired),
        booksClosed:
          !(me.data.merchantExpired || cur?.merchantExpired) &&
          !(me.data.acceptAgentOrders || cur?.acceptAgentOrders),
        expireShop: peekAgentOwnerId() ? cur?.shopName || '' : '',
        ackAt: me.data.statementAck?.ackedAt || '',
      })
      this.applyFilterAndPage(true)
    } catch (e) {
      this.setData({
        loading: false,
        error: e instanceof Error ? e.message : '加载失败',
      })
    }
  },

  onDateFrom(e: WechatMiniprogram.PickerChange) {
    this.setData({ dateFrom: String(e.detail.value || '') })
    this.applyFilterAndPage(true)
    void this.reloadSummary()
  },

  onDateTo(e: WechatMiniprogram.PickerChange) {
    this.setData({ dateTo: String(e.detail.value || '') })
    this.applyFilterAndPage(true)
    void this.reloadSummary()
  },

  async reloadSummary() {
    this.applyFilterAndPage(true)
    const me = await fetchAgentMe(this.data.ownerUserId || undefined, {
      home: true,
      dateFrom: this.data.dateFrom,
      dateTo: this.data.dateTo,
    })
    if (!me.ok || !me.data) return
    this.setData({
      unpaidAmount: money(me.data.current?.unpaidAmount),
      ackAt: me.data.statementAck?.ackedAt || '',
    })
  },

  onFilterSales() {
    const next = this.data.listMode === 'sales' ? 'all' : 'sales'
    this.setData({ listMode: next })
    this.applyFilterAndPage(true)
  },

  onFilterReturns() {
    const next = this.data.listMode === 'returns' ? 'all' : 'returns'
    this.setData({ listMode: next })
    this.applyFilterAndPage(true)
  },

  onPrevPage() {
    if (this.data.page <= 1) return
    this.setData({ page: this.data.page - 1 })
    this.applyFilterAndPage()
  },

  onNextPage() {
    if (this.data.page >= this.data.pageCount) return
    this.setData({ page: this.data.page + 1 })
    this.applyFilterAndPage()
  },

  async onAckRange() {
    if (this.data.acking) return
    this.setData({ acking: true })
    const r = await ackAgentStatement(this.data.dateFrom, this.data.dateTo, this.data.ownerUserId || undefined)
    this.setData({ acking: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
      return
    }
    this.setData({ ackAt: r.data?.ack?.ackedAt || '' })
    wx.showToast({ title: t('ackedAt'), icon: 'none' })
  },

  onOpenOrder(e: WechatMiniprogram.TouchEvent) {
    const token = String(e.currentTarget.dataset.token || '').trim()
    if (!token) return
    wx.navigateTo({ url: `/pages/order-lookup/order-lookup?token=${encodeURIComponent(token)}` })
  },

  onOpenPlaza() {
    wx.navigateTo({ url: '/pages/agent-plaza/agent-plaza' })
  },

  onSwitchShop() {
    const list = this.data.bindings
    if (list.length < 2) return
    wx.showActionSheet({
      itemList: list.map((b) => `${b.shopName || '档口'} · ${b.customerName}`),
      success: (r) => {
        const pick = list[r.tapIndex]
        if (!pick) return
        saveAgentOwnerId(pick.ownerUserId)
        this.setData({ ownerUserId: pick.ownerUserId, loading: true })
        void fetchAgentMe(pick.ownerUserId, { allOrders: true }).then((me) => {
          if (!me.ok || !me.data?.current) {
            this.setData({ loading: false })
            return
          }
          const cur = me.data.current
          this._allOrders = me.data.orders || []
          this.setData({
            loading: false,
            bound: true,
            shopName: cur.shopName || '',
            customerName: cur.customerName || '',
            ownerUserId: cur.ownerUserId || 0,
            phone: cur.phone || '',
            unpaidAmount: money(cur.unpaidAmount),
            merchantExpired: !!(me.data.merchantExpired || cur.merchantExpired),
            booksClosed:
              !(me.data.merchantExpired || cur.merchantExpired) &&
              !(me.data.acceptAgentOrders || cur.acceptAgentOrders),
            expireShop: cur.shopName || '',
            listMode: 'all',
          })
          this.applyFilterAndPage(true)
        })
      },
    })
  },

  onShareAppMessage() {
    return merchantRenewShare(this.data.expireShop)
  },
})
