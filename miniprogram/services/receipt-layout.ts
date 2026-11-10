/** 小票模版布局：预览与打印画布共用 */
import { chineseAmountUpper } from '../utils/chinese-amount'
import { printFontCanvasScale } from './print-settings'
import {
  loadPrintTemplate,
  resolveMerchantTitle,
  resolvePrintLayout,
  type LayoutColumn,
  type PrintTemplate,
  type PrintTemplateTypeId,
} from './print-template'
import { peekCachedCatalog, peekCachedOrders, peekCachedShop, type Product } from './team'
import { existingShopLogoPath, logoPayloadOk, writeShopLogoFile } from '../utils/logo-file'

/**
 * 票据上的商家标题：自定义抬头优先；抬头空着或仍是产品名时用店铺名。
 */
export function receiptShopTitle(
  shopName: string | undefined | null,
  headerTitle: string | undefined | null,
  _preferTemplateHeader?: boolean,
): string {
  return resolveMerchantTitle(shopName, headerTitle)
}

export type ReceiptLayoutKind =
  | 'cashier'
  | 'bordered'
  | 'horizontal'
  | 'payment'
  | 'compact'
  | 'delivery'
  | 'minimal'
  | 'pickup'
  | 'colorsize'
  | 'piece'
  | 'settle'
  | 'across'

export type ReceiptCellField =
  | 'code'
  | 'name'
  | 'spec'
  | 'color'
  | 'size'
  | 'unit'
  | 'qtyLabel'
  | 'priceLabel'
  | 'subLabel'

export interface ReceiptColumnDef {
  label: string
  field: ReceiptCellField
  flex: number
}

export interface ReceiptTemplateDef {
  id: PrintTemplateTypeId
  label: string
  scene: string
  isDefault?: boolean
  kind: ReceiptLayoutKind
  columns: ReceiptColumnDef[]
}

export interface ReceiptItemRow {
  key: string
  code: string
  name: string
  spec: string
  hasSpec: boolean
  unit: string
  qtyLabel: string
  priceLabel: string
  subLabel: string
  styleCode: string
  color: string
  size: string
  qtyPlain: string
  /** 行序列号。空表示不画。挂在货号外面，不写进货号文字 */
  lineNo: string
  /** 商品条形码编码的货号。空表示这行没有可画的条码 */
  barcodeText: string
}

export interface ReceiptStyleGroup {
  code: string
  rows: ReceiptItemRow[]
  qtyLabel: string
  amountLabel: string
}

