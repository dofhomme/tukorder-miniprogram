import {
  buildStmtPreview,
  computeAnalytics,
  computeCustomerDetail,
  formatMoney,
  consumeStmtStatsDirty,
  holdStmtPreview,
  orderCreatedAt,
  rangeBounds,
} from '../../services/analytics'
import type { AnalyticsTab, RangeKey } from '../../services/analytics'
import { canBrowseApp, isGuest, isLoggedIn } from '../../services/session'
import {
  fetchShop,
  fetchStmtOrders,
  fetchTeamStats,
  flushOrderSyncQueue,
  peekCachedOrders,
  peekCachedShop,
} from '../../services/team'
import type { TeamStatsPayload } from '../../services/team'
import { takeVoiceJump } from '../../services/voice-jump'
import type { OrderBrief, ShopInfo } from '../../services/team'
import { bindPageI18n, i18nState, t } from '../../services/i18n'

function locChip(label: string) {
  const map: Record<string, string> = {
    已退款: 'refunded',
    未退款: 'unrefunded',
    已付款: 'paid',
    已拿货: 'picked',
    已收货: 'received',
    已发货: 'shipped',
    已送货: 'delivered',
    未拿货: 'unpicked',
    未收货: 'unpicked',
    已付: 'paidCount',
    未付: 'unpaidCount',
  }
  const key = map[label]
  return key ? t(key) : label
}

function locNamed<T extends { count: number }>(rows: T[]) {
  return rows.map((r) => ({ ...r, countLabel: `${r.count} ${t('orderUnit')}` }))
}

function locCodes<T extends { qty: number; code?: string }>(rows: T[]) {
  return rows.map((r) => ({
    ...r,
    qtyLabel: `${t('salesQtyPrefix')} ${r.qty} ${t('unitPiece')}`,
  }))
}

function pinCode<T extends { code?: string; members?: string[] }>(rows: T[], focus: string) {
  const marked = rows.map((r) => ({
    ...r,
    focus: !!focus && (r.code === focus || (r.members || []).indexOf(focus) >= 0),
  }))
  if (!focus) return marked
  const hit = marked.filter((r) => r.focus)
  if (!hit.length) return marked
  return [...hit, ...marked.filter((r) => !r.focus)]
}

function locCustCodes<T extends { qty: number }>(rows: T[]) {
  return rows.map((r) => ({
    ...r,
    qtyLabel: `${r.qty} ${t('unitPiece')}`,
  }))
}

