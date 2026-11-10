import { genJobNo, getOrCreateClientId, request } from './api'
import { getPaperWidthMm } from './bluetooth'
import { loadPrintSettings } from './print-settings'
import { loadPrintTemplate, resolvePrintLayout } from './print-template'
import { formatShopContactLine, getReceiptTemplateDef, mapReceiptItems, receiptLayoutHash, receiptShopTitle, withoutProductNameColumn } from './receipt-layout'
import { isGuest, isLoggedIn } from './session'
import { isCloudSyncAllowed } from './subscription'
import type { CartItem, ShopInfo } from './team'

function cloudPrintAllowed(): boolean {
  return isLoggedIn() && !isGuest() && isCloudSyncAllowed()
}

export interface PrintGateway {
  clientId: string
  name?: string | null
  printerName?: string | null
  isDefault?: boolean
  online?: boolean
}

const CLOUD_LINK_KEY = 'tuk_cloud_link_v1'

export interface CloudLink {
  clientId: string
  name: string
}

/** 电脑端「本机显示名」。没填时才用那台电脑上的打印机名。 */
export function gatewayTitle(g: PrintGateway): string {
  const name = String(g.name || '').trim()
  if (name) return name
  const printer = String(g.printerName || '').trim()
  return printer || '电脑'
}

export function loadCloudLink(): CloudLink | null {
  try {
    const raw = wx.getStorageSync(CLOUD_LINK_KEY) as Partial<CloudLink> | ''
    if (!raw || typeof raw !== 'object') return null
    const clientId = String(raw.clientId || '').trim()
    if (!clientId) return null
    return { clientId, name: String(raw.name || '').trim() || '电脑' }
  } catch (_) {
    return null
  }
}

export function saveCloudLink(g: PrintGateway): CloudLink | null {
  const clientId = String(g.clientId || '').trim()
  if (!clientId) return null
  const link = { clientId, name: gatewayTitle(g) }
  try {
    wx.setStorageSync(CLOUD_LINK_KEY, link)
  } catch (_) {}
  return link
}

export function clearCloudLink() {
  try {
    wx.removeStorageSync(CLOUD_LINK_KEY)
  } catch (_) {}
}

export async function cloudLinkStatus(): Promise<string> {
  const saved = loadCloudLink()
  if (!cloudPrintAllowed()) return saved ? '已断开' : '查看团队里的在线云打印'
  const gw = await listGateways()
  const list = gw.gateways || []
  if (saved) {
    const live = list.find((g) => g.clientId === saved.clientId)
    if (live?.online) {
      const name = gatewayTitle(live)
      if (name !== saved.name) saveCloudLink(live)
      return `已连接: ${name}`
    }
    return '已断开'
  }
  if (list.some((g) => g.online)) return '有在线云打印，点这里连接'
  return '团队里没有在线的云打印'
}

export interface PrintJob {
  jobNo: string
  status: string
  errorMsg?: string | null
}

export function buildReceiptText(opts: {
  shop?: ShopInfo | null
  orderNo: string
  customerName?: string
  customerPhone?: string
  remark?: string
  items: CartItem[]
  totalAmount: number
  totalQuantity: number
  createdAt?: string
}): string {
  const shopName = receiptShopTitle(
    opts.shop?.shopName,
    loadPrintTemplate().headerTitle,
    isGuest() || !isLoggedIn(),
  )
  const lines: string[] = []
  lines.push(shopName)
  const sub = String(opts.shop?.subtitle || '').trim()
  if (sub) lines.push(...sub.split(/\r?\n/).filter(Boolean))
  lines.push('----------')
  lines.push(`单号: ${opts.orderNo}`)
  if (opts.customerName) lines.push(`客户: ${opts.customerName}`)
  if (opts.customerPhone) lines.push(`电话: ${opts.customerPhone}`)
  if (opts.createdAt) lines.push(`时间: ${opts.createdAt}`)
  lines.push('----------')
  const printed = mapReceiptItems(opts.items)
  for (let i = 0; i < opts.items.length; i++) {
    const it = opts.items[i]
    const unit = it.unit || '件'
    lines.push(printed[i]?.code || '—')
    lines.push(
      `  ${it.quantity}${unit} x ${it.price.toFixed(2)} = ${it.subtotal.toFixed(2)}`,
    )
  }
  lines.push('----------')
  lines.push(`件数: ${opts.totalQuantity}`)
  lines.push(`合计: ¥${opts.totalAmount.toFixed(2)}`)
  if (opts.remark) lines.push(`备注: ${opts.remark}`)
  if (opts.shop?.footer) lines.push(opts.shop.footer)
  return lines.join('\n')
}