export interface ReceiptRenderModel {
  templateId: PrintTemplateTypeId
  templateLabel: string
  layoutKind: ReceiptLayoutKind
  columns: ReceiptColumnDef[]
  plainTable: boolean
  rightAlignHeader: boolean
  showChineseAmount: boolean
  showDeliverySign: boolean
  paymentTitle: string
  shopName: string
  isReturn: boolean
  orderNo: string
  dateStr: string
  customerName: string
  customerPhone: string
  handler: string
  items: ReceiptItemRow[]
  qtyLabel: string
  amountLabel: string
  amountCn: string
  settledLabel: string
  footer: string
  /** 底部文案按换行拆行，供预览展示 */
  footerLines: string[]
  /** 底部说明开关。关掉后预览留加号，打印不再画这段文字 */
  showFooter: boolean
  /** 商品条形码。开着时画在合计下方、收款码上方 */
  showBarcode: boolean
  showPayQr: boolean
  showReturnQr: boolean
  qrHint: string
  wechatQr: string
  alipayQr: string
  returnQr: string
  returnQrHint: string
  returnQrUrl: string
  showLookupQr: boolean
  lookupQr: string
  lookupQrHint: string
  lookupQrUrl: string
  /** 店名下方副标题（打印设置可关） */
  shopSubtitle: string
  shopSubtitleLines: string[]
  /** 副标题开关。关掉后模板预览只留加号 */
  subtitleOn: boolean
  /** 票头右侧商家新款码 */
  showHeaderNewArrivalQr: boolean
  headerNewArrivalQr: string
  headerNewArrivalHint: string
  headerNewArrivalUrl: string
  /** 添加微信好友，全票只使用这一张图 */
  friendQr: string
  /** 票头左、票头右、底部二维码：空、扫码查账、查看新款、添加微信 */
  slotLeft?: '' | 'lookup' | 'arrival' | 'friend'
  slotRight?: '' | 'lookup' | 'arrival' | 'friend'
  slotFoot?: '' | 'lookup' | 'arrival' | 'friend'
  /** 游客票头左右是绑定入口，不是可扫的码 */
  guestBindPrompt: boolean
  /** 打印客户欠款 */
  showArrears: boolean
  /** 欠款这一行的开关，和有没有金额分开 */
  arrearsOn: boolean
  /** 客户、电话、日期、打印时间可单独关掉 */
  showCustomer: boolean
  showPhone: boolean
  showDate: boolean
  showPrintedAt: boolean
  /** 行号前缀。预览里可单独关掉，打印时不另画一行 */
  showLineNumber: boolean
  customerArrearsLabel: string
  /** 打印店铺地址 */
  showAddress: boolean
  /** 地址开关。和有没有地址文字分开，模板里才能加回去 */
  addressOn: boolean
  /** 票头手机开关。关掉后只留加号，不改店铺里存的号码 */
  shopPhoneOn: boolean
  /** 票头地址行，已带「地址：」 */
  shopAddress: string
  /** 票头手机行，已带「手机：」。和地址分两行，避免挤在一起 */
  shopPhoneLine: string
  /** 无规格列时，颜色尺码挂在货号或品名下方，避免多挤一列 */
  specUnderField: '' | 'code' | 'name'
  styleGroups: ReceiptStyleGroup[]
  /** 抬头块关掉时不画店名 */
  showShopTitle: boolean
  /** 打印时间块开着时有值 */
  printTimeLabel: string
  /** 店铺设置打开「打印 Logo」且已有图时，票头居中的本地路径 */
  shopLogo: string
}

export const RECEIPT_TEMPLATE_DEFS: ReceiptTemplateDef[] = [
  {
    id: 'cashier',
    label: '收银小票',
    scene: '门店收银、快速结账',
    isDefault: true,
    kind: 'cashier',
    columns: [
      { label: '货号', field: 'code', flex: 1.35 },
      { label: '单位', field: 'unit', flex: 0.5 },
      { label: '数量', field: 'qtyLabel', flex: 0.7 },
      { label: '单价', field: 'priceLabel', flex: 0.75 },
      { label: '金额', field: 'subLabel', flex: 0.85 },
    ],
  },
  {
    id: 'vertical',
    label: '色码单',
    scene: '一款一张表',
    kind: 'colorsize',
    columns: [
      { label: '颜色', field: 'code', flex: 1.2 },
      { label: '尺码', field: 'spec', flex: 0.8 },
      { label: '件数', field: 'qtyLabel', flex: 0.7 },
      { label: '单价', field: 'priceLabel', flex: 0.8 },
    ],
  },
  {
    id: 'horizontal',
    label: '一行明细',
    scene: '一行一件',
    kind: 'across',
    columns: [
      { label: '款号', field: 'code', flex: 1 },
      { label: '颜色', field: 'color', flex: 1 },
      { label: '尺码', field: 'size', flex: 1.4 },
      { label: '件数', field: 'qtyLabel', flex: 0.6 },
      { label: '单价', field: 'priceLabel', flex: 0.7 },
      { label: '金额', field: 'subLabel', flex: 0.8 },
    ],
  },
  {
    id: 'fashion',
    label: '拿货单',
    scene: '按款号分块',
    kind: 'pickup',
    columns: [
      { label: '款号', field: 'code', flex: 1.2 },
      { label: '颜色尺码', field: 'spec', flex: 1.2 },
      { label: '金额', field: 'subLabel', flex: 0.8 },
    ],
  },
  {
    id: 'piece',
    label: '件数单',
    scene: '件数放大',
    kind: 'piece',
    columns: [
      { label: '件数', field: 'qtyLabel', flex: 0.8 },
      { label: '款号', field: 'code', flex: 1.3 },
      { label: '金额', field: 'subLabel', flex: 0.9 },
    ],
  },
  {
    id: 'settle',
    label: '对账单',
    scene: '款号件数金额',
    kind: 'settle',
    columns: [
      { label: '款号', field: 'code', flex: 1.6 },
      { label: '件数', field: 'qtyLabel', flex: 0.7 },
      { label: '金额', field: 'subLabel', flex: 0.9 },
    ],
  },
]

