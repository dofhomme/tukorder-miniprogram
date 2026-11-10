import type { CartItem, OrderBrief } from './team'
import { consumeTeamStatsDirty, markTeamStatsDirty } from './team'

export type RangeKey = '7d' | '10d' | '15d' | '30d' | 'month' | 'custom' | 'all'

export interface AnalyticsSummary {
  orderCount: number
  totalAmount: number
  totalQty: number
  unpaidCount: number
  unpaidAmount: number
  returnOrderCount: number
  returnAmount: number
  returnQty: number
  unrefundedCount: number
  unrefundedAmount: number
  paidCount: number
  paidAmount: number
}

export interface NamedStat {
  name: string
  count: number
  amount: number
  amountLabel: string
  countLabel: string
  barPct: number
}

export interface CodeStat {
  code: string
  qty: number
  amount: number
  amountLabel: string
  qtyLabel: string
  barPct: number
}

export interface DayStat {
  day: string
  count: number
  amount: number
  amountLabel: string
  barPct: number
}

export interface RateStat {
  name: string
  salesCount: number
  salesAmount: number
  returnCount: number
  returnAmount: number
  rate: number
  rateLabel: string
  detail: string
  barPct: number
}

export interface CodeRateStat {
  code: string
  soldQty: number
  returnQty: number
  returnAmount: number
  rate: number
  rateLabel: string
  detail: string
  barPct: number
}

export interface StmtCustomer {
  name: string
  count: number
  amount: number
  unpaidAmount: number
  unpaidCount: number
  amountLabel: string
  unpaidLabel: string
  /** 列表展示：按时段合计或「未付 x 单」 */
  listLabel: string
}