function printJobStyle(isReturn: boolean, shop?: ShopInfo | null) {
  const t = loadPrintTemplate()
  const layout = resolvePrintLayout(t, isReturn)
  const blocks = layout.blocks
  const settings = loadPrintSettings()
  const table =
    layout.templateId === 'cashier' ||
    layout.templateId === 'piece' ||
    layout.templateId === 'settle' ||
    layout.templateId === 'horizontal'
  const columns = table
    ? withoutProductNameColumn(layout.columns || getReceiptTemplateDef(layout.templateId).columns).map((col) => ({
        field: col.field,
        label: col.label,
        flex: col.flex,
      }))
    : undefined
  const printMode =
    settings.printMode === 'compat' || settings.printMode === 'dense' ? settings.printMode : 'raster'
  return {
    template: layout.templateId,
    header: receiptShopTitle(shop?.shopName, t.headerTitle, isGuest() || !isLoggedIn()),
    footer: blocks.footer ? t.footerText || shop?.footer || '' : '',
    subtitle: blocks.subtitle ? shop?.subtitle || '' : '',
    printSubtitle: !!blocks.subtitle,
    printHeaderLookupQr: !!blocks.lookup,
    printHeaderNewArrivalQr: !!blocks.headerArrival,
    printPaymentQr: !!blocks.payQr,
    printLogo: t.printLogo !== false,
    showAddress: !!blocks.address,
    showShopTel: blocks.shopTel !== false,
    showLineNumber: !!blocks.lineNo,
    showPrintTime: !!blocks.printedAt,
    showBarcode: !!blocks.barcode,
    showArrears: !!blocks.arrears,
    showCustomer: !!blocks.customer,
    showPhone: !!blocks.phone,
    printMode,
    fontScale: settings.printFontScale,
    missingCorrection: settings.printMissingCorrection,
    columns,
  }
}

function orderToPrintPayload(opts: {
  shop?: ShopInfo | null
  orderNo: string
  customerName?: string
  customerPhone?: string
  remark?: string
  items: CartItem[]
  totalAmount: number
  totalQuantity: number
  createdAtMs: number
  creatorPhone?: string
  creatorName?: string
  isReturn?: boolean
}) {
  return {
    type: 'order',
    order: {
      order_no: opts.orderNo,
      customer_name: opts.customerName || null,
      customer_phone: opts.customerPhone || null,
      remark: opts.remark || null,
      total_amount: opts.totalAmount,
      total_quantity: opts.totalQuantity,
      created_at: opts.createdAtMs,
      created_by_phone: opts.creatorPhone || null,
      created_by_name: opts.creatorName || null,
      is_paid: 0,
      is_picked_up: 0,
      is_shipped: 0,
      is_delivered: 0,
      is_return: opts.isReturn ? 1 : 0,
    },
    items: (() => {
      const printed = mapReceiptItems(opts.items)
      return opts.items.map((it, i) => ({
      product_code: printed[i]?.code || it.productCode,
      product_name: printed[i]?.code || it.productCode,
      spec: it.spec || null,
      unit: it.unit || '件',
      price: it.price,
      quantity: it.quantity,
      subtotal: it.subtotal,
      count_in_stats: it.countInStats !== false ? 1 : 0,
    }))
    })(),
    options: (() => {
      const style = printJobStyle(!!opts.isReturn, opts.shop)
      return {
        shopName: style.header,
        subtitle: style.subtitle,
        footer: style.footer,
        address: formatShopContactLine(
          style.showAddress ? opts.shop?.address : '',
          style.showShopTel ? opts.shop?.phone : '',
        ),
        phone: opts.shop?.phone || '',
        style,
      }
    })(),
    paperWidthMm: getPaperWidthMm(),
    templateHash: (() => {
      try {
        return receiptLayoutHash(getPaperWidthMm())
      } catch (_) {
        return 'cashier|80'
      }
    })(),
  }
}

export async function listGateways() {
  if (!cloudPrintAllowed()) {
    return {
      ok: false as const,
      error: '云打印需登录并开通云同步',
      gateways: [] as PrintGateway[],
    }
  }
  const res = await request<{ gateways: PrintGateway[] }>({
    path: '/api/v1/print/gateways',
  })
  if (!res.ok) {
    return { ok: false as const, error: res.message, gateways: [] as PrintGateway[] }
  }
  const list = res.data?.gateways || []
  return { ok: true as const, gateways: list, error: null as string | null }
}

function parseTimeMs(raw?: string): number {
  const s = String(raw || '').trim()
  if (!s) return Date.now()
  const t = Date.parse(s.replace(/-/g, '/'))
  return Number.isFinite(t) ? t : Date.now()
}

