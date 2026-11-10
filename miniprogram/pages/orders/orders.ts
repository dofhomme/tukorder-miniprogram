import { isLoggedIn, canBrowseApp, isGuest } from '../../services/session'
import { getTabItems, i18nState, t, tabIndexFor } from '../../services/i18n'
import { requireCloudAccount } from '../../services/account-gate'
import { isCloudSyncAllowed, refreshEntitlement } from '../../services/subscription'
import {
  fetchAllOrdersFull,
  fetchOrders,
  flushOrderSyncQueue,
  getOrdersLastSyncMs,
  markOrdersLastSyncNow,
  markOrdersPullHorizon,
  mergeRemoteOrdersIntoCache,
  peekCachedOrders,
  replaceOrderInCache,
  upsertOrderInCache,
} from '../../services/team'
import type { CartItem, OrderBrief } from '../../services/team'
import {
  agentFulfillmentOf,
  agentOrderKind,
  fetchAgentMe,
  type LookupOrder,
} from '../../services/lookup'
import { isAgentWorkspace, openAgentProfileGate, peekAgentOwnerId, peekAgentProfileOk, tabBarTheme } from '../../services/workspace'
import { applyCapsuleStyle, capsuleStyleDefaults } from '../../utils/nav'
import { loadSheetKit, type SheetKit } from '../../services/pack-lazy'
import { takeVoiceJump } from '../../services/voice-jump'

type PaidFilter = 'all' | 'paid' | 'unpaid'
type FulfillFilter =
  | 'all'
  | 'shipped'
  | 'delivered'
  | 'pickedUp'
  | 'unpickedUp'
  | 'refunded'
  | 'unrefunded'
  | 'agentPending'
type DatePreset = 'all' | 'today' | 'week' | 'd15' | 'month' | 'custom'

type StatusChip = { label: string; tone: string }

type OrderRow = {
  orderNo: string
  customerName: string
  isReturn: boolean
  amountLabel: string
  amountNeg: boolean
  timeLabel: string
  metaLine: string
  chips: StatusChip[]
}

type DayGroup = {
  key: string
  dateLabel: string
  count: number
  amountLabel: string
  negative: boolean
  expanded: boolean
  orders: OrderRow[]
}

const SEARCH_DEBOUNCE_MS = 180