function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function formatMoney(n: number): string {
  const neg = n < 0
  const abs = Math.abs(n).toFixed(2)
  const [intPart, dec] = abs.split('.')
  const withComma = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${withComma}.${dec}`
}

export function rangeBounds(
  key: RangeKey,
  custom?: { from: string; to: string },
): { from: Date; to: Date; label: string } {
  const to = new Date()
  to.setHours(23, 59, 59, 999)
  const from = new Date(to)
  let label = ''
  if (key === '7d') {
    from.setDate(from.getDate() - 6)
    from.setHours(0, 0, 0, 0)
    label = `${dayKey(from)} ~ ${dayKey(to)}`
  } else if (key === '10d') {
    from.setDate(from.getDate() - 9)
    from.setHours(0, 0, 0, 0)
    label = `${dayKey(from)} ~ ${dayKey(to)}`
  } else if (key === '15d') {
    from.setDate(from.getDate() - 14)
    from.setHours(0, 0, 0, 0)
    label = `${dayKey(from)} ~ ${dayKey(to)}`
  } else if (key === '30d') {
    from.setDate(from.getDate() - 29)
    from.setHours(0, 0, 0, 0)
    label = `${dayKey(from)} ~ ${dayKey(to)}`
  } else if (key === 'month') {
    from.setDate(1)
    from.setHours(0, 0, 0, 0)
    label = `${dayKey(from)} ~ ${dayKey(to)}`
  } else if (key === 'custom' && custom?.from && custom?.to) {
    const f = new Date(custom.from + 'T00:00:00')
    const t = new Date(custom.to + 'T23:59:59.999')
    return { from: f, to: t, label: `${custom.from} ~ ${custom.to}` }
  } else {
    from.setTime(0)
    label = '全部日期'
  }
  return { from, to, label }
}

/** 服务端 naive DATETIME：按字面当地时间，勿 new Date(iso) 当 UTC */
export function orderCreatedAt(raw?: string | null): Date | null {
  if (!raw) return null
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
  return Number.isNaN(d.getTime()) ? null : d
}

function parseCreated(o: OrderBrief): Date | null {
  return orderCreatedAt(o.createdAt)
}

function normalizeItems(raw?: CartItem[] | unknown): CartItem[] {
  if (!Array.isArray(raw)) return []
  return raw as CartItem[]
}

/** 与 App StatsCountHelper 一致：邮费/包装等 countInStats=false 不计入件数 */
function statsQtyOfOrder(o: OrderBrief): number {
  const items = normalizeItems(o.items)
  if (items.length) {
    let q = 0
    for (const it of items) {
      if (it.countInStats === false) continue
      q += Math.abs(Number(it.quantity || 0))
    }
    return q
  }
  return Math.abs(Number(o.totalQuantity || 0))
}

function withBarPct<T extends { amount: number }>(list: T[]): (T & { barPct: number })[] {
  const max = Math.max(...list.map((x) => Math.abs(x.amount)), 0.0001)
  return list.map((x) => ({
    ...x,
    barPct: Math.min(100, Math.round((Math.abs(x.amount) / max) * 100)),
  }))
}

export type AnalyticsTab = 'all' | 'sales' | 'customers' | 'codes' | 'stmt'

export function computeAnalytics(
  orders: OrderBrief[],
  from: Date,
  to: Date,
  tab: AnalyticsTab = 'all',
) {
  const needCustomers = tab === 'all' || tab === 'customers'
  const needCodes = tab === 'all' || tab === 'codes' || tab === 'sales'
  const needStmt = tab === 'all' || tab === 'stmt'
  const needItems = needCodes

  const filtered = orders.filter((o) => {
    const d = parseCreated(o)
    if (!d) return false
    return d >= from && d <= to
  })

  const summary: AnalyticsSummary = {
    orderCount: 0,
    totalAmount: 0,
    totalQty: 0,
    unpaidCount: 0,
    unpaidAmount: 0,
    returnOrderCount: 0,
    returnAmount: 0,
    returnQty: 0,
    unrefundedCount: 0,
    unrefundedAmount: 0,
    paidCount: 0,
    paidAmount: 0,
  }

  // 销售排行：仅销售单（is_return = 0），与 App SQL 一致
  const staffMap = new Map<string, { count: number; amount: number }>()
  const custMap = new Map<string, { count: number; amount: number }>()
  const codeMap = new Map<string, { qty: number; amount: number }>()
  const dayMap = new Map<string, { count: number; amount: number }>()
  const returnsDayMap = new Map<string, { count: number; amount: number }>()

  const custSales = new Map<string, { count: number; amount: number }>()
  const custReturns = new Map<string, { count: number; amount: number }>()
  const codeSold = new Map<string, number>()
  const codeReturn = new Map<string, { qty: number; amount: number }>()

  for (const o of filtered) {
    const isReturn = !!o.isReturn
    const amount = Number(o.totalAmount || 0)
    const qty = statsQtyOfOrder(o)
    const paid = !!o.isPaid
    const cust = (o.customerName || '').trim() || '未填客户'
    const staff = (o.creatorName || o.creatorPhone || '未知').trim() || '未知'
    const d = parseCreated(o)

    if (isReturn) {
      summary.returnOrderCount += 1
      summary.returnAmount += Math.abs(amount)
      summary.returnQty += qty
      if (!paid) {
        summary.unrefundedCount += 1
        summary.unrefundedAmount += Math.abs(amount)
      }
      const cr = custReturns.get(cust) || { count: 0, amount: 0 }
      cr.count += 1
      cr.amount += Math.abs(amount)
      custReturns.set(cust, cr)
      if (d) {
        const dk = dayKey(d)
        const day = returnsDayMap.get(dk) || { count: 0, amount: 0 }
        day.count += 1
        day.amount += Math.abs(amount)
        returnsDayMap.set(dk, day)
      }
    } else {
      summary.orderCount += 1
      summary.totalAmount += amount
      summary.totalQty += qty
      if (paid) {
        summary.paidCount += 1
        summary.paidAmount += amount
      } else {
        summary.unpaidCount += 1
        summary.unpaidAmount += amount
      }
      const cs = custSales.get(cust) || { count: 0, amount: 0 }
      cs.count += 1
      cs.amount += amount
      custSales.set(cust, cs)

      const s = staffMap.get(staff) || { count: 0, amount: 0 }
      s.count += 1
      s.amount += amount
      staffMap.set(staff, s)

      const c = custMap.get(cust) || { count: 0, amount: 0 }
      c.count += 1
      c.amount += amount
      custMap.set(cust, c)

      if (d) {
        const dk = dayKey(d)
        const day = dayMap.get(dk) || { count: 0, amount: 0 }
        day.count += 1
        day.amount += amount
        dayMap.set(dk, day)
      }
    }

    if (!needItems) continue
    for (const it of normalizeItems(o.items)) {
      if (it.countInStats === false) continue
      const code = String(it.productCode || '').trim() || '(无货号)'
      const iq = Math.abs(Number(it.quantity || 0))
      const isub = Math.abs(
        it.subtotal != null ? Number(it.subtotal) : Number(it.price || 0) * iq,
      )
      if (isReturn) {
        const rr = codeReturn.get(code) || { qty: 0, amount: 0 }
        rr.qty += iq
        rr.amount += isub
        codeReturn.set(code, rr)
      } else {
        const entry = codeMap.get(code) || { qty: 0, amount: 0 }
        entry.qty += iq
        entry.amount += isub
        codeMap.set(code, entry)
        codeSold.set(code, (codeSold.get(code) || 0) + iq)
      }
    }
  }

  const toNamed = (m: Map<string, { count: number; amount: number }>): NamedStat[] =>
    withBarPct(
      [...m.entries()]
        .map(([name, v]) => ({
          name,
          count: v.count,
          amount: v.amount,
          amountLabel: formatMoney(v.amount),
          countLabel: `${v.count} 单`,
        }))
        .sort((a, b) => b.amount - a.amount),
    )

  const byCode: CodeStat[] = withBarPct(
    [...codeMap.entries()]
      .map(([code, v]) => ({
        code,
        qty: v.qty,
        amount: v.amount,
        amountLabel: formatMoney(v.amount),
        qtyLabel: `销量 ${v.qty} 件`,
      }))
      .sort((a, b) => b.amount - a.amount),
  )

  const byDay: DayStat[] = withBarPct(
    [...dayMap.entries()]
      .map(([day, v]) => ({
        day,
        count: v.count,
        amount: v.amount,
        amountLabel: formatMoney(v.amount),
      }))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
  )

  const returnsByDay: DayStat[] = withBarPct(
    [...returnsDayMap.entries()]
      .map(([day, v]) => ({
        day,
        count: v.count,
        amount: v.amount,
        amountLabel: formatMoney(v.amount),
      }))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
  )

  let customerReturnRates: RateStat[] = []
  if (needCustomers) {
    const names = new Set([...custSales.keys(), ...custReturns.keys()])
    customerReturnRates = [...names].map((name) => {
      const s = custSales.get(name) || { count: 0, amount: 0 }
      const r = custReturns.get(name) || { count: 0, amount: 0 }
      const base = s.amount > 0 ? s.amount : r.amount
      const rate = base > 0 ? r.amount / base : 0
      return {
        name,
        salesCount: s.count,
        salesAmount: s.amount,
        returnCount: r.count,
        returnAmount: r.amount,
        rate,
        rateLabel: `${(rate * 100).toFixed(1)}%`,
        detail: `退 ${r.count} 单 ¥${formatMoney(r.amount)} / 销 ${s.count} 单 ¥${formatMoney(s.amount)}`,
        barPct: 0,
        amount: rate,
      }
    })
    customerReturnRates.sort((a, b) => b.rate - a.rate)
    const maxRate = Math.max(...customerReturnRates.map((x) => x.rate), 0.0001)
    customerReturnRates = customerReturnRates
      .filter((x) => x.returnCount > 0)
      .slice(0, 30)
      .map((x) => ({
        ...x,
        barPct: Math.min(100, Math.round((x.rate / maxRate) * 100)),
      }))
  }

  let productReturnRates: CodeRateStat[] = []
  if (tab === 'all' || tab === 'codes') {
    const codes = new Set([...codeSold.keys(), ...codeReturn.keys()])
    productReturnRates = [...codes].map((code) => {
      const soldQty = codeSold.get(code) || 0
      const r = codeReturn.get(code) || { qty: 0, amount: 0 }
      const base = soldQty > 0 ? soldQty : r.qty
      const rate = base > 0 ? r.qty / base : 0
      return {
        code,
        soldQty,
        returnQty: r.qty,
        returnAmount: r.amount,
        rate,
        rateLabel: `${(rate * 100).toFixed(1)}%`,
        detail: `退 ${r.qty} 件 ¥${formatMoney(r.amount)} / 销 ${soldQty} 件`,
        barPct: 0,
        amount: rate,
      }
    })
    productReturnRates.sort((a, b) => b.rate - a.rate)
    const maxPr = Math.max(...productReturnRates.map((x) => x.rate), 0.0001)
    productReturnRates = productReturnRates
      .filter((x) => x.returnQty > 0)
      .slice(0, 30)
      .map((x) => ({
        ...x,
        barPct: Math.min(100, Math.round((x.rate / maxPr) * 100)),
      }))
  }

  let stmtCustomers: StmtCustomer[] = []
  if (needStmt) {
    const stmtMap = new Map<
      string,
      { count: number; amount: number; unpaidAmount: number; unpaidCount: number }
    >()
    for (const o of filtered) {
      const name = (o.customerName || '').trim()
      if (!name) continue
      const amount = Number(o.totalAmount || 0)
      const isReturn = !!o.isReturn
      const signed = isReturn ? -Math.abs(amount) : amount
      const e = stmtMap.get(name) || {
        count: 0,
        amount: 0,
        unpaidAmount: 0,
        unpaidCount: 0,
      }
      e.count += 1
      e.amount += signed
      if (!o.isPaid) {
        e.unpaidCount += 1
        e.unpaidAmount += signed
      }
      stmtMap.set(name, e)
    }
    stmtCustomers = [...stmtMap.entries()]
      .map(([name, v]) => ({
        name,
        count: v.count,
        amount: v.amount,
        unpaidAmount: v.unpaidAmount,
        unpaidCount: v.unpaidCount,
        amountLabel: formatMoney(v.amount),
        unpaidLabel: formatMoney(v.unpaidAmount),
        listLabel: `时段内 ${v.count} 单 · ¥${formatMoney(v.amount)}`,
      }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  }

  const paidAmt = summary.paidAmount
  const unpaidAmt = summary.unpaidAmount
  const denom = paidAmt + unpaidAmt
  const paidRatio = denom > 0 ? Math.round((paidAmt / denom) * 100) : 0
  const unpaidRatio = denom > 0 ? 100 - paidRatio : 0

  const refundedAmt = Math.max(0, summary.returnAmount - summary.unrefundedAmount)
  const refundedCount = Math.max(0, summary.returnOrderCount - summary.unrefundedCount)
  const retDenom = Math.max(summary.returnAmount, 1)
  const refundedRatio =
    summary.returnOrderCount > 0 ? Math.round((refundedAmt / retDenom) * 100) : 0
  const unrefundedRatio =
    summary.returnOrderCount > 0 ? Math.max(0, 100 - refundedRatio) : 0

  return {
    summary,
    summaryLabels: {
      totalAmount: formatMoney(summary.totalAmount),
      unpaidAmount: formatMoney(summary.unpaidAmount),
      paidAmount: formatMoney(summary.paidAmount),
      returnAmount: formatMoney(summary.returnAmount),
      unrefundedAmount: formatMoney(summary.unrefundedAmount),
      refundedAmount: formatMoney(refundedAmt),
      refundedCount,
      unrefundedCount: summary.unrefundedCount,
      refundedRatio,
      unrefundedRatio,
      paidRatio,
      unpaidRatio,
      paidCount: summary.paidCount,
      unpaidCount: summary.unpaidCount,
    },
    byStaff: toNamed(staffMap),
    byCustomer: toNamed(custMap),
    byCode,
    byDay,
    returnsByDay,
    customerReturnRates,
    productReturnRates,
    stmtCustomers,
    filteredCount: filtered.length,
  }
}

export const STMT_PREVIEW_KEY = 'tuk_stmt_preview'

/** 页间传递对账单预览：模块内存 → App.globalData → 本地缓存 */
let _stmtPreviewHold: StmtPreviewPayload | null = null

function writeAppStmtPreview(payload: StmtPreviewPayload | null): void {
  try {
    const app = getApp<IAppOption>()
    if (app?.globalData) app.globalData.stmtPreview = payload
  } catch (_) {
    /* ignore */
  }
}

function readAppStmtPreview(): StmtPreviewPayload | null {
  try {
    const app = getApp<IAppOption>()
    const raw = app?.globalData?.stmtPreview as StmtPreviewPayload | undefined
    if (app?.globalData) app.globalData.stmtPreview = null
    if (raw && raw.customerName) return raw
  } catch (_) {
    /* ignore */
  }
  return null
}

/** 对账单或订单改过付款后，回到订单统计要丢掉时段缓存并重拉笔数。 */
export function markStmtStatsDirty(): void {
  markTeamStatsDirty()
}

export function consumeStmtStatsDirty(): boolean {
  return consumeTeamStatsDirty()
}

export function holdStmtPreview(payload: StmtPreviewPayload): void {
  _stmtPreviewHold = payload
  writeAppStmtPreview(payload)
  try {
    wx.setStorageSync(STMT_PREVIEW_KEY, payload)
  } catch (_) {
    try {
      wx.removeStorageSync(STMT_PREVIEW_KEY)
      wx.setStorageSync(STMT_PREVIEW_KEY, payload)
    } catch (_) {
      /* ignore quota：内存 + globalData 仍可打开 */
    }
  }
}

export function takeStmtPreview(): StmtPreviewPayload | null {
  const mem = _stmtPreviewHold
  _stmtPreviewHold = null
  if (mem && mem.customerName) {
    writeAppStmtPreview(null)
    try {
      wx.removeStorageSync(STMT_PREVIEW_KEY)
    } catch (_) {
      /* ignore */
    }
    return mem
  }
  const fromApp = readAppStmtPreview()
  if (fromApp) {
    try {
      wx.removeStorageSync(STMT_PREVIEW_KEY)
    } catch (_) {
      /* ignore */
    }
    return fromApp
  }
  try {
    const s = wx.getStorageSync(STMT_PREVIEW_KEY) as StmtPreviewPayload
    if (s && s.customerName) {
      try {
        wx.removeStorageSync(STMT_PREVIEW_KEY)
      } catch (_) {
        /* ignore */
      }
      return s
    }
  } catch (_) {
    /* ignore */
  }
  return null
}

function formatDateTimeLabel(raw?: string): string {
  if (!raw) return ''
  const s = String(raw).trim()
  if (!s) return ''
  // 2026-08-18T12:54:39 / 2026-08-18 12:54:39
  const normalized = s.replace('T', ' ').replace(/\.\d+/, '')
  return normalized.length >= 16 ? normalized.slice(0, 16) : normalized.slice(0, 10)
}

function nowPrintTime(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export interface StmtPreviewPayload {
  shopName: string
  customerName: string
  customerPhone?: string
  rangeLabel: string
  printTime: string
  unpaidOnly: boolean
  orders: Array<{
    orderNo: string
    orderNoLabel: string
    createdAt: string
    totalAmount: number
    totalQuantity: number
    isReturn: boolean
    isPaid: boolean
    amountLabel: string
    qtyLabel: string
    statusLabel: string
    statusClass: string
  }>
  totals: {
    orderCount: number
    qty: number
    total: number
    paidCount: number
    paidAmount: number
    unpaidCount: number
    unpaidAmount: number
    totalLabel: string
    paidLabel: string
    unpaidLabel: string
    receivableLabel: string
  }
}

export function buildStmtPreview(
  shopName: string,
  customerName: string,
  orders: OrderBrief[],
  rangeLabel: string,
  unpaidOnly: boolean,
): StmtPreviewPayload {
  let list = orders.slice()
  if (unpaidOnly) list = list.filter((o) => !o.isPaid)
  list.sort((a, b) => {
    const da = a.createdAt || ''
    const db = b.createdAt || ''
    return da < db ? -1 : da > db ? 1 : 0
  })

  let phone = ''

  const rows = list.map((o) => {
    const isReturn = !!o.isReturn
    const amount = Number(o.totalAmount || 0)
    const signed = isReturn ? -Math.abs(amount) : amount
    const q = statsQtyOfOrder(o)
    const paid = !!o.isPaid
    if (!phone && o.customerPhone) phone = String(o.customerPhone)
    const { statusLabel, statusClass } = stmtStatusMeta(isReturn, paid)
    const no = String(o.orderNo || '').trim()
    return {
      orderNo: no,
      orderNoLabel: no ? `NO.${no}` : '',
      createdAt: formatDateTimeLabel(o.createdAt),
      totalAmount: signed,
      totalQuantity: q,
      isReturn,
      isPaid: paid,
      amountLabel: formatMoney(signed),
      qtyLabel: `${q}件`,
      statusLabel,
      statusClass,
    }
  })

  return {
    shopName,
    customerName,
    customerPhone: phone || undefined,
    rangeLabel,
    printTime: nowPrintTime(),
    unpaidOnly,
    orders: rows,
    totals: recomputeStmtTotals(rows),
  }
}

/** 预览页切换已付/未付后重算汇总 */
export function recomputeStmtTotals(
  orders: StmtPreviewPayload['orders'],
): StmtPreviewPayload['totals'] {
  let total = 0
  let qty = 0
  let paidCount = 0
  let paidAmount = 0
  let unpaidCount = 0
  let unpaidAmount = 0
  for (const o of orders) {
    const signed = Number(o.totalAmount || 0)
    const q = Number(o.totalQuantity || 0)
    const isReturn = !!o.isReturn
    total += signed
    qty += isReturn ? -Math.abs(q) : q
    if (o.isPaid) {
      paidCount += 1
      paidAmount += signed
    } else {
      unpaidCount += 1
      unpaidAmount += signed
    }
  }
  return {
    orderCount: orders.length,
    qty,
    total,
    paidCount,
    paidAmount,
    unpaidCount,
    unpaidAmount,
    totalLabel: formatMoney(total),
    paidLabel: formatMoney(paidAmount),
    unpaidLabel: formatMoney(unpaidAmount),
    receivableLabel: formatMoney(unpaidAmount),
  }
}

export function stmtStatusMeta(isReturn: boolean, isPaid: boolean): {
  statusLabel: string
  statusClass: string
} {
  return {
    statusLabel: isPaid
      ? isReturn
        ? '已退款'
        : '已付'
      : isReturn
        ? '未退款'
        : '未付',
    statusClass: isPaid ? (isReturn ? 'ret' : 'paid') : 'unpaid',
  }
}

/** 与 App OrderStatusChips 一致的并列状态标签 */
function orderStatusChips(o: OrderBrief): Array<{ label: string; tone: string }> {
  const isReturn = !!o.isReturn
  const paid = !!o.isPaid
  const chips: Array<{ label: string; tone: string }> = []
  if (isReturn) {
    chips.push({ label: paid ? '已退款' : '未退款', tone: paid ? 'paid' : 'muted' })
  } else if (paid) {
    chips.push({ label: '已付款', tone: 'paid' })
  }
  if (o.isPickedUp) {
    chips.push({ label: isReturn ? '已收货' : '已拿货', tone: 'picked' })
  }
  const tracking = Array.isArray(o.trackingNos) ? o.trackingNos.filter(Boolean) : []
  if (o.isShipped || tracking.length) chips.push({ label: '已发货', tone: 'shipped' })
  if (o.isDelivered) chips.push({ label: '已送货', tone: 'delivered' })
  if (!chips.length) chips.push({ label: isReturn ? '未收货' : '未拿货', tone: 'muted' })
  return chips
}

/** 单客户时段统计（对账/客户排行点击详情） */
export function computeCustomerDetail(
  orders: OrderBrief[],
  customerName: string,
  from: Date,
  to: Date,
) {
  const name = (customerName || '').trim()
  const scoped = orders.filter((o) => {
    if ((o.customerName || '').trim() !== name) return false
    const d = parseCreated(o)
    if (!d) return false
    return d >= from && d <= to
  })

  const a = computeAnalytics(scoped, from, to)
  const orderRows = scoped
    .slice()
    .sort((x, y) => String(y.createdAt || '').localeCompare(String(x.createdAt || '')))
    .map((o) => {
      const isReturn = !!o.isReturn
      const paid = !!o.isPaid
      const amount = Number(o.totalAmount || 0)
      const q = statsQtyOfOrder(o)
      const items = normalizeItems(o.items)
        .filter((it) => it.countInStats !== false)
        .slice(0, 3)
        .map(
          (it) =>
            `${it.productCode || it.productName || '?'}×${Math.abs(Number(it.quantity || 0))}`,
        )
        .join('  ')
      const chips = orderStatusChips(o)
      return {
        orderNo: o.orderNo,
        createdAt: formatDateTimeLabel(o.createdAt),
        amountLabel: formatMoney(isReturn ? -Math.abs(amount) : amount),
        qtyLabel: `${q}件`,
        kindLabel: isReturn ? '退单' : '销售',
        statusLabel: chips[0]?.label || '',
        statusClass: chips[0]?.tone || 'muted',
        statusChips: chips,
        unpaid: !paid,
        itemPreview: items,
        creatorName: (o.creatorName || '').trim(),
      }
    })

  return {
    summary: a.summary,
    labels: a.summaryLabels,
    byCode: a.byCode.slice(0, 20),
    orders: orderRows,
  }
}