function parseRange(label?: string): { from?: string; to?: string } {
  const m = String(label || '').match(
    /(\d{4}-\d{2}-\d{2})\s*[~～到至\-]+\s*(\d{4}-\d{2}-\d{2})/,
  )
  if (!m) return {}
  return { from: `${m[1]}T00:00:00.000`, to: `${m[2]}T23:59:59.000` }
}

export function buildStatementText(opts: {
  shopName: string
  customerName: string
  customerPhone?: string
  unpaidOnly?: boolean
  rangeLabel?: string
  printTime?: string
  orders: Array<{
    orderNo: string
    createdAt?: string
    totalAmount: number
    totalQuantity: number
    isReturn?: boolean
    isPaid?: boolean
    amountLabel?: string
    qtyLabel?: string
    statusLabel?: string
  }>
}): string {
  const lines: string[] = []
  lines.push(opts.shopName || '图可开单')
  lines.push(opts.unpaidOnly ? '客户对账单·未付款' : '客户对账单')
  lines.push('==========')
  lines.push(`客户: ${opts.customerName || ''}`)
  if (opts.customerPhone) lines.push(`电话: ${opts.customerPhone}`)
  if (opts.rangeLabel) lines.push(`时段: ${opts.rangeLabel}`)
  lines.push('----------')
  for (const o of opts.orders) {
    const mark = o.isReturn ? '[退]' : ''
    const status = o.statusLabel || (o.isPaid ? '已付' : '未付')
    lines.push(
      `${o.createdAt || ''} ${mark}${o.amountLabel || o.totalAmount} ${o.qtyLabel || `${o.totalQuantity}件`} [${status}]`,
    )
    if (o.orderNo) lines.push(`  NO.${o.orderNo}`)
  }
  lines.push('----------')
  if (opts.printTime) lines.push(`打印时间: ${opts.printTime}`)
  return lines.join('\n')
}

export async function pickOnlineGateway(): Promise<
  | { ok: true; gateway: PrintGateway; error: null }
  | { ok: false; gateway: null; error: string; cancelled?: boolean }
> {
  const saved = loadCloudLink()
  if (!saved) {
    return {
      ok: false,
      gateway: null,
      error: '请先在打印设置里连接云打印机，再点云打印到电脑。',
    }
  }
  const gw = await listGateways()
  const live = (gw.gateways || []).find((g) => g.clientId === saved.clientId)
  if (live?.online) {
    saveCloudLink(live)
    return { ok: true, gateway: live, error: null }
  }
  return {
    ok: false,
    gateway: null,
    error: gw.ok
      ? `「${saved.name}」已断开。请先在打印设置里重新连接。`
      : gw.error || `「${saved.name}」已断开。请先在打印设置里重新连接。`,
  }
}

export async function submitStatementJob(opts: {
  shopName: string
  customerName: string
  customerPhone?: string
  unpaidOnly?: boolean
  rangeLabel?: string
  printTime?: string
  title?: string
  renderedText?: string
  orders: Array<{
    orderNo: string
    createdAt?: string
    totalAmount: number
    totalQuantity: number
    isReturn?: boolean
    isPaid?: boolean
    customerName?: string
    customerPhone?: string
    amountLabel?: string
    qtyLabel?: string
    statusLabel?: string
    items?: CartItem[]
  }>
  targetClientId?: string
  copies?: number
}) {
  if (!cloudPrintAllowed()) {
    return {
      ok: false as const,
      error: '云打印需登录并开通云同步',
      jobNo: null as string | null,
    }
  }
  const clientId = getOrCreateClientId()
  const jobNo = genJobNo()
  const range = parseRange(opts.rangeLabel)
  const payload = {
    type: 'statement',
    shopName: opts.shopName || '',
    customerName: opts.customerName || '',
    customerPhone: opts.customerPhone || '',
    unpaidOnly: !!opts.unpaidOnly,
    title: opts.title || (opts.unpaidOnly ? '未付款对账单' : '对账单'),
    text:
      opts.renderedText ||
      buildStatementText({
        shopName: opts.shopName,
        customerName: opts.customerName,
        customerPhone: opts.customerPhone,
        unpaidOnly: opts.unpaidOnly,
        rangeLabel: opts.rangeLabel,
        printTime: opts.printTime,
        orders: opts.orders,
      }),
    rangeLabel: opts.rangeLabel || '',
    printTime: opts.printTime || '',
    from: range.from,
    to: range.to,
    orders: opts.orders.map((o) => ({
      order: {
        order_no: o.orderNo,
        customer_name: o.customerName || opts.customerName || null,
        customer_phone: o.customerPhone || opts.customerPhone || null,
        total_amount: o.totalAmount,
        total_quantity: o.totalQuantity,
        created_at: parseTimeMs(o.createdAt),
        is_paid: o.isPaid ? 1 : 0,
        is_return: o.isReturn ? 1 : 0,
        is_picked_up: 0,
        is_shipped: 0,
        is_delivered: 0,
      },
      items: (o.items || []).map((it) => ({
        product_code: it.productCode,
        product_name: it.productName,
        spec: it.spec || null,
        unit: it.unit || '件',
        price: it.price,
        quantity: it.quantity,
        subtotal: it.subtotal,
        count_in_stats: it.countInStats !== false ? 1 : 0,
      })),
    })),
    paperWidthMm: getPaperWidthMm(),
    templateHash: (() => {
      try {
        const t = loadPrintTemplate()
        const mm = getPaperWidthMm()
        return `statement|${t.template}|${mm}`
      } catch (_) {
        return 'statement|80'
      }
    })(),
  }

  const res = await request<PrintJob>({
    path: '/api/v1/print/jobs',
    method: 'POST',
    data: {
      clientId,
      jobNo,
      payload,
      copies: opts.copies || 1,
      targetClientId: opts.targetClientId,
    },
  })
  if (!res.ok) return { ok: false as const, error: res.message, jobNo: null as string | null }
  return {
    ok: true as const,
    jobNo: res.data?.jobNo || jobNo,
    status: res.data?.status || 'pending',
  }
}