const VALID_IDS = new Set(RECEIPT_TEMPLATE_DEFS.map((x) => x.id))

export function getReceiptTemplateDef(id: PrintTemplateTypeId): ReceiptTemplateDef {
  return RECEIPT_TEMPLATE_DEFS.find((x) => x.id === id) || RECEIPT_TEMPLATE_DEFS[0]
}

export function isKnownTemplateId(id: unknown): id is PrintTemplateTypeId {
  return VALID_IDS.has(String(id || '') as PrintTemplateTypeId)
}

function specUnderFieldOf(columns: Array<{ field: string }>, kind: ReceiptLayoutKind): '' | 'code' | 'name' {
  if (kind === 'cashier' || kind === 'across') return ''
  if (columns.some((c) => c.field === 'spec')) return ''
  if (columns.some((c) => c.field === 'code')) return 'code'
  if (columns.some((c) => c.field === 'name')) return 'name'
  return ''
}

function itemHasSpec(it: { spec?: string }): boolean {
  const s = String(it.spec || '').trim()
  return !!s && s !== '—'
}

export function estimateReceiptCanvasHeight(
  templateId: PrintTemplateTypeId,
  itemCount: number,
  qrBlockH: number,
  items?: Array<{ spec?: string }>,
): number {
  const def = getReceiptTemplateDef(templateId)
  let base = 280
  if (def.kind === 'payment') base = 340
  if (def.kind === 'delivery') base = 360
  if (def.kind === 'pickup' || def.kind === 'colorsize') base = 320
  if (def.kind === 'piece') base = 300
  const rowH = def.kind === 'compact' || def.kind === 'minimal' ? 36 : def.kind === 'piece' ? 52 : 44
  const extra = def.kind === 'colorsize' || def.kind === 'pickup' ? itemCount * 8 + 48 : 0
  const specLines =
    specUnderFieldOf(def.columns, def.kind) && items
      ? items.filter(itemHasSpec).length
      : 0
  const logoExtra = printableShopLogoPath() ? 120 : 0
  const raw = base + itemCount * rowH + specLines * 16 + 120 + qrBlockH + extra + logoExtra
  return Math.ceil(raw * Math.max(1, printFontCanvasScale()) + 160)
}

type DraftItem = {
  productCode: string
  productName?: string
  spec?: string
  unit?: string
  price: number
  quantity: number
  subtotal: number
  /** 商品录入时扫入的码内容。空则小票不画码 */
  barcode?: string
}

/** 只用商品或对应颜色尺码上已录入的码，不用货号现造。 */
function enteredBarcodeOf(catalog: Product[], code: string, spec: string, explicit?: string): string {
  const given = String(explicit || '').trim()
  if (given) return given
  const product = catalog.find((p) => String(p.code || '').trim() === code)
  if (!product) return ''
  const pair = splitColorSize(spec)
  const skus = Array.isArray(product.skus) ? product.skus : []
  if ((pair.color || pair.size) && skus.length) {
    const hit = skus.find((s) => {
      const color = String(s.color || '').trim()
      const size = String(s.size || '').trim()
      return color === pair.color && size === pair.size
    })
    const skuCode = String(hit?.barcode || '').trim()
    if (skuCode) return skuCode
  }
  return String(product.barcode || '').trim()
}

function splitColorSize(spec: string): { color: string; size: string } {
  const s = String(spec || '').trim()
  if (!s || s === '—') return { color: '', size: '' }
  const parts = s.split(/[/|｜,，]+/).map((x) => x.trim()).filter(Boolean)
  if (parts.length >= 2) return { color: parts[0], size: parts.slice(1).join('') }
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return { color: words[0], size: words.slice(1).join('') }
  return { color: s, size: '' }
}