type IndexedOrder = OrderBrief & {
  _ts: number
  _dayKey: string
  _hay: string
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function toDateLabel(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function toDateTimeLabel(raw?: string | null) {
  if (!raw) return ''
  // 服务端 naive DATETIME：按字面展示，勿 new Date(isoZ) 再偏时区
  const s = String(raw).trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return `${toDateLabel(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 解析订单时间：naive 字符串按本地墙钟，避免 UTC 偏移 */
function parseOrderDate(raw?: string | null): Date {
  if (!raw) return new Date(0)
  const s = String(raw).trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s)
  if (m) {
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] || 0),
    )
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? new Date(0) : d
}

function indexOrder(o: OrderBrief): IndexedOrder {
  const d = parseOrderDate(o.createdAt)
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const parts: string[] = [
    String(o.customerName || ''),
    String(o.customerPhone || ''),
    String(o.orderNo || ''),
    String(o.creatorName || ''),
  ]
  const items = o.items || []
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as { productCode?: string; productName?: string }
    parts.push(String(it.productCode || ''), String(it.productName || ''))
  }
  return {
    ...o,
    _ts: d.getTime(),
    _dayKey: toDateLabel(day),
    _hay: parts.join('\u0001').toLowerCase(),
  }
}

const BILL_HEAD = [
  '日期',
  '单号',
  '客户',
  '电话',
  '类型',
  '收款',
  '拿货',
  '发货',
  '送货',
  '货号',
  '品名',
  '颜色',
  '尺码',
  '单位',
  '数量',
  '单价',
  '小计',
  '账单合计',
  '备注',
  '开单人',
]

function guardCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

function numCell(n: number): string {
  if (!Number.isFinite(n)) return ''
  const s = String(Math.round(n * 100) / 100)
  return /e/i.test(s) ? n.toFixed(2) : s
}

function yesNo(on?: boolean): string {
  return on ? '是' : '否'
}

function colorSizeOf(it: CartItem): { color: string; size: string } {
  const color = String(it.color || '').trim()
  const size = String(it.size || '').trim()
  if (color || size) return { color, size }
  const spec = String(it.spec || '').trim()
  if (!spec) return { color: '', size: '' }
  const parts = spec.split(/[/|｜]/).map((x) => x.trim()).filter(Boolean)
  if (parts.length >= 2) return { color: parts[0], size: parts.slice(1).join('') }
  return { color: spec, size: '' }
}

function billRows(orders: IndexedOrder[]): string[][] {
  const body: string[][] = []
  for (const order of orders) {
    const when = parseOrderDate(order.createdAt)
    const date = when.getTime()
      ? `${toDateLabel(when)} ${pad2(when.getHours())}:${pad2(when.getMinutes())}`
      : order._dayKey
    const pay = order.isReturn ? (order.isPaid ? '已退款' : '未退款') : order.isPaid ? '已收款' : '未收款'
    const remark = [order.remark, order.returnReason].map((x) => String(x || '').trim()).filter(Boolean).join(' ')
    const head = [
      date,
      String(order.orderNo || ''),
      String(order.customerName || ''),
      String(order.customerPhone || ''),
      order.isReturn ? '退单' : '销售',
      pay,
      yesNo(order.isPickedUp),
      yesNo(order.isShipped),
      yesNo(order.isDelivered),
    ]
    const tail = [remark, String(order.creatorName || '')]
    const items = order.items || []
    const total = numCell(Number(order.totalAmount || 0))
    if (!items.length) {
      body.push(
        [...head, '', '', '', '', '', numCell(Number(order.totalQuantity || 0)), '', total, total, ...tail].map(guardCell),
      )
      continue
    }
    items.forEach((it, index) => {
      const spec = colorSizeOf(it)
      body.push(
        [
          ...head,
          String(it.productCode || ''),
          String(it.productName || ''),
          spec.color,
          spec.size,
          String(it.unit || ''),
          numCell(Number(it.quantity || 0)),
          numCell(Number(it.price || 0)),
          numCell(Number(it.subtotal || 0)),
          index === 0 ? total : '',
          ...tail,
        ].map(guardCell),
      )
    })
  }
  return body
}

function splitBillFiles(body: string[][]): string[][][] {
  const files: string[][][] = []
  let file: string[][] = []
  let i = 0
  while (i < body.length) {
    const no = body[i][1]
    let j = i + 1
    while (j < body.length && body[j][1] === no) j++
    const group = body.slice(i, j)
    if (file.length && file.length + group.length > 5000) {
      files.push(file)
      file = []
    }
    file.push(...group)
    i = j
  }
  if (file.length) files.push(file)
  return files
}

function toMoneyLabel(n: number) {
  const body = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return n < 0 ? `¥ -${body}` : `¥ ${body}`
}

function paidFilterLabel(k: string) {
  if (k === 'paid') return t('paid')
  if (k === 'unpaid') return t('unpaid')
  return t('paidStatus')
}

function fulfillFilterLabel(k: string) {
  if (k === 'shipped') return t('shipped')
  if (k === 'delivered') return t('delivered')
  if (k === 'pickedUp') return t('picked')
  if (k === 'unpickedUp') return t('unpicked')
  if (k === 'refunded') return t('refunded')
  if (k === 'unrefunded') return t('unrefunded')
  if (k === 'agentPending') return t('agentPendingStat')
  return t('fulfillStatus')
}

function paidFilterOptions() {
  return [
    { k: 'all', label: t('all') },
    { k: 'paid', label: t('paid') },
    { k: 'unpaid', label: t('unpaid') },
  ]
}

function fulfillFilterOptions() {
  return [
    { k: 'all', label: t('all') },
    { k: 'shipped', label: t('shipped') },
    { k: 'delivered', label: t('delivered') },
    { k: 'pickedUp', label: t('picked') },
    { k: 'unpickedUp', label: t('unpicked') },
    { k: 'refunded', label: t('refunded') },
    { k: 'unrefunded', label: t('unrefunded') },
    { k: 'agentPending', label: t('agentPendingStat') },
  ]
}

function dateFilterOptions() {
  return [
    { k: 'all', label: t('allDates') },
    { k: 'today', label: t('today') },
    { k: 'week', label: t('last7') },
    { k: 'd15', label: t('last15') },
    { k: 'month', label: t('last30') },
    { k: 'custom', label: t('customPeriod') },
  ]
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || '').trim())
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** 对齐 App OrderStatusChips */
function orderStatusChips(o: OrderBrief): StatusChip[] {
  const chips: StatusChip[] = []
  if (o.isReturn) {
    chips.push({
      label: o.isPaid ? t('refunded') : t('unrefunded'),
      tone: o.isPaid ? 'paid' : 'muted',
    })
  } else if (o.isPaid) {
    chips.push({ label: t('paid'), tone: 'paid' })
  } else {
    chips.push({ label: t('unpaid'), tone: 'unpaid' })
  }
  if (o.isPickedUp) {
    chips.push({
      label: o.isReturn ? t('received') : t('picked'),
      tone: 'picked',
    })
  }
  const tracking = Array.isArray(o.trackingNos)
    ? o.trackingNos.filter(Boolean)
    : []
  if (o.isShipped || tracking.length) {
    chips.push({ label: t('shipped'), tone: 'shipped' })
  }
  if (o.isDelivered) chips.push({ label: t('delivered'), tone: 'delivered' })
  const agent = agentOrderKind(o.remark)
  if (agent === 'pending') chips.push({ label: t('agentPendingStat'), tone: 'agent' })
  else if (agent === 'agent') chips.push({ label: t('agentBadge'), tone: 'agent' })
  return chips
}

function orderMetaLine(o: OrderBrief): string {
  const parts: string[] = []
  const when = toDateTimeLabel(o.createdAt)
  if (when) parts.push(when)
  const who = (o.creatorName || '').trim()
  if (who) parts.push(`${t('orderedBy')}${shortBillName(who)}`)
  return parts.join('  ·  ')
}

function shortBillName(name: string): string {
  return Array.from(name)[0] || ''
}

function buildOrderRows(orders: IndexedOrder[]): OrderRow[] {
  return orders
    .slice()
    .sort((a, b) => b._ts - a._ts)
    .map((o) => {
      const amt = Number(o.totalAmount || 0)
      return {
        orderNo: o.orderNo,
        customerName: (o.customerName || '').trim() || t('walkin'),
        isReturn: !!o.isReturn,
        amountLabel: Math.abs(amt).toFixed(2),
        amountNeg: amt < 0,
        timeLabel: toDateTimeLabel(o.createdAt),
        metaLine: orderMetaLine(o),
        chips: orderStatusChips(o),
      }
    })
}

function dayStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function dayEnd(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime()
}

function resolveDateRange(
  preset: DatePreset,
  customFrom = '',
  customTo = '',
): {
  fromTs: number
  toTs: number
  fromLabel: string
  toLabel: string
  presetLabel: string
  dateLabel: string
} | null {
  if (preset === 'all') return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (preset === 'custom') {
    const a = parseYmd(customFrom)
    const b = parseYmd(customTo)
    if (!a || !b) return null
    const from = a.getTime() <= b.getTime() ? a : b
    const to = a.getTime() <= b.getTime() ? b : a
    const fromLabel = toDateLabel(from)
    const toLabel = toDateLabel(to)
    return {
      fromTs: dayStart(from),
      toTs: dayEnd(to),
      fromLabel,
      toLabel,
      presetLabel: t('customPeriod'),
      dateLabel: `${fromLabel} — ${toLabel}`,
    }
  }
  let from = today
  let presetLabel = t('today')
  if (preset === 'd15') {
    from = new Date(today.getTime() - 14 * 86400000)
    presetLabel = t('last15')
  } else if (preset === 'week') {
    from = new Date(today.getTime() - 6 * 86400000)
    presetLabel = t('last7')
  } else if (preset === 'month') {
    from = new Date(today.getTime() - 29 * 86400000)
    presetLabel = t('last30')
  }
  const fromLabel = toDateLabel(from)
  const toLabel = toDateLabel(today)
  return {
    fromTs: dayStart(from),
    toTs: dayEnd(today),
    fromLabel,
    toLabel,
    presetLabel,
    dateLabel: `${fromLabel} — ${toLabel}`,
  }
}

Page({
  data: {
    loading: false,
    loadingMore: false,
    hasMore: true,
    groups: [] as DayGroup[],
    keyword: '',
    searchPlaceholder: t('searchAllOrders'),
    paidFilter: 'all' as PaidFilter,
    paidLabel: t('paidStatus'),
    fulfillFilter: 'all' as FulfillFilter,
    fulfillLabel: t('fulfillStatus'),
    datePreset: 'd15' as DatePreset,
    datePresetLabel: t('last15'),
    dateLabel: t('last15'),
    customFrom: '',
    customTo: '',
    /** 当前选定时间范围（搜索/列表共用，避免与 preset 不同步） */
    dateFromTs: 0,
    dateToTs: 0,
    dateRangeActive: true,
    listSyncing: false,
    filterVisible: false,
    filterKind: '' as '' | 'paid' | 'fulfill' | 'date',
    filterTitle: '',
    filterCurrent: '',
    filterOptions: [] as Array<{ k: string; label: string }>,
    guestMode: false,
    agentMode: false,
    agentFilter: '' as '' | 'pending' | 'shipped' | 'rejected',
    exportOn: false,
    exportHint: '',
    exportHead: [] as string[],
    exportRows: [] as string[][],
    agentOrders: [] as Array<
      LookupOrder & { amountLabel: string; flagLabel: string; dateLabel: string; fulfillKind: string }
    >,
    ...capsuleStyleDefaults(),
    ...i18nState(),
  },

  onReady() {
    applyCapsuleStyle(this)
  },

  _all: [] as IndexedOrder[],
  _allSrc: null as OrderBrief[] | null,
  _filtered: [] as IndexedOrder[],
  _offset: 0,
  _hasMore: true,
  _cloudOffset: 0,
  _cloudDone: false,
  _cloudKey: '',
  _paging: false,
  _rangeFetched: {} as Record<string, true>,
  _loadingMore: false,
  _expanded: {} as Record<string, boolean>,
  _sheetOpen: false,
  _kwTimer: 0 as number,
  _alive: true,
  _agentAll: [] as LookupOrder[],
  _agentFilter: '' as '' | 'pending' | 'shipped' | 'rejected',

  applyLocale() {
    const extra: Record<string, unknown> = {}
    if (this.data.filterVisible) {
      if (this.data.filterKind === 'paid') {
        extra.filterTitle = t('paidStatus')
        extra.filterOptions = paidFilterOptions()
      } else if (this.data.filterKind === 'fulfill') {
        extra.filterTitle = t('fulfillStatus')
        extra.filterOptions = fulfillFilterOptions()
      } else if (this.data.filterKind === 'date') {
        extra.filterTitle = t('date')
        extra.filterOptions = dateFilterOptions()
      }
    }
    this.setData({
      ...i18nState(),
      paidLabel: paidFilterLabel(this.data.paidFilter),
      fulfillLabel: fulfillFilterLabel(this.data.fulfillFilter),
      ...extra,
    })
    wx.setNavigationBarTitle({ title: t('navOrders') })
    this.syncDateRange(this.data.datePreset)
    if (this._all.length) {
      try {
        this.apply()
      } catch (_) {}
    }
    try {
      const sheet = this.selectComponent('#odSheet') as WechatMiniprogram.Component.TrivialInstance & {
        applyLocale?: () => void
      }
      if (sheet && typeof sheet.applyLocale === 'function') sheet.applyLocale()
    } catch (_) {}
  },

  onShow() {
    this._alive = true
    try {
      wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage', 'shareTimeline'] })
    } catch (_) {}
    try {
      this.applyLocale()
    } catch (_) {}
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      // 弹出层打开时保持底栏隐藏
      this.getTabBar().setData({
        selected: tabIndexFor('orders'),
        hidden: !!this._sheetOpen,
        list: getTabItems(),
        theme: tabBarTheme(),
      })
    }
    const jump = takeVoiceJump('orders')
    if (jump && jump.keyword) this.setData({ keyword: jump.keyword })
    if (isAgentWorkspace()) {
      this.setData({ agentMode: true, guestMode: false, loading: true })
      wx.setNavigationBarTitle({ title: t('tabAgentOrders') })
      if (!peekAgentProfileOk()) {
        openAgentProfileGate()
        return
      }
      void this.loadAgentOrders()
      return
    }
    this.setData({ agentMode: false, guestMode: false })
    this.syncDateRange(this.data.datePreset)
    try {
      const filt = String(wx.getStorageSync('tuk_merchant_order_filter') || '')
      wx.removeStorageSync('tuk_merchant_order_filter')
      if (filt === 'agentPending') {
        this.setData({
          fulfillFilter: 'agentPending',
          fulfillLabel: fulfillFilterLabel('agentPending'),
        })
      }
    } catch (_) {}
    this.renderFromCache()
    void flushOrderSyncQueue()
    if (!isGuest() && isLoggedIn()) {
      if (!this._all.length) this.setData({ loading: true })
      void this.ensureCloudForRange()
    } else {
      this.setData({ loading: false })
    }
  },

  agentFlagLabel(o: LookupOrder) {
    const kind = agentOrderKind(o.remark)
    if (kind === 'pending') return t('agentPendingStat')
    if (kind === 'rejected') return t('agentRejected')
    const bits: string[] = []
    bits.push(o.isPaid ? t('tagPaid') : t('tagUnpaid'))
    if (kind === 'agent') bits.push(t('agentBadge'))
    if (o.isShipped) bits.push(t('tagShipped'))
    if (o.isDelivered) bits.push(t('tagDelivered'))
    return bits.join(' · ')
  },

  async loadAgentOrders() {
    this.setData({ loading: true })
    this.syncDateRange(this.data.datePreset)
    const me = await fetchAgentMe(peekAgentOwnerId() || undefined, { allOrders: true })
    this._agentAll = me.ok && me.data ? me.data.orders || [] : []
    this.setData({ loading: false })
    try {
      const filt = String(wx.getStorageSync('tuk_agent_order_filter') || '')
      wx.removeStorageSync('tuk_agent_order_filter')
      if (filt === 'pending' || filt === 'shipped' || filt === 'rejected') this._agentFilter = filt
    } catch (_) {}
    this.applyAgentList()
  },

  applyAgentList() {
    const range = this.rangeBounds()
    let list = this._agentAll
    if (range) {
      const { from, to } = range
      list = list.filter((o) => {
        const ts = parseOrderDate(o.createdAt).getTime()
        return ts >= from && ts <= to
      })
    }
    if (this._agentFilter === 'pending') {
      list = list.filter((o) => agentOrderKind(o.remark) === 'pending')
    } else if (this._agentFilter === 'shipped') {
      list = list.filter((o) => !!o.isShipped && !o.isDelivered)
    } else if (this._agentFilter === 'rejected') {
      list = list.filter((o) => agentOrderKind(o.remark) === 'rejected')
    }
    this.setData({
      agentFilter: this._agentFilter,
      agentOrders: list.map((o) => ({
        ...o,
        amountLabel: Number(o.totalAmount || 0).toFixed(2),
        flagLabel: this.agentFlagLabel(o),
        dateLabel: String(o.createdAt || '').slice(0, 16).replace('T', ' '),
        shopName: String(o.shopName || '').trim(),
        fulfillKind: agentFulfillmentOf(o),
      })),
    })
  },

  onAgentFilter(e: WechatMiniprogram.TouchEvent) {
    const k = String(e.currentTarget.dataset.k || '')
    this._agentFilter = k === 'pending' || k === 'shipped' || k === 'rejected' ? k : ''
    this.applyAgentList()
  },

  onOpenAgent(e: WechatMiniprogram.TouchEvent) {
    const token = String(e.currentTarget.dataset.token || '')
    if (!token) return
    wx.navigateTo({
      url: `/pages/order-lookup/order-lookup?token=${encodeURIComponent(token)}`,
    })
  },

  onAgentReturn() {
    wx.navigateTo({ url: '/pages/agent-return/agent-return' })
  },

  onGuestBind() {
    requireCloudAccount('sync')
  },

  /** 查看订单右上角：与订单详情同一颗更新按钮，按当前时间段拉列表。 */
  async onListSync() {
    if (this.data.listSyncing) return
    this.setData({ listSyncing: true })
    try {
      if (this.data.agentMode) {
        await this.loadAgentOrders()
        return
      }
      const key = this.rangeCloudKey()
      delete this._rangeFetched[key]
      if (!this.data.dateRangeActive) {
        this._cloudOffset = 0
        this._cloudDone = false
      }
      await this.ensureCloudForRange()
    } finally {
      if (this._alive) this.setData({ listSyncing: false })
    }
  },

  /** 列表只读本机；云端拉取在 ensureCloudForRange */
  renderFromCache() {
    const src = peekCachedOrders()
    if (src !== this._allSrc) {
      this._allSrc = src
      this._all = src.map(indexOrder)
    }
    const hasMore = !this.data.dateRangeActive && !this._cloudDone
    this._hasMore = hasMore
    this.setData({ loading: false, hasMore, loadingMore: false })
    try {
      this.apply()
    } catch (_) {
      this.setData({ groups: [] })
    }
  },

  /** 只静默拉「上次同步之后」的新单，不挡界面 */
  async silentNewOrdersPull() {
    try {
      if (!isCloudSyncAllowed()) return
      const last = getOrdersLastSyncMs()
      const sinceMs = last > 0 ? last : Date.now() - 6 * 3600 * 1000
      const r = await fetchOrders({
        full: true,
        limit: 100,
        offset: 0,
        allCreators: true,
        since: new Date(sinceMs).toISOString(),
      })
      if (!r.ok) return
      if ((r.orders || []).length) {
        mergeRemoteOrdersIntoCache(r.orders || [])
        if (this._alive) this.renderFromCache()
      }
      markOrdersLastSyncNow()
    } catch (_) {}
  },

  /**
   * 底层约定：
   * 1) 进页先读本机缓存（onShow 已 renderFromCache）
   * 2) 默认静默保证近 10 天在本地；已覆盖则只静默拉新单
   * 3) 选更长区间才静默补拉，绝不每次进页弹「下载订单…」遮罩
   * 4) 统计走存储过程，与本页无关
   */
  rangeCloudKey() {
    const range = this.rangeBounds()
    return range ? `r:${range.from}:${range.to}` : 'all'
  },

  oldestCachedTs() {
    let oldest = 0
    for (let i = 0; i < this._all.length; i++) {
      const ts = this._all[i]._ts
      if (!ts) continue
      if (!oldest || ts < oldest) oldest = ts
    }
    return oldest
  },

  /** 全部日期：从最新往后翻页。一次最多 5 页，滑到底再继续。 */
  async pullAllDatesPage() {
    if (this._cloudDone || this._paging) return
    this._paging = true
    if (this._alive) this.setData({ loadingMore: true, hasMore: true })
    try {
      const limit = 200
      const oldestBefore = this.oldestCachedTs()
      let pages = 0
      while (pages < 5 && !this._cloudDone) {
        const r = await fetchOrders({
          full: true,
          limit,
          offset: this._cloudOffset,
          allCreators: true,
        })
        if (!r.ok) {
          if (this._alive) {
            wx.showToast({
              title: (r.error || '账单下载失败').slice(0, 20),
              icon: 'none',
            })
          }
          break
        }
        const batch = r.orders || []
        if (batch.length) mergeRemoteOrdersIntoCache(batch)
        this._cloudOffset += batch.length
        pages += 1
        if (batch.length < limit) {
          this._cloudDone = true
          markOrdersPullHorizon('all')
          break
        }
        let oldest = 0
        for (let i = 0; i < batch.length; i++) {
          const ts = parseOrderDate(batch[i].createdAt).getTime()
          if (ts && (!oldest || ts < oldest)) oldest = ts
        }
        if (!oldestBefore || (oldest > 0 && oldest < oldestBefore)) break
      }
      markOrdersLastSyncNow()
      if (this._alive) this.renderFromCache()
    } finally {
      this._paging = false
      if (this._alive) this.setData({ loadingMore: false })
    }
  },

  /**
   * 有起止日期：把该起点之后的账单补进本机，再按结束日过滤。
   * 全部日期：不套近 15 天窗口，滑到底继续翻更早的页。
   */
  async ensureCloudForRange() {
    try {
      if (isGuest() || !isLoggedIn()) return
      if (!isCloudSyncAllowed()) {
        await refreshEntitlement({ force: true })
      }
      if (!isCloudSyncAllowed()) return

      const key = this.rangeCloudKey()
      const range = this.rangeBounds()
      if (key !== this._cloudKey) {
        this._cloudKey = key
        if (!range) {
          this._cloudOffset = 0
          this._cloudDone = false
        }
      }
      try {
        this.apply()
      } catch (_) {}
      if (!this._filtered.length && this._alive) this.setData({ loading: true })

      if (range) {
        if (this._rangeFetched[key]) {
          void this.silentNewOrdersPull()
          if (this._alive) this.renderFromCache()
          return
        }
        const r = await fetchAllOrdersFull({
          allCreators: true,
          since: new Date(range.from).toISOString(),
        })
        if (r.ok) {
          markOrdersLastSyncNow()
          if (this._alive) this.renderFromCache()
          if (r.complete !== false) this._rangeFetched[key] = true
        } else if (this._alive) {
          wx.showToast({
            title: (r.error || '账单下载失败').slice(0, 20),
            icon: 'none',
          })
        }
        return
      }

      if (this._cloudDone) {
        void this.silentNewOrdersPull()
        if (this._alive) this.renderFromCache()
        return
      }
      if (this._cloudOffset > 0) {
        if (this._alive) this.renderFromCache()
        return
      }
      await this.pullAllDatesPage()
    } finally {
      if (this._alive) this.setData({ loading: false })
      try {
        wx.hideLoading()
      } catch (_) {}
    }
  },

  onHide() {
    this._alive = false
    this.setData({ filterVisible: false })
  },

  _exportPaths: [] as string[],
  _exportTables: [] as string[][][],
  _exportAt: 0,
  _kit: null as SheetKit | null,

  ordersInSelectedRange(): IndexedOrder[] {
    const range = this.rangeBounds()
    if (!range) return this._all.slice()
    return this._all.filter((order) => order._ts >= range.from && order._ts <= range.to)
  },

  clearExportFiles() {
    if (this._kit) this._kit.removeExportFiles(this._exportPaths)
    this._exportPaths = []
    this._exportTables = []
    this._exportAt = 0
  },

  exportPreview() {
    const tables = this._exportTables
    const at = Math.min(this._exportAt, Math.max(0, tables.length - 1))
    const table = tables[at] || []
    const body = table.slice(1)
    const shown = body.length > 600 ? body.slice(0, 600) : body
    const orders = this.ordersInSelectedRange()
    const fileNote = tables.length > 1 ? `第 ${at + 1}/${tables.length} 个文件 · ` : ''
    const tail = shown.length < body.length ? `，预览前 ${shown.length} 行` : ''
    return {
      exportHead: table[0] || BILL_HEAD,
      exportRows: shown,
      exportXHeight: Math.max(64, (shown.length + 1) * 64),
      exportHint: `${this.data.dateLabel} · ${fileNote}共 ${orders.length} 单、${body.length} 行${tail}，可上下滑动查看。确认后点发送到聊天。`,
    }
  },

  async onExportAsk() {
    const orders = this.ordersInSelectedRange()
    if (!orders.length) {
      wx.showToast({ title: '该时段没有账单', icon: 'none' })
      return
    }
    let kit = this._kit
    if (!kit) {
      try {
        wx.showLoading({ title: '请稍候', mask: true })
        kit = await loadSheetKit()
        this._kit = kit
      } catch (_) {
        wx.showToast({ title: '导出模块加载失败', icon: 'none' })
        return
      } finally {
        try {
          wx.hideLoading()
        } catch (_) {}
      }
    }
    wx.showActionSheet({
      itemList: ['导出 Excel', '导出 CSV'],
      success: (res) => {
        const kind = res.tapIndex === 1 ? 'csv' : 'xlsx'
        const body = billRows(orders.slice().sort((a, b) => b._ts - a._ts))
        const files = splitBillFiles(body).map((rows) => [BILL_HEAD, ...rows])
        this.clearExportFiles()
        try {
          this._exportTables = files
          this._exportPaths = files.map((table, index) => kit.writeExportFile(table, kind, index + 1, 'orders'))
          this._exportAt = 0
          this.setData({ exportOn: true, ...this.exportPreview() })
        } catch (_) {
          this.clearExportFiles()
          wx.showToast({ title: '导出失败', icon: 'none' })
        }
      },
    })
  },

  onExportClose() {
    this.clearExportFiles()
    this.setData({ exportOn: false, exportRows: [], exportHead: [] })
  },

  onSendExport() {
    const path = this._exportPaths[this._exportAt]
    if (!path) return
    const share = (wx as WechatMiniprogram.Wx & {
      shareFileMessage?: (opts: { filePath: string; fail?: () => void; success?: () => void }) => void
    }).shareFileMessage
    if (!share) {
      wx.showToast({ title: '当前微信不能直接发送，请打开文件后再转发', icon: 'none' })
      return
    }
    share({
      filePath: path,
      fail: () => wx.showToast({ title: '发送失败，可以改用打开', icon: 'none' }),
      success: () => {
        this._exportAt += 1
        if (this._exportAt >= this._exportPaths.length) {
          wx.showToast({ title: '已发送', icon: 'success' })
        } else {
          this.setData(this.exportPreview())
          wx.showToast({ title: `还剩 ${this._exportPaths.length - this._exportAt} 个文件`, icon: 'none' })
        }
      },
    })
  },

  onOpenExport() {
    const path = this._exportPaths[Math.min(this._exportAt, Math.max(0, this._exportPaths.length - 1))]
    if (!path) return
    const fileType = /\.xlsx$/i.test(path) ? 'xlsx' : ''
    wx.openDocument({
      filePath: path,
      showMenu: true,
      ...(fileType ? { fileType: fileType as 'xlsx' } : {}),
      fail: () => wx.showToast({ title: '打不开这个文件', icon: 'none' }),
    })
  },

  onUnload() {
    if (this._kwTimer) clearTimeout(this._kwTimer)
    this.clearExportFiles()
  },

  onReachBottom() {
    void this.loadMore()
  },

  onPullDownRefresh() {
    void (async () => {
      if (isAgentWorkspace()) {
        await this.loadAgentOrders()
        return
      }
      this.renderFromCache()
      await flushOrderSyncQueue()
      if (!isGuest() && isLoggedIn()) {
        if (!this.data.dateRangeActive && !this._cloudDone) {
          await this.pullAllDatesPage()
        } else {
          await this.ensureCloudForRange()
        }
      }
    })().finally(() => wx.stopPullDownRefresh())
  },

  /** 把顶部日期范围写成唯一真相源；搜索只扫 dateFromTs~dateToTs */
  syncDateRange(preset: DatePreset) {
    const resolved = resolveDateRange(preset, this.data.customFrom, this.data.customTo)
    if (preset === 'custom' && !resolved) {
      this.data.datePreset = 'custom'
      this.data.dateRangeActive = false
      this.data.dateFromTs = 0
      this.data.dateToTs = 0
      this.setData({
        datePreset: 'custom',
        datePresetLabel: t('customPeriod'),
        dateLabel: t('customPeriod'),
        dateFromTs: 0,
        dateToTs: 0,
        dateRangeActive: false,
        searchPlaceholder: t('searchAllOrders'),
      })
      return
    }
    if (!resolved) {
      this.data.dateFromTs = 0
      this.data.dateToTs = 0
      this.data.dateRangeActive = false
      this.setData({
        datePreset: 'all',
        datePresetLabel: t('allDates'),
        dateLabel: t('allDates'),
        dateFromTs: 0,
        dateToTs: 0,
        dateRangeActive: false,
        searchPlaceholder: t('searchAllOrders'),
      })
      return
    }
    this.data.dateFromTs = resolved.fromTs
    this.data.dateToTs = resolved.toTs
    this.data.dateRangeActive = true
    this.setData({
      datePreset: preset,
      datePresetLabel: resolved.presetLabel,
      dateLabel: resolved.dateLabel,
      dateFromTs: resolved.fromTs,
      dateToTs: resolved.toTs,
      dateRangeActive: true,
      searchPlaceholder: `${t('searchIn')}${resolved.presetLabel}${t('searchOrders')}`,
    })
  },

  async load(_reset: boolean) {
    this.renderFromCache()
    if (!isGuest() && isLoggedIn()) {
      await this.ensureCloudForRange()
    }
  },

  async loadMore() {
    if (this.data.dateRangeActive || this._cloudDone || this._paging) return
    await this.pullAllDatesPage()
  },

  onKeyword(e: WechatMiniprogram.Input) {
    this.setData({ keyword: e.detail.value })
    if (this._kwTimer) clearTimeout(this._kwTimer)
    this._kwTimer = setTimeout(() => {
      this._kwTimer = 0
      this.apply()
    }, SEARCH_DEBOUNCE_MS) as unknown as number
  },

  onClearKeyword() {
    if (this._kwTimer) clearTimeout(this._kwTimer)
    this._kwTimer = 0
    this.setData({ keyword: '' })
    this.apply()
  },

  onSearch() {
    if (this._kwTimer) clearTimeout(this._kwTimer)
    this._kwTimer = 0
    this.apply()
  },

  rangeBounds(): { from: number; to: number } | null {
    if (!this.data.dateRangeActive) return null
    const from = Number(this.data.dateFromTs || 0)
    const to = Number(this.data.dateToTs || 0)
    if (!from || !to) return null
    return { from, to }
  },

  apply() {
    const q = (this.data.keyword || '').trim().toLowerCase()
    const paid = this.data.paidFilter
    const fulfill = this.data.fulfillFilter
    const range = this.rangeBounds()

    // 1) 先限定当前选定时间范围，再搜关键字（绝不出圈）
    let list = this._all
    if (range) {
      const { from, to } = range
      list = list.filter((o) => o._ts >= from && o._ts <= to)
    }
    if (paid === 'paid') list = list.filter((o) => !!o.isPaid)
    else if (paid === 'unpaid') list = list.filter((o) => !o.isPaid)
    if (fulfill === 'shipped') list = list.filter((o) => !!o.isShipped)
    else if (fulfill === 'delivered') list = list.filter((o) => !!o.isDelivered)
    else if (fulfill === 'pickedUp') list = list.filter((o) => !!o.isPickedUp)
    else if (fulfill === 'unpickedUp') list = list.filter((o) => !o.isPickedUp)
    else if (fulfill === 'refunded') list = list.filter((o) => !!o.isReturn && !!o.isPaid)
    else if (fulfill === 'unrefunded') list = list.filter((o) => !!o.isReturn && !o.isPaid)
    else if (fulfill === 'agentPending') list = list.filter((o) => agentOrderKind(o.remark) === 'pending')

    if (q) {
      list = list.filter((o) => o._hay.includes(q))
    }

    this._filtered = list

    const map = new Map<string, { orders: IndexedOrder[] }>()
    for (let i = 0; i < list.length; i++) {
      const o = list[i]
      const key = o._dayKey
      let g = map.get(key)
      if (!g) {
        g = { orders: [] }
        map.set(key, g)
      }
      g.orders.push(o)
    }

    const groups: DayGroup[] = Array.from(map.entries())
      .map(([key, g]) => {
        let amount = 0
        for (let i = 0; i < g.orders.length; i++) {
          amount += Number(g.orders[i].totalAmount || 0)
        }
        const expanded = !!this._expanded[key]
        return {
          key,
          dateLabel: key,
          count: g.orders.length,
          amountLabel: toMoneyLabel(amount),
          negative: amount < 0,
          expanded,
          orders: expanded ? buildOrderRows(g.orders) : [],
        }
      })
      .sort((a, b) => (a.key < b.key ? 1 : -1))

    this.setData({ groups })
  },

  onToggleDay(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || '')
    if (!key) return
    this._expanded[key] = !this._expanded[key]
    const expanded = !!this._expanded[key]
    const dayOrders = expanded
      ? this._filtered.filter((o) => o._dayKey === key)
      : []
    const groups = (this.data.groups || []).map((g) =>
      g.key === key
        ? {
            ...g,
            expanded,
            orders: expanded ? buildOrderRows(dayOrders) : [],
          }
        : g,
    )
    this.setData({ groups })
  },

  noop() {},

  openFilterSheet(
    kind: 'paid' | 'fulfill' | 'date',
    title: string,
    options: Array<{ k: string; label: string }>,
    current: string,
  ) {
    this.setData({
      filterVisible: true,
      filterKind: kind,
      filterTitle: title,
      filterOptions: options,
      filterCurrent: current,
    })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ hidden: true })
    }
  },

  onFilterClose() {
    this.setData({ filterVisible: false })
    if (!this._sheetOpen && typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: tabIndexFor('orders'), hidden: false })
    }
  },

  onFilterPick(e: WechatMiniprogram.TouchEvent) {
    const k = String(e.currentTarget.dataset.k || '')
    const kind = this.data.filterKind
    this.setData({ filterVisible: false })
    if (!this._sheetOpen && typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: tabIndexFor('orders'), hidden: false })
    }
    if (!k || !kind) return

    if (kind === 'paid') {
      this.setData(
        {
          paidFilter: k as PaidFilter,
          paidLabel: paidFilterLabel(k),
        },
        () => this.apply(),
      )
      return
    }
    if (kind === 'fulfill') {
      this.setData(
        {
          fulfillFilter: k as FulfillFilter,
          fulfillLabel: fulfillFilterLabel(k),
        },
        () => this.apply(),
      )
      return
    }
    if (kind === 'date') {
      if (k === 'custom' && (!this.data.customFrom || !this.data.customTo)) {
        const today = new Date()
        const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)
        this.data.customFrom = ymd(from)
        this.data.customTo = ymd(today)
        this.setData({ customFrom: this.data.customFrom, customTo: this.data.customTo })
      }
      this.syncDateRange(k as DatePreset)
      if (this.data.agentMode) {
        this.applyAgentList()
        return
      }
      this.apply()
      void this.ensureCloudForRange()
    }
  },

  onPickPaid() {
    this.openFilterSheet(
      'paid',
      t('paidStatus'),
      paidFilterOptions(),
      this.data.paidFilter,
    )
  },

  onPickFulfill() {
    this.openFilterSheet(
      'fulfill',
      t('fulfillStatus'),
      fulfillFilterOptions(),
      this.data.fulfillFilter,
    )
  },

  onPickDatePreset() {
    this.openFilterSheet(
      'date',
      t('date'),
      dateFilterOptions(),
      this.data.datePreset,
    )
  },

  onCustomFrom(e: WechatMiniprogram.PickerChange) {
    const customFrom = String(e.detail.value || '')
    this.data.customFrom = customFrom
    this.setData({ customFrom })
    this.syncDateRange('custom')
    if (this.data.agentMode) this.applyAgentList()
    else {
      this.apply()
      void this.ensureCloudForRange()
    }
  },

  onCustomTo(e: WechatMiniprogram.PickerChange) {
    const customTo = String(e.detail.value || '')
    this.data.customTo = customTo
    this.setData({ customTo })
    this.syncDateRange('custom')
    if (this.data.agentMode) this.applyAgentList()
    else {
      this.apply()
      void this.ensureCloudForRange()
    }
  },

  onOpenStats(e: WechatMiniprogram.TouchEvent) {
    const tab = String(e.currentTarget.dataset.tab || '0')
    wx.navigateTo({
      url: `/pages/analytics/analytics?tab=${tab}`,
      fail: () => wx.showToast({ title: '无法打开统计', icon: 'none' }),
    })
  },

  onOpen(e: WechatMiniprogram.TouchEvent) {
    const orderNo = String(e.currentTarget.dataset.orderno || '')
    if (!orderNo) return
    // 立刻弹出层，不 navigateTo 整页（对齐 App）；传入列表内存订单，首帧即有内容
    const seed = this._all.find((o) => o.orderNo === orderNo) || null
    this._sheetOpen = true
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ hidden: true })
    }
    const sheet = this.selectComponent('#odSheet') as WechatMiniprogram.Component.TrivialInstance & {
      open?: (no: string, seed?: OrderBrief | null) => void
    }
    if (sheet && typeof sheet.open === 'function') {
      sheet.open(orderNo, seed)
      return
    }
    this._sheetOpen = false
    wx.navigateTo({
      url: `/pages/order-detail/order-detail?orderNo=${encodeURIComponent(orderNo)}`,
    })
  },

  onSheetOpen() {
    this._sheetOpen = true
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ hidden: true })
    }
  },

  onSheetClose() {
    this._sheetOpen = false
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: tabIndexFor('orders'), hidden: false })
    }
  },

  onSheetDeleted() {
    this.renderFromCache()
  },

  /** 履约变更：就地补丁列表，避免整表重拉导致弹出层下方卡顿 */
  onSheetUpdated(e: WechatMiniprogram.CustomEvent) {
    const patched = (e.detail || {}).order as OrderBrief | undefined
    if (!patched || !patched.orderNo) {
      void this.load(true)
      return
    }
    const idx = this._all.findIndex((o) => o.orderNo === patched.orderNo)
    if (idx < 0) {
      void this.load(true)
      return
    }
    this._all[idx] = indexOrder({ ...this._all[idx], ...patched })
    if ((e.detail || {}).fromCloud) replaceOrderInCache(patched)
    else upsertOrderInCache(this._all[idx])
    this.apply()
  },

  onShareAppMessage() {
    return { title: t('navOrders'), path: '/pages/orders/orders' }
  },

  onShareTimeline() {
    return { title: t('tabOrderShort') }
  },
})