function todayStr() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function weekAgoStr() {
  const d = new Date()
  d.setDate(d.getDate() - 6)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const TAB_KEYS: AnalyticsTab[] = ['sales', 'customers', 'codes', 'stmt']

function tabKeyOf(tab: number): AnalyticsTab {
  return TAB_KEYS[tab] || 'sales'
}

Page({
  data: {
    ...i18nState(),
    loading: false,
    refreshing: false,
    range: '7d' as RangeKey,
    dateLabel: '',
    tab: 0,
    focusCode: '',
    summary: {} as any,
    labels: {} as any,
    byStaff: [] as any[],
    byCustomer: [] as any[],
    byCustomerChart: [] as any[],
    byCode: [] as any[],
    byCodeChart: [] as any[],
    byDay: [] as any[],
    returnsByDay: [] as any[],
    topCodes: [] as any[],
    topCustomers: [] as any[],
    topStaff: [] as any[],
    customerReturnRates: [] as any[],
    productReturnRates: [] as any[],
    custKeyword: '',
    codeKeyword: '',
    stmtKeyword: '',
    stmtUnpaidOnly: false,
    stmtCustomer: '',
    stmtSelectedLabel: '',
    stmtList: [] as any[],
    showPeriodSheet: false,
    periodOptions: [] as Array<{ key: RangeKey | 'custom_pick'; label: string }>,
    showCustomDate: false,
    customFrom: '',
    customTo: '',
    // 客户详情弹层
    showCustDetail: false,
    custDetailName: '',
    custDetailRange: '',
    custDetailLoading: false,
    custSummary: {} as any,
    custLabels: {} as any,
    custByCode: [] as any[],
    custOrders: [] as any[],
  },

  _orders: [] as OrderBrief[],
  _stmtAll: [] as any[],
  _custAll: [] as any[],
  _custRatesAll: [] as any[],
  _codeAll: [] as any[],
  _codeRatesAll: [] as any[],
  _shop: null as ShopInfo | null,
  _customFrom: '',
  _customTo: '',
  _lastFetchAt: 0,
  _fetching: false,
  _tabReady: {} as Record<string, string>,
  _stmtOrders: [] as OrderBrief[],
  _pendingVoice: null as null | {
    intent: string
    customer: string
    from: string
    to: string
    range: string
    unpaidOnly: boolean
  },

  applyLocale() {
    bindPageI18n(this, 'analyticsTitle')
    const bounds = rangeBounds(this.data.range as RangeKey, {
      from: this._customFrom,
      to: this._customTo,
    })
    this.setData({
      dateLabel: this.data.range === 'all' ? t('allDates') : bounds.label,
    })
    if (isGuest() || !isLoggedIn()) {
      this._tabReady = {}
      if (this._orders.length) this.applyVisible()
    }
    if (this.data.showCustDetail && this.data.custDetailName) this.refreshCustomerDetail()
  },

  onLoad(q: Record<string, string | undefined>) {
    const tabRaw = String(q.tab || '').trim()
    const tabMap: Record<string, number> = {
      '0': 0,
      sales: 0,
      '1': 1,
      customers: 1,
      '2': 2,
      codes: 2,
      '3': 3,
      stmt: 3,
      reconcile: 3,
    }
    const code = decodeURIComponent(String(q.code || '')).trim()
    if (Object.prototype.hasOwnProperty.call(tabMap, tabRaw)) this.data.tab = tabMap[tabRaw]
    if (code) this.data.focusCode = code
    if (Object.prototype.hasOwnProperty.call(tabMap, tabRaw) || code) {
      this.setData({ tab: this.data.tab, focusCode: this.data.focusCode || '' })
    }
    const customer = decodeURIComponent(String(q.customer || '')).trim()
    const intent = String(q.intent || '').trim()
    const from = String(q.from || '').trim()
    const to = String(q.to || '').trim()
    const range = String(q.range || '').trim()
    if (!customer && !intent && !from && !to && !range) return
    this._pendingVoice = {
      intent,
      customer,
      from,
      to,
      range,
      unpaidOnly: q.unpaidOnly === '1' || q.unpaidOnly === 'true',
    }
  },

  onShow() {
    this.applyLocale()
    if (!canBrowseApp()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    if (!this._pendingVoice) {
      const jump = takeVoiceJump('analytics')
      if (jump && (jump.customer || jump.keyword || jump.intent)) {
        this._pendingVoice = {
          intent: String(jump.intent || '').trim(),
          customer: String(jump.customer || jump.keyword || '').trim(),
          from: String(jump.from || '').trim(),
          to: String(jump.to || '').trim(),
          range: String(jump.range || '').trim(),
          unpaidOnly: !!jump.unpaidOnly,
        }
      }
    }
    void this.load()
  },

  onPullDownRefresh() {
    void this.load({ forceNetwork: true }).finally(() => wx.stopPullDownRefresh())
  },

  hydrateFromCache() {
    this._orders = peekCachedOrders()
    if (!this._shop) this._shop = peekCachedShop() || null
  },

  rangeSig() {
    return `${this.data.range}|${this._customFrom}|${this._customTo}`
  },

  statsQuery() {
    return {
      tab: tabKeyOf(Number(this.data.tab) || 0),
      range: this.data.range,
      from: this.data.range === 'custom' ? this._customFrom : undefined,
      to: this.data.range === 'custom' ? this._customTo : undefined,
    }
  },

  paintStats(p: TeamStatsPayload) {
    const bounds = rangeBounds(this.data.range as RangeKey, {
      from: this._customFrom,
      to: this._customTo,
    })
    const dateLabel = this.data.range === 'all' ? t('allDates') : bounds.label
    const tab = p.tab || tabKeyOf(Number(this.data.tab) || 0)
    if (tab === 'sales') {
      const byStaff = locNamed((p.byStaff || []).slice(0, 50))
      const byCustomer = locNamed((p.byCustomer || []).slice(0, 6))
      const byCode = locCodes((p.byCode || []).slice(0, 6))
      this.setData({
        loading: false,
        refreshing: false,
        dateLabel,
        summary: p.summary || {},
        labels: p.summaryLabels || {},
        byStaff,
        byDay: (p.byDay || []).slice(0, 60),
        returnsByDay: (p.returnsByDay || []).slice(0, 60),
        topCodes: byCode,
        topCustomers: byCustomer,
        topStaff: byStaff.slice(0, 6),
      })
    } else if (tab === 'customers') {
      this._custAll = locNamed((p.byCustomer || []).slice(0, 50))
      this._custRatesAll = (p.customerReturnRates || []).slice(0, 10)
      this.setData({ loading: false, refreshing: false, dateLabel })
      this.applyCustomerFilter()
    } else if (tab === 'codes') {
      this._codeAll = locCodes((p.byCode || []).slice(0, 80))
      this._codeRatesAll = (p.productReturnRates || []).slice(0, 10)
      this.setData({ loading: false, refreshing: false, dateLabel })
      this.applyCodeFilter()
    } else {
      this._stmtAll = p.stmtCustomers || []
      this.setData({ loading: false, refreshing: false, dateLabel })
      this.applyStmt()
    }
  },

  /** 游客 / 接口失败：用本机订单算当前 Tab */
  applyVisible() {
    this.hydrateFromCache()
    const tab = Number(this.data.tab) || 0
    const key = tabKeyOf(tab)
    const sig = this.rangeSig()
    const readyKey = `${tab}`
    const bounds = rangeBounds(this.data.range as RangeKey, {
      from: this._customFrom,
      to: this._customTo,
    })
    const dateLabel = this.data.range === 'all' ? t('allDates') : bounds.label
    if (this._tabReady[readyKey] === sig) {
      this.setData({ loading: false, dateLabel })
      return
    }

    const a = computeAnalytics(this._orders, bounds.from, bounds.to, key)

    if (key === 'sales') {
      const byStaff = locNamed(a.byStaff.slice(0, 50))
      const byCustomer = locNamed(a.byCustomer.slice(0, 6))
      const byCode = locCodes(a.byCode.slice(0, 6))
      this.setData({
        loading: false,
        dateLabel,
        summary: a.summary,
        labels: a.summaryLabels,
        byStaff,
        byDay: a.byDay.slice(0, 60),
        returnsByDay: a.returnsByDay.slice(0, 60),
        topCodes: byCode,
        topCustomers: byCustomer,
        topStaff: byStaff.slice(0, 6),
      })
    } else if (key === 'customers') {
      this._custAll = locNamed(a.byCustomer.slice(0, 50))
      this._custRatesAll = a.customerReturnRates.slice(0, 10).map((r) => ({
        ...r,
        detail: `${t('returnShort')} ${r.returnCount} ${t('orderUnit')} ¥${formatMoney(r.returnAmount)} / ${t('colSales')} ${r.salesCount} ${t('orderUnit')} ¥${formatMoney(r.salesAmount)}`,
      }))
      this.setData({ loading: false, dateLabel })
      this.applyCustomerFilter()
    } else if (key === 'codes') {
      this._codeAll = locCodes(a.byCode.slice(0, 80))
      this._codeRatesAll = a.productReturnRates.slice(0, 10).map((r) => ({
        ...r,
        detail: `${t('returnShort')} ${r.returnQty} ${t('unitPiece')} ¥${formatMoney(r.returnAmount)} / ${t('colSales')} ${r.soldQty} ${t('unitPiece')}`,
      }))
      this.setData({ loading: false, dateLabel })
      this.applyCodeFilter()
    } else {
      this._stmtAll = a.stmtCustomers.map((c) => ({
        ...c,
        listLabel: `${t('inPeriod')} ${c.count} ${t('orderUnit')} · ¥${formatMoney(c.amount)}`,
      }))
      this.setData({ loading: false, dateLabel })
      this.applyStmt()
    }
    this._tabReady[readyKey] = sig
  },

  /**
   * 登录商家：常用统计只 CALL 存储过程（当前看得见的 Tab + 时段）。
   * 游客：本机订单兜底。隐藏容器不请求。
   */
  async load(opts?: { forceNetwork?: boolean }) {
    this.applyPendingVoiceRange()
    const forceNetwork = !!opts?.forceNetwork
    const paidChanged = consumeStmtStatsDirty()
    const guest = isGuest() || !isLoggedIn()
    this.hydrateFromCache()
    if (forceNetwork || paidChanged) this._tabReady = {}

    if (guest) {
      this.applyVisible()
      this.setData({ loading: false, refreshing: false })
      if (forceNetwork) {
        wx.showToast({ title: t('guestLocalOnly'), icon: 'none' })
      }
      this.consumePendingVoice()
      return
    }

    void flushOrderSyncQueue()
    if (!this._shop) {
      void fetchShop().then((shop) => {
        this._shop = shop.shop || this._shop
      })
    }
    const tab = tabKeyOf(Number(this.data.tab) || 0)
    const already = this._tabReady[`${tab}`] === `sp:${this.rangeSig()}`
    if (!already && !this.data.summary?.orderCount && !this.data.stmtList?.length) {
      this.setData({ loading: true })
    }
    await this.loadVisibleStats()
    this.consumePendingVoice()
  },

  applyPendingVoiceRange() {
    const q = this._pendingVoice
    if (!q) return
    const valid: RangeKey[] = ['7d', '10d', '15d', '30d', 'month', 'custom', 'all']
    if (q.from && q.to) {
      this._customFrom = q.from
      this._customTo = q.to
      this.setData({ range: 'custom', customFrom: q.from, customTo: q.to })
    } else if (valid.indexOf(q.range as RangeKey) >= 0) {
      this.setData({ range: q.range as RangeKey })
    }
    if (q.intent === 'statement' && q.customer) {
      this.setData({
        tab: 3,
        stmtCustomer: q.customer,
        stmtUnpaidOnly: q.unpaidOnly,
      })
    }
  },

  consumePendingVoice() {
    const q = this._pendingVoice
    if (!q) return
    this._pendingVoice = null
    const name = String(q.customer || '').trim()
    if (!name) {
      if (q.intent === 'statement') wx.showToast({ title: '没听清客户', icon: 'none' })
      return
    }
    if (q.intent === 'statement') {
      this.setData({
        tab: 3,
        stmtCustomer: name,
        stmtUnpaidOnly: q.unpaidOnly,
      })
      this.applyStmt()
      void this.onPreviewStatement()
      return
    }
    this.openCustomerDetail(name)
  },

  async loadVisibleStats() {
    if (isGuest() || !isLoggedIn()) {
      this.applyVisible()
      return
    }
    const tab = tabKeyOf(Number(this.data.tab) || 0)
    const sig = this.rangeSig()
    if (this._tabReady[`${tab}`] === `sp:${sig}`) {
      this.setData({ loading: false, refreshing: false })
      return
    }
    if (this._fetching) return
    this._fetching = true
    const hasLocal = this._orders.length > 0
    if (hasLocal) this.setData({ refreshing: true })
    else this.setData({ loading: true })
    try {
      const q = this.statsQuery()
      const r = await fetchTeamStats(q)
      if (!r.ok || !r.data) {
        if (hasLocal) {
          this.applyVisible()
          this.setData({ refreshing: false })
        } else {
          this.setData({ loading: false, refreshing: false })
          wx.showToast({ title: r.error || t('loadFailed'), icon: 'none' })
        }
        return
      }
      this.paintStats(r.data)
      this._tabReady[`${tab}`] = `sp:${sig}`
      this._lastFetchAt = Date.now()
    } finally {
      this._fetching = false
    }
  },

  applyCodeFilter() {
    const kw = (this.data.codeKeyword || '').trim().toLowerCase()
    const focus = String(this.data.focusCode || '')
    const match = (row: { code?: string; members?: string[] }) => {
      if (!kw) return true
      const blob = [row.code, ...(row.members || [])].join(' ').toLowerCase()
      return blob.includes(kw)
    }
    const byCode = pinCode((this._codeAll || []).filter(match), focus)
    const productReturnRates = (this._codeRatesAll || []).filter(match)
    this.setData({
      byCode,
      byCodeChart: byCode.slice(0, 10),
      productReturnRates: productReturnRates.slice(0, 10),
    })
  },

  applyCustomerFilter() {
    const kw = (this.data.custKeyword || '').trim().toLowerCase()
    const match = (name: string) => !kw || String(name || '').toLowerCase().includes(kw)
    const byCustomer = (this._custAll || []).filter((c) => match(c.name))
    const customerReturnRates = (this._custRatesAll || []).filter((c) => match(c.name))
    this.setData({
      byCustomer,
      byCustomerChart: byCustomer.slice(0, 10),
      customerReturnRates: customerReturnRates.slice(0, 10),
    })
  },

  applyStmt() {
    const kw = (this.data.stmtKeyword || '').trim().toLowerCase()
    const unpaidOnly = this.data.stmtUnpaidOnly
    let list = this._stmtAll.slice()
    if (unpaidOnly) {
      list = list
        .filter((c) => c.unpaidCount > 0)
        .map((c) => ({
          ...c,
          listLabel: `${t('unpaidCount')} ${c.unpaidCount} ${t('orderUnit')} · ¥${formatMoney(c.unpaidAmount)}`,
          count: c.unpaidCount,
          amount: c.unpaidAmount,
          amountLabel: formatMoney(c.unpaidAmount),
        }))
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    }
    if (kw) list = list.filter((c) => c.name.toLowerCase().includes(kw))
    let selected = this.data.stmtCustomer
    if (selected && !list.some((c) => c.name === selected)) {
      selected = list[0]?.name || ''
    } else if (!selected && list.length) {
      selected = list[0].name
    }
    const sel = list.find((c) => c.name === selected)
    this.setData({
      stmtList: list.slice(0, kw ? 80 : 200),
      stmtCustomer: selected,
      stmtSelectedLabel: sel
        ? unpaidOnly
          ? `${t('unpaidCount')} ${sel.count} ${t('orderUnit')} · ¥${sel.amountLabel}`
          : `${sel.count} ${t('orderUnit')} · ¥${sel.amountLabel}`
        : '',
    })
  },

  onTab(e: WechatMiniprogram.TouchEvent) {
    const tab = Number(e.currentTarget.dataset.tab)
    if (tab === this.data.tab) return
    this.setData({ tab })
    void this.loadVisibleStats()
  },

  onPickRange() {
    // wx.showActionSheet 最多 6 项；统计时段有 7 项会静默失败，改用自定义面板。
    this.setData({
      showPeriodSheet: true,
      periodOptions: [
        { key: '7d', label: t('last7') },
        { key: '10d', label: t('last10') },
        { key: '15d', label: t('last15') },
        { key: '30d', label: t('last30') },
        { key: 'month', label: t('thisMonth') },
        { key: 'custom_pick', label: t('customPeriod') },
        { key: 'all', label: t('allDates') },
      ],
    })
  },

  onClosePeriodSheet() {
    this.setData({ showPeriodSheet: false })
  },

  onPickPeriod(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || '') as RangeKey | 'custom_pick'
    this.setData({ showPeriodSheet: false })
    if (!key) return
    if (key === 'custom_pick') {
      this.setData({
        showCustomDate: true,
        customFrom: this._customFrom || weekAgoStr(),
        customTo: this._customTo || todayStr(),
      })
      return
    }
    this.setData({ range: key })
    this._tabReady = {}
    void this.loadVisibleStats()
  },

  onCustomFrom(e: WechatMiniprogram.PickerChange) {
    this.setData({ customFrom: e.detail.value as string })
  },

  onCustomTo(e: WechatMiniprogram.PickerChange) {
    this.setData({ customTo: e.detail.value as string })
  },

  onCancelCustom() {
    this.setData({ showCustomDate: false })
  },

  onConfirmCustom() {
    const from = this.data.customFrom
    const to = this.data.customTo
    if (!from || !to) {
      wx.showToast({ title: t('pickStartEnd'), icon: 'none' })
      return
    }
    if (from > to) {
      wx.showToast({ title: t('startAfterEnd'), icon: 'none' })
      return
    }
    this._customFrom = from
    this._customTo = to
    this.setData({ range: 'custom', showCustomDate: false })
    this._tabReady = {}
    void this.loadVisibleStats()
  },

  noop() {},

  onCodeKeyword(e: WechatMiniprogram.Input) {
    this.setData({ codeKeyword: e.detail.value })
    this.applyCodeFilter()
  },

  onClearCodeKeyword() {
    this.setData({ codeKeyword: '' })
    this.applyCodeFilter()
  },

  onCustKeyword(e: WechatMiniprogram.Input) {
    this.setData({ custKeyword: e.detail.value })
    this.applyCustomerFilter()
  },

  onClearCustKeyword() {
    this.setData({ custKeyword: '' })
    this.applyCustomerFilter()
  },

  onStmtKeyword(e: WechatMiniprogram.Input) {
    this.setData({ stmtKeyword: e.detail.value })
    this.applyStmt()
  },

  onToggleUnpaidOnly(e: WechatMiniprogram.SwitchChange) {
    this.setData({ stmtUnpaidOnly: !!e.detail.value })
    this.applyStmt()
  },

  onPickStmt(e: WechatMiniprogram.TouchEvent) {
    const name = e.currentTarget.dataset.name as string
    this.setData({ stmtCustomer: name })
    this.applyStmt()
  },

  onSelectStmtRadio(e: WechatMiniprogram.TouchEvent) {
    const name = e.currentTarget.dataset.name as string
    this.setData({ stmtCustomer: name })
    this.applyStmt()
  },

  onOpenCustDetail(e: WechatMiniprogram.TouchEvent) {
    const name = (e.currentTarget.dataset.name as string) || ''
    if (!name) return
    // 对账列表点行时同步选中，便于预览
    if (this.data.tab === 3) {
      this.setData({ stmtCustomer: name })
      this.applyStmt()
    }
    this.openCustomerDetail(name)
  },

  openCustomerDetail(name: string) {
    const bounds = rangeBounds(this.data.range as RangeKey, {
      from: this._customFrom,
      to: this._customTo,
    })
    this.setData({
      showCustDetail: true,
      custDetailName: name,
      custDetailRange: this.data.range === 'all' ? t('allDates') : bounds.label,
      custDetailLoading: true,
    })
    this.refreshCustomerDetail()
  },

  closeCustomerDetail() {
    this.setData({ showCustDetail: false })
  },

  paintCustomerDetail(orders: OrderBrief[], name: string) {
    const bounds = rangeBounds(this.data.range as RangeKey, {
      from: this._customFrom,
      to: this._customTo,
    })
    const detail = computeCustomerDetail(orders, name, bounds.from, bounds.to)
    this.setData({
      custDetailLoading: false,
      custDetailRange: this.data.range === 'all' ? t('allDates') : bounds.label,
      custSummary: detail.summary,
      custLabels: detail.labels,
      custByCode: locCustCodes(detail.byCode),
      custOrders: detail.orders.map((o) => ({
        ...o,
        qtyLabel: `${String(o.qtyLabel).replace(/件$/, '')}${t('unitPiece')}`,
        kindLabel: o.kindLabel === '退单' || o.kindLabel === t('tagReturn') ? t('tagReturn') : t('saleKind'),
        statusChips: (o.statusChips || []).map((c: { label: string; tone: string }) => ({
          ...c,
          label: locChip(c.label),
        })),
      })),
    })
  },

  refreshCustomerDetail() {
    const name = this.data.custDetailName
    if (!name) return
    const local = this._orders.filter((o) => (o.customerName || '').trim() === name)
    if (local.length || isGuest() || !isLoggedIn()) {
      this.paintCustomerDetail(local.length ? local : this._orders, name)
      return
    }
    const q = this.statsQuery()
    void fetchStmtOrders({
      customer: name,
      range: q.range,
      from: q.from,
      to: q.to,
    }).then((r) => {
      const orders = r.ok && r.orders.length ? r.orders : this._orders
      this._stmtOrders = orders
      this.paintCustomerDetail(orders, name)
    })
  },

  async onPreviewStatement() {
    const name = this.data.stmtCustomer
    if (!name) return
    const bounds = rangeBounds(this.data.range as RangeKey, {
      from: this._customFrom,
      to: this._customTo,
    })
    const inRange = (o: OrderBrief) => {
      if ((o.customerName || '').trim() !== name) return false
      const d = orderCreatedAt(o.createdAt)
      if (!d) return false
      return d >= bounds.from && d <= bounds.to
    }
    let orders: OrderBrief[] = []
    if (!isGuest() && isLoggedIn()) {
      wx.showLoading({ title: t('loading'), mask: true })
      const q = this.statsQuery()
      const r = await fetchStmtOrders({
        customer: name,
        range: q.range,
        from: q.from,
        to: q.to,
      })
      wx.hideLoading()
      if (r.ok) orders = r.orders
    }
    if (!orders.length) {
      orders = this._orders.filter(inRange)
    }
    const payload = buildStmtPreview(
      this._shop?.shopName || '图可',
      name,
      orders,
      bounds.label,
      this.data.stmtUnpaidOnly,
    )
    holdStmtPreview(payload)
    wx.navigateTo({
      url: '/pages/statement-preview/statement-preview',
      fail: (err) => {
        const msg = String((err && (err as any).errMsg) || '')
        console.error('[analytics] open statement-preview fail', msg)
        wx.showToast({
          title: /timeout|download/i.test(msg) ? '分包加载超时，请重试' : t('openPreviewFail'),
          icon: 'none',
        })
      },
    })
  },
})