export function groupReceiptStyles(items: ReceiptItemRow[], asReturn = false): ReceiptStyleGroup[] {
  const order: string[] = []
  const map: Record<string, { rows: ReceiptItemRow[]; qty: number; amount: number }> = {}
  for (const row of items || []) {
    const code = row.styleCode || row.code || '—'
    if (!map[code]) {
      map[code] = { rows: [], qty: 0, amount: 0 }
      order.push(code)
    }
    map[code].rows.push(row)
    map[code].qty += Number(row.qtyPlain) || 0
    map[code].amount += Number(row.subLabel) || 0
  }
  return order.map((code) => ({
    code,
    rows: map[code].rows,
    qtyLabel: fmtNum(asReturn ? Math.abs(map[code].qty) : map[code].qty),
    amountLabel: map[code].amount.toFixed(2),
  }))
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

/** 底部文案：保留后台设置的换行，仅规范化换行符 */
export function normalizeFooterText(raw: string): string {
  return String(raw || '').replace(/\r\n|\r/g, '\n').trim()
}

function splitFooterLines(text: string): string[] {
  const normalized = normalizeFooterText(text)
  if (!normalized) return []
  return normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** 客户累计欠款：未付销售 − 未付退货（对齐 App customerUnpaidAmount） */
export function customerUnpaidFromCache(customerName?: string): number {
  const name = String(customerName || '').trim()
  if (!name) return 0
  let amt = 0
  for (const o of peekCachedOrders()) {
    if (String(o.customerName || '').trim() !== name) continue
    if (o.isPaid) continue
    const total = Math.abs(Number(o.totalAmount || 0))
    if (!Number.isFinite(total)) continue
    amt += o.isReturn ? -total : total
  }
  return Math.round(amt * 100) / 100
}

function shopLogoFile(b64: string | null | undefined): string {
  const raw = String(b64 || '').trim()
  if (!raw) return ''
  try {
    return writeShopLogoFile(raw)
  } catch (_) {
    return ''
  }
}

/** 打印 Logo 打开且店铺已有真实图片时返回本地文件。空数据不当成 Logo */
export function printableShopLogoPath(template?: PrintTemplate | null): string {
  const tpl = template || loadPrintTemplate()
  if (tpl.printLogo === false) return ''
  const shop = peekCachedShop()
  const raw = String(shop?.logoBase64 || '')
  if (logoPayloadOk(raw)) {
    const written = shopLogoFile(raw)
    if (written) return written
  }
  if (shop) return ''
  return existingShopLogoPath()
}

function nowPrintLabel(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 从当前版式的块解析票面开关；欠款金额来自本机订单缓存 */
export function receiptPrintFlags(customerName?: string, isReturn = false): {
  showBarcode: boolean
  showLineNumber: boolean
  showAddress: boolean
  showShopTel: boolean
  showArrears: boolean
  customerArrears?: number
} {
  const blocks = resolvePrintLayout(loadPrintTemplate(), isReturn).blocks
  const showArrears = !!blocks.arrears
  return {
    showBarcode: !!blocks.barcode,
    showLineNumber: !!blocks.lineNo,
    showAddress: !!blocks.address,
    showShopTel: blocks.shopTel !== false,
    showArrears,
    customerArrears: showArrears ? customerUnpaidFromCache(customerName) : undefined,
  }
}

export function receiptLayoutHash(mm: number): string {
  const t = loadPrintTemplate()
  const layout = resolvePrintLayout(t)
  const ret = resolvePrintLayout(t, true)
  const def = getReceiptTemplateDef(layout.templateId)
  const fields = (layout.columns || def.columns).map((col) => col.field).join('.')
  const on = (Object.keys(layout.blocks) as Array<keyof typeof layout.blocks>)
    .filter((key) => layout.blocks[key])
    .join('.')
  const onRet = (Object.keys(ret.blocks) as Array<keyof typeof ret.blocks>)
    .filter((key) => ret.blocks[key])
    .join('.')
  const footer = layout.blocks.footer ? t.footerText || '' : ''
  return `${layout.templateId}|${mm}|${t.headerTitle}|${footer}|${layout.customId}|${fields}|${on}|R${ret.templateId}|${ret.customId}|${onRet}`
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** 票面货号。存的是品名时改回商品库货号，不把品名打出来。 */
function receiptCodeOf(codeRaw: string, nameRaw: string, catalog: Product[]): string {
  const code = codeRaw.trim()
  const name = nameRaw.trim()
  if (code) {
    const hit = catalog.find((p) => sameText(String(p.code || ''), code))
    if (hit) return String(hit.code || '').trim()
  }
  const probe = code || name
  if (probe) {
    const named = catalog.filter((p) => sameText(String(p.name || ''), probe))
    if (named.length === 1) {
      const found = String(named[0].code || '').trim()
      if (found) return found
    }
  }
  if (code && name && !sameText(code, name)) return code
  return code || name
}

export function withoutProductNameColumn(columns: ReceiptColumnDef[]): ReceiptColumnDef[] {
  const hasCode = columns.some((col) => col.field === 'code')
  const next = columns.flatMap((col) => {
    const label = String(col.label || '').trim()
    const nameCol = col.field === 'name' || label === '品名' || label === '商品名' || label === '名称'
    if (!nameCol) return [col]
    if (hasCode) return []
    return [{ ...col, field: 'code' as const, label: '货号' }]
  })
  return next.length ? next : columns
}

/** 退单金额打成负数，单价和数量仍是正数 */
export function signReturnItems(items: ReceiptItemRow[], isReturn: boolean): ReceiptItemRow[] {
  if (!isReturn) return items
  return items.map((it) => {
    const sub = Number(it.subLabel)
    const signed = Number.isFinite(sub) ? -Math.abs(sub) : 0
    return { ...it, subLabel: signed.toFixed(2) }
  })
}

export function signedReceiptAmount(amount: number, isReturn: boolean): number {
  const n = Number(amount) || 0
  if (!Number.isFinite(n)) return 0
  return isReturn ? -Math.abs(n) : n
}

export function mapReceiptItems(
  items: DraftItem[],
  opts?: { showBarcode?: boolean; showLineNumber?: boolean },
): ReceiptItemRow[] {
  const showLineNumber = !!opts?.showLineNumber
  const catalog = peekCachedCatalog()
  return (items || []).map((it, i) => {
    const spec = (it.spec || '').trim()
    const hasSpec = !!spec && spec !== '—'
    const codeRaw = String(it.productCode || '').trim()
    const nameRaw = String(it.productName || '').trim()
    // 货号列只打货号。品名不进这一列，名称列也不打品名。
    const code = receiptCodeOf(codeRaw, nameRaw, catalog)
    const name = code
    const lineNo = showLineNumber ? `${i + 1}.` : ''
    const pair = splitColorSize(hasSpec ? spec : '')
    return {
      key: `${it.productCode || ''}-${spec || i}-${i}`,
      code,
      name,
      spec: hasSpec ? spec : spec || '—',
      hasSpec,
      unit: it.unit || '件',
      qtyLabel: `${fmtNum(it.quantity)}${it.unit || '件'}`,
      priceLabel: Number(it.price || 0).toFixed(2),
      subLabel: Number(it.subtotal || 0).toFixed(2),
      styleCode: code || '—',
      color: pair.color,
      size: pair.size,
      qtyPlain: fmtNum(it.quantity),
      lineNo,
      barcodeText: enteredBarcodeOf(catalog, code, hasSpec ? spec : '', it.barcode),
    }
  })
}

/** 默认收银小票：货号下不挂规格，单位固定为件，数量不带单位 */
export function presentReceiptItems(
  templateId: PrintTemplateTypeId,
  items: ReceiptItemRow[],
): ReceiptItemRow[] {
  if (getReceiptTemplateDef(templateId).kind !== 'cashier') return items
  return items.map((it) => ({
    ...it,
    unit: '件',
    qtyLabel: it.qtyPlain,
    hasSpec: false,
  }))
}

/** 横版颜色、尺码必须分开。旧列把颜色绑在品名上，尺码又带上了颜色。 */
function fixAcrossColumns(columns: ReceiptColumnDef[], kind: ReceiptLayoutKind): ReceiptColumnDef[] {
  if (kind !== 'across') return columns
  return columns.map((col) => {
    if (col.label === '颜色') return { ...col, field: 'color' }
    if (col.label === '尺码') return { ...col, field: 'size', flex: col.flex === 0.7 ? 1.4 : col.flex }
    if (col.label === '款号' && col.flex === 1.3) return { ...col, flex: 1 }
    return col
  })
}

function toReceiptColumns(columns: LayoutColumn[] | null): ReceiptColumnDef[] | null {
  if (!columns || !columns.length) return null
  return columns.map((col) => ({ label: col.label, field: col.field, flex: col.flex }))
}

function givenSlot(
  value: unknown,
  fallback: '' | 'lookup' | 'arrival' | 'friend',
): '' | 'lookup' | 'arrival' | 'friend' {
  if (value === 'lookup' || value === 'arrival' || value === 'friend' || value === '') return value
  return fallback
}

/** 票头联系行。地址、手机各一行，有内容才加前缀。 */
export function shopContactParts(address?: string, phone?: string): { addressLine: string; phoneLine: string } {
  const addr = String(address || '').trim()
  const tel = String(phone || '').trim()
  return {
    addressLine: addr ? `地址：${addr}` : '',
    phoneLine: tel ? `手机：${tel}` : '',
  }
}

export function formatShopContactLine(address?: string, phone?: string): string {
  const parts = shopContactParts(address, phone)
  return [parts.addressLine, parts.phoneLine].filter(Boolean).join('\n')
}

export function buildReceiptRenderModel(input: {
  templateId: PrintTemplateTypeId
  shopName: string
  isReturn: boolean
  orderNo: string
  dateStr: string
  customerName?: string
  customerPhone?: string
  handler?: string
  items: DraftItem[]
  totalQuantity: number
  totalAmount: number
  footer?: string
  showPayQr: boolean
  showReturnQr: boolean
  qrHint?: string
  wechatQr?: string
  alipayQr?: string
  returnQr?: string
  returnQrHint?: string
  returnQrUrl?: string
  showLookupQr?: boolean
  lookupQr?: string
  lookupQrHint?: string
  lookupQrUrl?: string
  shopSubtitle?: string
  showHeaderNewArrivalQr?: boolean
  headerNewArrivalQr?: string
  headerNewArrivalHint?: string
  headerNewArrivalUrl?: string
  friendQr?: string
  slotLeft?: '' | 'lookup' | 'arrival' | 'friend'
  slotRight?: '' | 'lookup' | 'arrival' | 'friend'
  slotFoot?: '' | 'lookup' | 'arrival' | 'friend'
  guestBindPrompt?: boolean
  showBarcode?: boolean
  showLineNumber?: boolean
  showArrears?: boolean
  customerArrears?: number
  showAddress?: boolean
  shopAddress?: string
  /** 店铺手机。和地址排在同一行：地址：… 手机：… */
  shopPhone?: string
  /** 预览页尚未落盘时传入当前编辑中的模板 */
  layoutTemplate?: PrintTemplate | null
}): ReceiptRenderModel {
  const stored = input.layoutTemplate || loadPrintTemplate()
  // 退单必须走退单模板。传入的 templateId 是销售单当前模板，不能拿来覆盖。
  const layout = resolvePrintLayout(
    input.isReturn ? stored : { ...stored, template: input.templateId || stored.template },
    !!input.isReturn,
  )
  const def = getReceiptTemplateDef(layout.templateId)
  const columns = withoutProductNameColumn(
    fixAcrossColumns(toReceiptColumns(layout.columns) || def.columns, def.kind),
  )
  const blocks = layout.blocks
  const amount = signedReceiptAmount(Number(input.totalAmount || 0), !!input.isReturn)
  const items = signReturnItems(
    presentReceiptItems(
      def.id,
      mapReceiptItems(input.items, {
        showBarcode: blocks.barcode,
        showLineNumber: !!blocks.lineNo,
      }),
    ),
    !!input.isReturn,
  )
  const footerRaw = blocks.footer ? input.footer || '' : ''
  const contact = shopContactParts(input.shopAddress, input.shopPhone)
  return {
    templateId: def.id,
    templateLabel: def.label,
    layoutKind: def.kind,
    columns,
    plainTable: def.kind === 'cashier' || def.kind === 'compact',
    rightAlignHeader: false,
    showChineseAmount: def.kind === 'payment',
    showDeliverySign: def.kind === 'delivery',
    paymentTitle: '收款收据',
    shopName: blocks.title ? input.shopName || '图可开单打印' : '',
    isReturn: !!input.isReturn,
    orderNo: input.orderNo,
    dateStr: input.dateStr,
    customerName: input.customerName || '',
    customerPhone: input.customerPhone || '',
    handler: input.handler || '',
    items,
    styleGroups: groupReceiptStyles(items, !!input.isReturn),
    qtyLabel: fmtNum(
      input.isReturn ? Math.abs(Number(input.totalQuantity) || 0) : Number(input.totalQuantity) || 0,
    ),
    amountLabel: amount.toFixed(2),
    amountCn: chineseAmountUpper(amount),
    settledLabel: `${input.isReturn ? '退款额' : '收款额'}: ¥${amount.toFixed(1)}`,
    footer: normalizeFooterText(footerRaw),
    footerLines: splitFooterLines(footerRaw),
    showFooter: !!blocks.footer,
    showBarcode: blocks.barcode !== false,
    showPayQr: !!input.showPayQr,
    showReturnQr: !!input.showReturnQr,
    qrHint: input.qrHint || '',
    wechatQr: input.wechatQr || '',
    alipayQr: input.alipayQr || '',
    returnQr: input.returnQr || '',
    returnQrHint: input.returnQrHint || '',
    returnQrUrl: input.returnQrUrl || '',
    showLookupQr: !!input.showLookupQr,
    lookupQr: input.lookupQr || '',
    lookupQrHint: input.lookupQrHint || '',
    lookupQrUrl: input.lookupQrUrl || '',
    shopSubtitle: blocks.subtitle ? normalizeFooterText(input.shopSubtitle || '') : '',
    shopSubtitleLines: blocks.subtitle ? splitFooterLines(input.shopSubtitle || '') : [],
    subtitleOn: !!blocks.subtitle,
    showHeaderNewArrivalQr: !!input.showHeaderNewArrivalQr,
    headerNewArrivalQr: input.headerNewArrivalQr || '',
    headerNewArrivalHint: input.headerNewArrivalHint || '',
    headerNewArrivalUrl: input.headerNewArrivalUrl || '',
    friendQr: input.friendQr || '',
    slotLeft: givenSlot(input.slotLeft, !input.isReturn && input.showLookupQr ? 'lookup' : ''),
    slotRight: givenSlot(input.slotRight, !input.isReturn && input.showHeaderNewArrivalQr ? 'arrival' : ''),
    slotFoot: givenSlot(input.slotFoot, input.showReturnQr ? 'arrival' : ''),
    guestBindPrompt: !!input.guestBindPrompt,
    showArrears: !!blocks.arrears && input.customerArrears != null,
    arrearsOn: !!blocks.arrears,
    showCustomer: blocks.customer !== false,
    showPhone: blocks.phone !== false,
    showDate: blocks.date !== false,
    showPrintedAt: !!blocks.printedAt,
    showLineNumber: !!blocks.lineNo,
    customerArrearsLabel:
      input.customerArrears != null
        ? Number(input.customerArrears).toFixed(2)
        : '',
    showAddress: !!blocks.address && !!contact.addressLine,
    addressOn: !!blocks.address,
    shopPhoneOn: blocks.shopTel !== false,
    shopAddress: blocks.address ? contact.addressLine : '',
    shopPhoneLine: blocks.shopTel !== false ? contact.phoneLine : '',
    specUnderField: specUnderFieldOf(columns, def.kind),
    showShopTitle: !!blocks.title,
    printTimeLabel: blocks.printedAt ? nowPrintLabel() : '',
    shopLogo: printableShopLogoPath(stored),
  }
}