export async function submitPrintJob(opts: {
  shop?: ShopInfo | null
  orderNo: string
  customerName?: string
  customerPhone?: string
  remark?: string
  items: CartItem[]
  totalAmount: number
  totalQuantity: number
  createdAtMs?: number
  creatorPhone?: string
  creatorName?: string
  targetClientId?: string
  copies?: number
  isReturn?: boolean
}) {
  if (!cloudPrintAllowed()) {
    return {
      ok: false as const,
      error: '云打印需登录并开通云同步',
      jobNo: null as string | null,
    }
  }
  const clientId = getOrCreateClientId()
  const jobNo = genJobNo()
  const payload = orderToPrintPayload({
    shop: opts.shop,
    orderNo: opts.orderNo,
    customerName: opts.customerName,
    customerPhone: opts.customerPhone,
    remark: opts.remark,
    items: opts.items,
    totalAmount: opts.totalAmount,
    totalQuantity: opts.totalQuantity,
    createdAtMs: opts.createdAtMs || Date.now(),
    creatorPhone: opts.creatorPhone,
    creatorName: opts.creatorName,
    isReturn: !!opts.isReturn,
  })

  const res = await request<PrintJob>({
    path: '/api/v1/print/jobs',
    method: 'POST',
    data: {
      clientId,
      jobNo,
      payload,
      copies: opts.copies || 1,
      targetClientId: opts.targetClientId,
    },
  })
  if (!res.ok) return { ok: false as const, error: res.message, jobNo: null as string | null }
  return {
    ok: true as const,
    jobNo: res.data?.jobNo || jobNo,
    status: res.data?.status || 'pending',
  }
}

export async function getPrintJob(jobNo: string) {
  const res = await request<PrintJob>({
    path: `/api/v1/print/jobs/${encodeURIComponent(jobNo)}`,
  })
  if (!res.ok || !res.data) {
    return { ok: false as const, error: res.message, job: null as PrintJob | null }
  }
  return { ok: true as const, job: res.data, error: null as string | null }
}

export function pollPrintJob(
  jobNo: string,
  onUpdate: (job: PrintJob) => void,
  opts?: { intervalMs?: number; maxMs?: number },
): { stop: () => void; done: Promise<PrintJob | null> } {
  const intervalMs = opts?.intervalMs || 2000
  const maxMs = opts?.maxMs || 120000
  let timer: ReturnType<typeof setInterval> | null = null
  let stopped = false
  const started = Date.now()
  const terminal = new Set(['done', 'failed', 'canceled', 'expired'])

  const done = new Promise<PrintJob | null>((resolve) => {
    const tick = async () => {
      if (stopped) {
        resolve(null)
        return
      }
      if (Date.now() - started > maxMs) {
        if (timer) clearInterval(timer)
        resolve(null)
        return
      }
      const r = await getPrintJob(jobNo)
      if (!r.ok || !r.job) return
      onUpdate(r.job)
      if (terminal.has(r.job.status)) {
        if (timer) clearInterval(timer)
        stopped = true
        resolve(r.job)
      }
    }
    void tick()
    timer = setInterval(() => {
      void tick()
    }, intervalMs)
  })

  return {
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
    },
    done,
  }
}
