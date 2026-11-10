/** 打印模版本地配置（对齐 App PrintTemplateSettings） */
import { getOrCreateClientId, request } from './api'
import { applyPrintOptionsFromPrefs, isPrintPrefsDirty, markPrintPrefsDirty, schedulePushPrintSettings } from './print-settings'
import { isGuest, isLoggedIn } from './session'
import { isCloudSyncAllowed } from './subscription'
import { isOwner, peekCachedShop } from './team'
import { renderQrPngBase64 } from '../utils/arrival-qr'
import { generatePaymentQrBase64 } from '../utils/payment-qr'

const KEY = 'tuk_print_template_v1'
const WECHAT_FILE = `${wx.env.USER_DATA_PATH}/tuk_pay_qr_wechat.png`
const ALIPAY_FILE = `${wx.env.USER_DATA_PATH}/tuk_pay_qr_alipay.png`
const FRIEND_FILE = `${wx.env.USER_DATA_PATH}/tuk_friend_qr.png`

/** 默认收银小票，加上服装销售单模版（预览与打印共用） */
export type PrintTemplateTypeId =
  | 'cashier'
  | 'vertical'
  | 'horizontal'
  | 'payment'
  | 'compact'
  | 'wholesale'
  | 'fashion'
  | 'fresh'
  | 'delivery'
  | 'minimal'
  | 'piece'
  | 'settle'

export const PRINT_TEMPLATE_OPTIONS: Array<{
  id: PrintTemplateTypeId
  label: string
  scene?: string
  isDefault?: boolean
}> = [
  { id: 'cashier', label: '收银小票', scene: '门店收银', isDefault: true },
  { id: 'fashion', label: '拿货单', scene: '按款号分块' },
  { id: 'vertical', label: '色码单', scene: '一款一张表' },
  { id: 'piece', label: '件数单', scene: '件数放大' },
  { id: 'settle', label: '对账单', scene: '款号件数金额' },
  { id: 'horizontal', label: '一行明细', scene: '一行一件' },
]

export type HeaderTextSize = 'sm' | 'md' | 'lg'

export function headerTextSizeOf(value: unknown): HeaderTextSize {
  return value === 'sm' || value === 'lg' || value === 'md' ? value : 'md'
}

/** 首页店名三档，差距要一眼能看出来 */
export function headerTextSizePx(value: unknown): number {
  const size = headerTextSizeOf(value)
  if (size === 'sm') return 28
  if (size === 'lg') return 56
  return 40
}

export interface PrintTemplate {
  /** 模版类型，默认 cashier */
  template: PrintTemplateTypeId
  headerTitle: string
  footerText: string
  paymentQrHintText: string
  /** 默认 true，与 App 一致 */
  printPaymentQr: boolean
  /** 本地文件路径（USER_DATA_PATH） */
  wechatQrPath: string
  alipayQrPath: string
  /** 添加微信好友二维码，全票只放一处，由抬头槽位选择 */
  friendQrPath: string
  /**
   * 退单小票底部「新款发布」二维码是否可见。
   * 扫描目标为该用户 ImageOK 商家网址；URL 先预留，后续自动拉取并生成二维码。
   */
  printNewArrivalQr: boolean
  /** ImageOK 商家主页 URL（预留，暂不自动生成二维码） */
  newArrivalQrUrl: string
  /** 新款发布二维码上方提示语 */
  newArrivalQrHintText: string
  /** 票头左侧：扫码查账二维码 */
  printHeaderLookupQr: boolean
  /** 票头右侧：商家新款二维码 */
  printHeaderNewArrivalQr: boolean
  /** 店名下方副标题（首页和小票） */
  printSubtitle: boolean
  /** 首页是否显示邀请代理、查看新款二维码 */
  showHomeQr: boolean
  /** 小票是否打印店铺 Logo */
  printLogo: boolean
  /** 首页是否显示店铺名 */
  showHomeShopName: boolean
  /** 开单和商品列表默认显示左侧序列号 */
  showSheetIndex: boolean
  /** 首页头部店名字号 */
  headerTextSize: HeaderTextSize
  /** 六张内置版式各自的票面块 */
  layoutBlocks: Record<BuiltinLayoutId, LayoutBlocks>
  /** 退单票面块。键是内置版式或自定义 id；没有则沿用该退单版式的销售单块，并默认关掉收款码和票头新款码 */
  returnLayoutBlocks: Record<string, LayoutBlocks>
  /** 从表格版式复制的自定义列，最多 8 份 */
  customTemplates: CustomPrintTemplate[]
  /** 空字符串表示销售单正在用内置版式 */
  activeCustomId: string
  /** 退单用的版式。空字符串表示还没单独选过，暂时跟销售单 */
  returnTemplate: PrintTemplateTypeId | ''
  /** 退单正在用的自定义模版；空字符串表示用退单的内置版式 */
  returnActiveCustomId: string
}

export const BUILTIN_LAYOUT_IDS = [
  'cashier',
  'fashion',
  'vertical',
  'piece',
  'settle',
  'horizontal',
] as const

export type BuiltinLayoutId = (typeof BUILTIN_LAYOUT_IDS)[number]

export const TABLE_LAYOUT_IDS = ['cashier', 'piece', 'settle', 'horizontal'] as const

export type TableLayoutId = (typeof TABLE_LAYOUT_IDS)[number]

export const LAYOUT_BLOCK_KEYS = [
  'lookup',
  'title',
  'headerArrival',
  'subtitle',
  'lineNo',
  'address',
  'shopTel',
  'arrears',
  'customer',
  'phone',
  'date',
  'printedAt',
  'barcode',
  'payQr',
  'footerArrival',
  'footer',
] as const

export type LayoutBlockKey = (typeof LAYOUT_BLOCK_KEYS)[number]

/** 票头左、票头右、底部这三处二维码各自放什么。friend 只占其中一处 */
export type QrSlotKind = '' | 'lookup' | 'arrival' | 'friend'

export type QrSlotName = 'left' | 'right' | 'foot'

export interface LayoutBlocks extends Record<LayoutBlockKey, boolean> {
  slotLeft: QrSlotKind
  slotRight: QrSlotKind
  slotFoot: QrSlotKind
}

export const LAYOUT_COLUMN_FIELDS = [
  'code',
  'name',
  'spec',
  'color',
  'size',
  'unit',
  'qtyLabel',
  'priceLabel',
  'subLabel',
] as const

export type LayoutColumnField = (typeof LAYOUT_COLUMN_FIELDS)[number]

export interface LayoutColumn {
  field: LayoutColumnField
  label: string
  /** 列宽比例，0.4 到 2，滑块停在哪就是哪 */
  flex: number
}

export interface CustomPrintTemplate {
  id: string
  name: string
  basedOn: TableLayoutId
  columns: LayoutColumn[]
  blocks: LayoutBlocks
  /** 销售单和退单各有一份，互不共用 */
  doc: 'sale' | 'return'
}

export interface ResolvedPrintLayout {
  templateId: PrintTemplateTypeId
  customId: string
  blocks: LayoutBlocks
  /** 有值时替换内置列；空则用版式自带列 */
  columns: LayoutColumn[] | null
}

/** 旧默认底部含食品、特价等非服装说明，读到时换成服装说明 */
const LEGACY_FOOTER_TEXT =
  '注意事项：\n' +
  '1. 请当面核对品名、数量与金额，离店后概不负责。\n' +
  '2. 不影响二次销售的商品可退可换；食品、特价及定制商品除外。\n' +
  '3. 如有问题请及时联系本店，谢谢惠顾！'

export const DEFAULT_FOOTER_TEXT =
  '注意：不影响二次销售可退可换\n' +
  '免费服装打印软件 ImageOk.cn'

export function clothingFooterText(raw: string | undefined | null): string {
  const text = String(raw ?? '').replace(/\r\n|\r/g, '\n').trim()
  if (text === LEGACY_FOOTER_TEXT) return DEFAULT_FOOTER_TEXT
  return String(raw ?? '')
}

/** 没单独改过抬头时存的是产品名，不能把它当成商家名称。 */
const PLACEHOLDER_TITLES = new Set(['', '图可开单打印', '图可开单', '图可科技'])

export function isPlaceholderShopTitle(text: string | null | undefined): boolean {
  return PLACEHOLDER_TITLES.has(String(text || '').trim())
}

/**
 * 打印模版上的商家标题。
 * 抬头是空的或仍是产品名时，用店铺资料里的店名。
 */
export function resolveMerchantTitle(
  shopName: string | null | undefined,
  headerTitle: string | null | undefined,
): string {
  const header = String(headerTitle || '').trim()
  const shop = String(shopName || '').trim()
  if (header && !isPlaceholderShopTitle(header)) return header
  if (shop && !isPlaceholderShopTitle(shop)) return shop
  return header || shop || '图可开单打印'
}

export function defaultPrintTemplate(): PrintTemplate {
  return {
    template: 'cashier',
    headerTitle: '图可开单打印',
    footerText: DEFAULT_FOOTER_TEXT,
    paymentQrHintText: '扫以下二维码可直接支付',
    printPaymentQr: true,
    wechatQrPath: '',
    alipayQrPath: '',
    friendQrPath: '',
    printNewArrivalQr: true,
    newArrivalQrUrl: 'https://imageok.cn',
    newArrivalQrHintText: '查看新款',
    printHeaderLookupQr: true,
    printHeaderNewArrivalQr: true,
    printSubtitle: true,
    showHomeQr: false,
    printLogo: true,
    showHomeShopName: true,
    showSheetIndex: true,
    headerTextSize: 'md',
    layoutBlocks: emptyLayoutMap(),
    returnLayoutBlocks: {},
    customTemplates: [],
    activeCustomId: '',
    returnTemplate: '',
    returnActiveCustomId: '',
  }
}

export function defaultLayoutBlocks(): LayoutBlocks {
  return {
    lookup: true,
    title: true,
    headerArrival: true,
    subtitle: true,
    lineNo: true,
    address: true,
    shopTel: true,
    arrears: false,
    customer: true,
    phone: false,
    date: true,
    printedAt: false,
    barcode: false,
    payQr: true,
    footerArrival: true,
    footer: true,
    slotLeft: 'lookup',
    slotRight: 'arrival',
    slotFoot: 'arrival',
  }
}

export function syncQrSlotFlags(blocks: LayoutBlocks): LayoutBlocks {
  const next = { ...blocks }
  const kinds = [next.slotLeft, next.slotRight, next.slotFoot]
  next.lookup = kinds.indexOf('lookup') >= 0
  next.headerArrival = next.slotLeft === 'arrival' || next.slotRight === 'arrival'
  next.footerArrival = next.slotFoot !== ''
  return next
}

/** 开关和预览上的叉/加号改的是同一份块数据 */
export function withQrBlockPatch(
  blocks: LayoutBlocks,
  patch: Partial<LayoutBlocks>,
): LayoutBlocks {
  const next: LayoutBlocks = { ...blocks, ...patch }
  if (patch.lookup === false) {
    if (next.slotLeft === 'lookup') next.slotLeft = ''
    if (next.slotRight === 'lookup') next.slotRight = ''
    if (next.slotFoot === 'lookup') next.slotFoot = ''
  } else if (
    patch.lookup === true &&
    next.slotLeft !== 'lookup' &&
    next.slotRight !== 'lookup' &&
    next.slotFoot !== 'lookup'
  ) {
    if (!next.slotLeft) next.slotLeft = 'lookup'
    else if (!next.slotRight) next.slotRight = 'lookup'
    else next.slotFoot = 'lookup'
  }
  if (patch.headerArrival === false) {
    if (next.slotLeft === 'arrival') next.slotLeft = ''
    if (next.slotRight === 'arrival') next.slotRight = ''
  } else if (
    patch.headerArrival === true &&
    next.slotLeft !== 'arrival' &&
    next.slotRight !== 'arrival'
  ) {
    if (!next.slotRight) next.slotRight = 'arrival'
    else next.slotLeft = 'arrival'
  }
  if (patch.footerArrival === false) {
    next.slotFoot = ''
  } else if (patch.footerArrival === true && !next.slotFoot) {
    next.slotFoot = 'arrival'
  }
  const slotNames: Array<'slotLeft' | 'slotRight' | 'slotFoot'> = ['slotLeft', 'slotRight', 'slotFoot']
  for (const name of slotNames) {
    if (patch[name] !== 'friend') continue
    for (const other of slotNames) {
      if (other !== name && next[other] === 'friend') next[other] = ''
    }
  }
  if (
    patch.slotLeft !== undefined ||
    patch.slotRight !== undefined ||
    patch.slotFoot !== undefined ||
    patch.lookup !== undefined ||
    patch.headerArrival !== undefined ||
    patch.footerArrival !== undefined
  ) {
    return syncQrSlotFlags(next)
  }
  return next
}

function emptyLayoutMap(): Record<BuiltinLayoutId, LayoutBlocks> {
  const map = {} as Record<BuiltinLayoutId, LayoutBlocks>
  for (const id of BUILTIN_LAYOUT_IDS) map[id] = defaultLayoutBlocks()
  return map
}

export function isBuiltinLayoutId(id: string): id is BuiltinLayoutId {
  return (BUILTIN_LAYOUT_IDS as readonly string[]).includes(id)
}

export function isTableLayoutId(id: string): id is TableLayoutId {
  return (TABLE_LAYOUT_IDS as readonly string[]).includes(id)
}

export function maxColumnsForPaper(mm: number): number {
  if (mm <= 58) return 4
  if (mm <= 80) return 5
  return 6
}

function asBlockBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  return fallback
}

function asSlot(v: unknown): QrSlotKind | null {
  if (v === 'lookup' || v === 'arrival' || v === 'friend' || v === '') return v
  return null
}

function normalizeBlocks(raw: unknown, fallback: LayoutBlocks): LayoutBlocks {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out = { ...fallback }
  for (const key of LAYOUT_BLOCK_KEYS) {
    if (key in src) out[key] = asBlockBool(src[key], fallback[key])
  }
  const left = asSlot(src.slotLeft)
  const right = asSlot(src.slotRight)
  const foot = asSlot(src.slotFoot)
  if (left === null && right === null && foot === null) {
    out.slotLeft = out.lookup ? 'lookup' : ''
    out.slotRight = out.headerArrival ? 'arrival' : ''
    out.slotFoot = out.footerArrival ? 'arrival' : ''
    return out
  }
  out.slotLeft = left === null ? (out.lookup ? 'lookup' : '') : left
  out.slotRight = right === null ? (out.headerArrival ? 'arrival' : '') : right
  out.slotFoot = foot === null ? (out.footerArrival ? 'arrival' : '') : foot
  return syncQrSlotFlags(out)
}

function seedBlocksFromLegacy(t: PrintTemplate): LayoutBlocks {
  let lineNo = true
  let address = true
  try {
    const settings = require('./print-settings') as {
      loadPrintSettings?: () => {
        printLineNumber?: boolean
        printAddress?: boolean
      }
    }
    const s = settings.loadPrintSettings?.()
    if (s) {
      lineNo = !!s.printLineNumber
      address = !!s.printAddress
    }
  } catch (_) {}
  return {
    lookup: t.printHeaderLookupQr !== false,
    title: true,
    headerArrival: t.printHeaderNewArrivalQr !== false,
    subtitle: t.printSubtitle !== false,
    lineNo,
    address,
    shopTel: true,
    arrears: false,
    customer: true,
    phone: false,
    date: true,
    printedAt: false,
    barcode: false,
    payQr: t.printPaymentQr !== false,
    footerArrival: t.printNewArrivalQr !== false,
    footer: true,
    slotLeft: t.printHeaderLookupQr !== false ? 'lookup' : '',
    slotRight: t.printHeaderNewArrivalQr !== false ? 'arrival' : '',
    slotFoot: t.printNewArrivalQr !== false ? 'arrival' : '',
  }
}

function returnBlockKeyOk(key: string): boolean {
  return isBuiltinLayoutId(key) || /^c_[a-z0-9]{8}$/.test(key)
}

export function normalizeReturnLayoutMap(raw: unknown): Record<string, LayoutBlocks> {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: Record<string, LayoutBlocks> = {}
  for (const key of Object.keys(src)) {
    if (!returnBlockKeyOk(key)) continue
    const row = src[key]
    const hadTel = !!row && typeof row === 'object' && 'shopTel' in (row as Record<string, unknown>)
    const blocks = normalizeBlocks(row, defaultLayoutBlocks())
    // 旧退单没有这一项。地址当时是关的，手机也不要突然出现。
    if (!hadTel) blocks.shopTel = false
    out[key] = blocks
  }
  return out
}

function returnBlocksOf(src: PrintTemplate, key: string, sale: LayoutBlocks): LayoutBlocks {
  const saved = src.returnLayoutBlocks && src.returnLayoutBlocks[key]
  if (saved) return normalizeBlocks(saved, sale)
  const next: LayoutBlocks = {
    ...sale,
    payQr: false,
    headerArrival: false,
    subtitle: false,
    address: false,
    shopTel: false,
    barcode: false,
    phone: false,
    arrears: false,
    printedAt: false,
  }
  if (next.slotLeft === 'arrival') next.slotLeft = ''
  if (next.slotRight === 'arrival') next.slotRight = ''
  return syncQrSlotFlags(next)
}

function normalizeLayoutMap(
  raw: unknown,
  seed: LayoutBlocks | null,
): Record<BuiltinLayoutId, LayoutBlocks> {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  const map = emptyLayoutMap()
  for (const id of BUILTIN_LAYOUT_IDS) {
    const base = seed || defaultLayoutBlocks()
    map[id] = normalizeBlocks(src ? src[id] : null, base)
  }
  return map
}

function clipText(raw: unknown, max: number): string {
  return String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max)
}

export function clampColumnFlex(raw: number): number {
  if (!Number.isFinite(raw)) return 1
  const n = Math.round(raw * 100) / 100
  if (n < 0.4) return 0.4
  if (n > 2) return 2
  return n
}

function normalizeColumn(raw: unknown): LayoutColumn | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const field = String(row.field || '')
  if (!(LAYOUT_COLUMN_FIELDS as readonly string[]).includes(field)) return null
  const flex = clampColumnFlex(Number(row.flex))
  const label = clipText(row.label, 8)
  if (!label) return null
  return { field: field as LayoutColumnField, label, flex }
}

function normalizeColumns(raw: unknown): LayoutColumn[] {
  if (!Array.isArray(raw)) return []
  const out: LayoutColumn[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const col = normalizeColumn(item)
    if (!col || seen.has(col.field)) continue
    seen.add(col.field)
    out.push(col)
    if (out.length >= 6) break
  }
  return out
}

function normalizeCustomList(
  raw: unknown,
  opt?: { activeId?: string; returnId?: string; forceDoc?: 'sale' | 'return' },
): CustomPrintTemplate[] {
  if (!Array.isArray(raw)) return []
  const activeId = opt?.activeId || ''
  const returnId = opt?.returnId || ''
  const out: CustomPrintTemplate[] = []
  const ids = new Set<string>()
  const names = new Set<string>()
  const counts = { sale: 0, return: 0 }
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const id = String(row.id || '')
    if (!/^c_[a-z0-9]{8}$/.test(id) || ids.has(id)) continue
    const basedOn = String(row.basedOn || '')
    if (!isTableLayoutId(basedOn)) continue
    const doc: 'sale' | 'return' = opt?.forceDoc
      ? opt.forceDoc
      : row.doc === 'return'
        ? 'return'
        : row.doc === 'sale'
          ? 'sale'
          : id === returnId && id !== activeId
            ? 'return'
            : 'sale'
    const name = clipText(row.name, 12)
    const nameKey = `${doc}\n${name}`
    if (!name || names.has(nameKey)) continue
    const columns = normalizeColumns(row.columns)
    if (!columns.length) continue
    if (counts[doc] >= 8) continue
    ids.add(id)
    names.add(nameKey)
    counts[doc] += 1
    const rawBlocks = row.blocks && typeof row.blocks === 'object' ? (row.blocks as Record<string, unknown>) : {}
    const blocks = normalizeBlocks(row.blocks, defaultLayoutBlocks())
    if (doc === 'return' && !('shopTel' in rawBlocks)) blocks.shopTel = false
    out.push({
      id,
      name,
      basedOn,
      columns,
      blocks,
      doc,
    })
  }
  return out
}

function cloneCustom(item: CustomPrintTemplate): CustomPrintTemplate {
  return {
    ...item,
    columns: item.columns.map((col) => ({ ...col })),
    blocks: { ...item.blocks },
  }
}

function uniqueDocName(name: string, list: CustomPrintTemplate[], doc: 'sale' | 'return'): string {
  const used = new Set(list.filter((item) => item.doc === doc).map((item) => item.name))
  const base = clipText(name, 12) || (doc === 'return' ? '退单模板' : '销售模板')
  if (!used.has(base)) return base
  for (let i = 2; i <= 9; i++) {
    const next = clipText(`${base}${i}`, 12)
    if (!used.has(next)) return next
  }
  return clipText(`${base}退`, 12)
}

function freshCustomId(list: CustomPrintTemplate[]): string {
  const used = new Set(list.map((item) => item.id))
  let id = newCustomTemplateId()
  while (used.has(id)) id = newCustomTemplateId()
  return id
}

/** 销售和退单不能共用同一个模板。共用的那份留给销售，退单复制出自己的。 */
function detachSharedCustom(
  list: CustomPrintTemplate[],
  activeId: string,
  returnId: string,
): { list: CustomPrintTemplate[]; returnId: string } {
  if (!activeId || activeId !== returnId) return { list, returnId }
  const shared = list.find((item) => item.id === activeId)
  const saleList = list.map((item) => (item.id === activeId ? { ...item, doc: 'sale' as const } : item))
  if (!shared || saleList.filter((item) => item.doc === 'return').length >= 8) {
    return { list: saleList, returnId: '' }
  }
  const copy = cloneCustom(shared)
  copy.id = freshCustomId(saleList)
  copy.doc = 'return'
  copy.name = uniqueDocName(shared.name, saleList, 'return')
  return { list: [...saleList, copy], returnId: copy.id }
}

function joinDocLists(
  sale: CustomPrintTemplate[],
  ret: CustomPrintTemplate[],
  activeId: string,
  returnId: string,
): { list: CustomPrintTemplate[]; returnId: string } {
  const saleIds = new Set(sale.map((item) => item.id))
  const cleanRet: CustomPrintTemplate[] = []
  let nextReturn = returnId
  for (const item of ret) {
    if (!saleIds.has(item.id)) {
      cleanRet.push(item)
      continue
    }
    if (cleanRet.length >= 8) continue
    const copy = cloneCustom(item)
    copy.id = freshCustomId([...sale, ...cleanRet])
    copy.doc = 'return'
    copy.name = uniqueDocName(item.name, [...sale, ...cleanRet], 'return')
    cleanRet.push(copy)
    if (nextReturn === item.id) nextReturn = copy.id
  }
  return detachSharedCustom([...sale, ...cleanRet], activeId, nextReturn)
}

function customsFromRaw(
  raw: { customTemplates?: unknown; saleCustomTemplates?: unknown; returnCustomTemplates?: unknown },
  activeId: string,
  returnId: string,
): { list: CustomPrintTemplate[]; returnId: string } {
  const hasSplit = Array.isArray(raw?.saleCustomTemplates) || Array.isArray(raw?.returnCustomTemplates)
  if (!hasSplit) {
    return detachSharedCustom(normalizeCustomList(raw?.customTemplates, { activeId, returnId }), activeId, returnId)
  }
  return joinDocLists(
    normalizeCustomList(raw?.saleCustomTemplates, { forceDoc: 'sale' }),
    normalizeCustomList(raw?.returnCustomTemplates, { forceDoc: 'return' }),
    activeId,
    returnId,
  )
}

function customIdOk(id: unknown): string {
  const text = String(id || '')
  return /^c_[a-z0-9]{8}$/.test(text) ? text : ''
}

function optionalTemplateId(id: unknown): PrintTemplateTypeId | '' {
  const text = String(id || '').trim()
  if (!text) return ''
  return normalizeTemplateId(text)
}

function reconcileActive(t: PrintTemplate): boolean {
  let changed = false
  if (t.activeCustomId) {
    const found = t.customTemplates.find((item) => item.id === t.activeCustomId)
    if (!found || found.doc === 'return') {
      t.activeCustomId = ''
      changed = true
    } else if (found.basedOn !== t.template) {
      t.template = found.basedOn
      changed = true
    }
  }
  if (t.returnActiveCustomId) {
    const found = t.customTemplates.find((item) => item.id === t.returnActiveCustomId)
    if (!found || found.doc !== 'return') {
      t.returnActiveCustomId = ''
      changed = true
    } else if (!t.returnTemplate || found.basedOn !== t.returnTemplate) {
      t.returnTemplate = found.basedOn
      changed = true
    }
  }
  return changed
}

export function normalizeTemplateId(id: unknown): PrintTemplateTypeId {
  const s = String(id || '').trim()
  if (s === 'simple') return 'cashier'
  const known = PRINT_TEMPLATE_OPTIONS.some((x) => x.id === s)
  if (known) return s as PrintTemplateTypeId
  return 'cashier'
}

export function templateLabel(id: PrintTemplateTypeId): string {
  return PRINT_TEMPLATE_OPTIONS.find((x) => x.id === id)?.label || '收银小票'
}

export function templateScene(id: PrintTemplateTypeId): string {
  return PRINT_TEMPLATE_OPTIONS.find((x) => x.id === id)?.scene || ''
}

function fileExists(path: string): boolean {
  if (!path) return false
  try {
    wx.getFileSystemManager().accessSync(path)
    return true
  } catch (_) {
    return false
  }
}

function writeBase64Png(filePath: string, b64: string): string {
  const raw = b64.replace(/^data:image\/\w+;base64,/, '').trim()
  if (!raw) return ''
  try {
    wx.getFileSystemManager().writeFileSync(filePath, raw, 'base64')
    return filePath
  } catch (_) {
    return ''
  }
}

/** 公开查账页：把云端收款码 Base64 落到本地临时文件供 image 展示 */
export function writeLookupPayQr(
  kind: 'wechat' | 'alipay',
  b64: string,
  tokenHint?: string,
): string {
  const tip = String(tokenHint || 'pub').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)
  const path = `${wx.env.USER_DATA_PATH}/tuk_lookup_pay_${kind}_${tip || 'x'}.png`
  return writeBase64Png(path, b64)
}

function removeFile(path: string) {
  if (!path) return
  try {
    wx.getFileSystemManager().unlinkSync(path)
  } catch (_) {}
}

export function loadPrintTemplate(): PrintTemplate {
  const base = defaultPrintTemplate()
  try {
    const raw = wx.getStorageSync(KEY)
    if (raw && typeof raw === 'object') {
      const merged = { ...base, ...raw } as PrintTemplate
      merged.template = normalizeTemplateId((raw as any).template)
      if (merged.wechatQrPath && !fileExists(merged.wechatQrPath)) {
        merged.wechatQrPath = fileExists(WECHAT_FILE) ? WECHAT_FILE : ''
      }
      if (merged.alipayQrPath && !fileExists(merged.alipayQrPath)) {
        merged.alipayQrPath = fileExists(ALIPAY_FILE) ? ALIPAY_FILE : ''
      }
      if (merged.friendQrPath && !fileExists(merged.friendQrPath)) {
        merged.friendQrPath = fileExists(FRIEND_FILE) ? FRIEND_FILE : ''
      }
      merged.printHeaderLookupQr = merged.printHeaderLookupQr !== false
      merged.printHeaderNewArrivalQr = merged.printHeaderNewArrivalQr !== false
      merged.printSubtitle = merged.printSubtitle !== false
      merged.showHomeQr = merged.showHomeQr === true
      merged.printLogo = merged.printLogo !== false
      merged.showHomeShopName = merged.showHomeShopName !== false
      merged.showSheetIndex = merged.showSheetIndex !== false
      merged.headerTextSize = headerTextSizeOf(merged.headerTextSize)
      merged.printNewArrivalQr = merged.printNewArrivalQr !== false
      merged.footerText = clothingFooterText(merged.footerText)
      const hadBlocks =
        raw &&
        typeof raw === 'object' &&
        (raw as any).layoutBlocks &&
        typeof (raw as any).layoutBlocks === 'object'
      const seed = hadBlocks ? null : seedBlocksFromLegacy(merged)
      merged.layoutBlocks = normalizeLayoutMap((raw as any).layoutBlocks, seed)
      merged.returnLayoutBlocks = normalizeReturnLayoutMap((raw as any).returnLayoutBlocks)
      merged.activeCustomId = customIdOk((raw as any).activeCustomId)
      merged.returnTemplate = optionalTemplateId((raw as any).returnTemplate)
      const rawReturnId = customIdOk((raw as any).returnActiveCustomId)
      const packed = customsFromRaw(raw as any, merged.activeCustomId, rawReturnId)
      merged.returnActiveCustomId = packed.returnId
      merged.customTemplates = packed.list
      const reconciled = reconcileActive(merged)
      const splitReturn = packed.returnId !== rawReturnId
      // 游客/未登录：空文案回落到默认，避免表单全空
      if (isGuest() || !isLoggedIn()) {
        const textKeys: Array<keyof PrintTemplate> = [
          'headerTitle',
          'footerText',
          'paymentQrHintText',
          'newArrivalQrUrl',
          'newArrivalQrHintText',
        ]
        for (const k of textKeys) {
          if (!String(merged[k] || '').trim()) {
            ;(merged as any)[k] = base[k]
          }
        }
      }
      if (!hadBlocks || reconciled || splitReturn) {
        persistTemplateLocal(merged)
        if (splitReturn) {
          markPrintPrefsDirty()
          schedulePushPrintSettings()
        }
      }
      if (!hadBlocks) silencePrintTime()
      return restoreSaleLineNo(applyHomeQrOffDefault(applyQuietReturnDefaults(applyQuietInfoDefaults(merged, 1), 1)))
    }
  } catch (_) {}
  return base
}

/** 商家、游客、未登录本机均可改模版；游客仅落本机，不上云 */
export function canEditPrintTemplate(): boolean {
  return isOwner() || isGuest() || !isLoggedIn()
}

function persistTemplateLocal(t: PrintTemplate) {
  const activeId = customIdOk(t.activeCustomId)
  const packed = detachSharedCustom(
    normalizeCustomList(t.customTemplates, {
      activeId,
      returnId: customIdOk(t.returnActiveCustomId),
    }),
    activeId,
    customIdOk(t.returnActiveCustomId),
  )
  t.customTemplates = packed.list
  t.returnActiveCustomId = packed.returnId
  wx.setStorageSync(KEY, {
    template: normalizeTemplateId(t.template),
    headerTitle: t.headerTitle || '',
    footerText: t.footerText || '',
    paymentQrHintText: t.paymentQrHintText || '',
    printPaymentQr: !!t.printPaymentQr,
    wechatQrPath: t.wechatQrPath || '',
    alipayQrPath: t.alipayQrPath || '',
    friendQrPath: t.friendQrPath || '',
    printNewArrivalQr: t.printNewArrivalQr !== false,
    newArrivalQrUrl: (t.newArrivalQrUrl || '').trim(),
    newArrivalQrHintText: (t.newArrivalQrHintText || '').trim(),
    printHeaderLookupQr: t.printHeaderLookupQr !== false,
    printHeaderNewArrivalQr: t.printHeaderNewArrivalQr !== false,
    printSubtitle: t.printSubtitle !== false,
    showHomeQr: t.showHomeQr === true,
    printLogo: t.printLogo !== false,
    showHomeShopName: t.showHomeShopName !== false,
    showSheetIndex: t.showSheetIndex !== false,
    headerTextSize: headerTextSizeOf(t.headerTextSize),
    layoutBlocks: normalizeLayoutMap(t.layoutBlocks, null),
    returnLayoutBlocks: normalizeReturnLayoutMap(t.returnLayoutBlocks),
    customTemplates: packed.list,
    saleCustomTemplates: packed.list.filter((item) => item.doc !== 'return'),
    returnCustomTemplates: packed.list.filter((item) => item.doc === 'return'),
    activeCustomId: customIdOk(t.activeCustomId),
    returnTemplate: optionalTemplateId(t.returnTemplate),
    returnActiveCustomId: packed.returnId,
  })
}

const QUIET_INFO_KEY = 'tuk_print_quiet_info_v1'

function quietInfoBlocks(blocks: LayoutBlocks): LayoutBlocks {
  return { ...blocks, barcode: false, phone: false, arrears: false, printedAt: false }
}

function quietTemplateBlocks(t: PrintTemplate): PrintTemplate {
  const layoutBlocks = { ...t.layoutBlocks }
  for (const id of BUILTIN_LAYOUT_IDS) {
    layoutBlocks[id] = quietInfoBlocks(layoutBlocks[id] || defaultLayoutBlocks())
  }
  const returnLayoutBlocks: Record<string, LayoutBlocks> = {}
  for (const key of Object.keys(t.returnLayoutBlocks || {})) {
    returnLayoutBlocks[key] = quietInfoBlocks(t.returnLayoutBlocks[key])
  }
  const customTemplates = (t.customTemplates || []).map((item) => ({
    ...item,
    blocks: quietInfoBlocks(item.blocks),
  }))
  return { ...t, layoutBlocks, returnLayoutBlocks, customTemplates }
}

const QUIET_LINE_KEY = 'tuk_print_quiet_sale_lineno_v1'

/** 上一版误把销售单序号关掉。若已经写入，打开时改回。 */
function restoreSaleLineNo(t: PrintTemplate): PrintTemplate {
  let stage = 0
  try {
    stage = Number(wx.getStorageSync(QUIET_LINE_KEY) || 0)
  } catch (_) {
    return t
  }
  if (!stage) return t
  const layoutBlocks = { ...t.layoutBlocks }
  for (const id of Object.keys(layoutBlocks)) {
    const cur = layoutBlocks[id as BuiltinLayoutId]
    if (cur && !cur.lineNo) layoutBlocks[id as BuiltinLayoutId] = { ...cur, lineNo: true }
  }
  const customTemplates = (t.customTemplates || []).map((item) =>
    item.doc === 'return' || item.blocks?.lineNo !== false
      ? item
      : { ...item, blocks: { ...item.blocks, lineNo: true } },
  )
  try {
    wx.removeStorageSync(QUIET_LINE_KEY)
    const settings = require('./print-settings') as {
      loadPrintSettings?: () => { printLineNumber?: boolean }
      savePrintSettings?: (s: any) => void
    }
    const s = settings.loadPrintSettings?.()
    if (s && s.printLineNumber === false) settings.savePrintSettings?.({ ...s, printLineNumber: true })
  } catch (_) {}
  const next = { ...t, layoutBlocks, customTemplates }
  persistTemplateLocal(next)
  markPrintPrefsDirty()
  schedulePushPrintSettings()
  return next
}

function quietInfoStage(): number {
  try {
    return Number(wx.getStorageSync(QUIET_INFO_KEY) || 0)
  } catch (_) {
    return 0
  }
}

function silenceQuietPrintSettings() {
  try {
    const settings = require('./print-settings') as {
      loadPrintSettings?: () => Record<string, unknown>
      savePrintSettings?: (s: any) => void
    }
    const s = settings.loadPrintSettings?.()
    if (!s || !settings.savePrintSettings) return
    settings.savePrintSettings({
      ...s,
      printBarcode: false,
      printArrears: false,
      printTime: false,
    })
  } catch (_) {}
}

const HOME_QR_OFF_KEY = 'tuk_home_qr_off_v1'

/** 旧数据默认开着首页二维码。只关一次，之后用户自己打开的保留。小票二维码不动。 */
function applyHomeQrOffDefault(t: PrintTemplate): PrintTemplate {
  try {
    if (wx.getStorageSync(HOME_QR_OFF_KEY)) return t
    wx.setStorageSync(HOME_QR_OFF_KEY, 1)
  } catch (_) {
    return t
  }
  if (t.showHomeQr === false) return t
  const next = { ...t, showHomeQr: false }
  persistTemplateLocal(next)
  markPrintPrefsDirty()
  schedulePushPrintSettings()
  return next
}

const QUIET_RETURN_KEY = 'tuk_print_quiet_return_v1'

function quietReturnBlocks(blocks: LayoutBlocks): LayoutBlocks {
  return {
    ...blocks,
    barcode: false,
    phone: false,
    arrears: false,
    printedAt: false,
    subtitle: false,
    address: false,
  }
}

function quietReturnTemplate(t: PrintTemplate): PrintTemplate {
  const returnLayoutBlocks: Record<string, LayoutBlocks> = {}
  for (const key of Object.keys(t.returnLayoutBlocks || {})) {
    returnLayoutBlocks[key] = quietReturnBlocks(t.returnLayoutBlocks[key])
  }
  return { ...t, returnLayoutBlocks }
}

function quietReturnStage(): number {
  try {
    return Number(wx.getStorageSync(QUIET_RETURN_KEY) || 0)
  } catch (_) {
    return 0
  }
}

/** 已保存的退单票面只收一次：条形码、欠款、电话、打印时间、副标题、地址默认关掉。 */
function applyQuietReturnDefaults(t: PrintTemplate, stage: 1 | 2): PrintTemplate {
  if (quietReturnStage() >= stage) return t
  const next = quietReturnTemplate(t)
  try {
    wx.setStorageSync(QUIET_RETURN_KEY, stage)
  } catch (_) {}
  persistTemplateLocal(next)
  return next
}

/** 旧模版默认开着条形码和电话。只收一次，之后用户自己打开的保留。 */
function applyQuietInfoDefaults(t: PrintTemplate, stage: 1 | 2): PrintTemplate {
  if (quietInfoStage() >= stage) return t
  const next = quietTemplateBlocks(t)
  if (stage === 1) silenceQuietPrintSettings()
  try {
    wx.setStorageSync(QUIET_INFO_KEY, stage)
  } catch (_) {}
  persistTemplateLocal(next)
  return next
}

function silencePrintTime() {
  try {
    const settings = require('./print-settings') as {
      loadPrintSettings?: () => { printTime?: boolean }
      savePrintSettings?: (s: any) => void
    }
    const s = settings.loadPrintSettings?.()
    if (s && s.printTime) settings.savePrintSettings?.({ ...s, printTime: false })
  } catch (_) {}
}

function choiceOf(src: PrintTemplate, isReturn: boolean): { templateId: PrintTemplateTypeId; customId: string } {
  if (isReturn) {
    if (src.returnTemplate) {
      return { templateId: src.returnTemplate, customId: customIdOk(src.returnActiveCustomId) }
    }
    return { templateId: normalizeTemplateId(src.template), customId: '' }
  }
  return { templateId: normalizeTemplateId(src.template), customId: customIdOk(src.activeCustomId) }
}

export function resolvePrintLayout(t?: PrintTemplate | null, isReturn = false): ResolvedPrintLayout {
  const src = t || loadPrintTemplate()
  const choice = choiceOf(src, isReturn)
  const templateId = choice.templateId
  const builtinId: BuiltinLayoutId = isBuiltinLayoutId(templateId) ? templateId : 'cashier'
  const blocksOf = src.layoutBlocks || emptyLayoutMap()
  const builtinBlocks = normalizeBlocks(blocksOf[builtinId], defaultLayoutBlocks())
  const custom = (src.customTemplates || []).find((item) => item.id === choice.customId)
  const docOk = !!custom && (isReturn ? custom.doc === 'return' : custom.doc !== 'return')
  let layout: ResolvedPrintLayout
  if (custom && docOk && custom.basedOn === templateId && custom.columns.length) {
    layout = {
      templateId,
      customId: custom.id,
      blocks: normalizeBlocks(custom.blocks, builtinBlocks),
      columns: custom.columns.map((col) => ({ ...col })),
    }
  } else {
    layout = { templateId: builtinId, customId: '', blocks: builtinBlocks, columns: null }
  }
  if (!isReturn) return layout
  const key = layout.customId || layout.templateId
  return { ...layout, blocks: returnBlocksOf(src, key, layout.blocks) }
}

function writeLayoutFlags(blocks: LayoutBlocks) {
  try {
    const settings = require('./print-settings') as {
      loadPrintSettings?: () => Record<string, unknown>
      savePrintSettings?: (s: any) => void
    }
    const s = settings.loadPrintSettings?.()
    if (!s || !settings.savePrintSettings) return
    settings.savePrintSettings({
      ...s,
      printLineNumber: !!blocks.lineNo,
      printAddress: !!blocks.address,
      printArrears: !!blocks.arrears,
      printTime: !!blocks.printedAt,
      printBarcode: !!blocks.barcode,
    })
  } catch (_) {}
}

/** 把当前版式的块抄回旧开关，票头码和打印选项继续走原来的读取。 */
export function mirrorActiveLayout(t: PrintTemplate): PrintTemplate {
  const layout = resolvePrintLayout(t)
  const blocks = layout.blocks
  t.printHeaderLookupQr = blocks.lookup
  t.printHeaderNewArrivalQr = blocks.headerArrival
  t.printSubtitle = blocks.subtitle
  t.printPaymentQr = blocks.payQr
  t.printNewArrivalQr = blocks.footerArrival
  t.template = layout.templateId
  if (!layout.customId) t.activeCustomId = ''
  writeLayoutFlags(blocks)
  return t
}

export function layoutHashSuffix(t: PrintTemplate, builtinFields: string[]): string {
  const layout = resolvePrintLayout(t)
  const ret = resolvePrintLayout(t, true)
  const fields = (layout.columns || builtinFields.map((field) => ({ field }))).map((col) => col.field)
  const on = LAYOUT_BLOCK_KEYS.filter((key) => layout.blocks[key])
  const onRet = LAYOUT_BLOCK_KEYS.filter((key) => ret.blocks[key])
  const slots = `${layout.blocks.slotLeft}>${layout.blocks.slotRight}>${layout.blocks.slotFoot}`
  const slotsRet = `${ret.blocks.slotLeft}>${ret.blocks.slotRight}>${ret.blocks.slotFoot}`
  const footer = layout.blocks.footer ? t.footerText || '' : ''
  return `${layout.templateId}|${layout.customId}|${fields.join('.')}|${on.join('.')}|${slots}|R${ret.templateId}|${ret.customId}|${onRet.join('.')}|${slotsRet}|${footer}`
}

export function newCustomTemplateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'c_'
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

export function withActiveBlocks(t: PrintTemplate, blocks: LayoutBlocks, isReturn = false): PrintTemplate {
  const layout = resolvePrintLayout(t, isReturn)
  const clean = normalizeBlocks(blocks, defaultLayoutBlocks())
  if (isReturn) {
    const key = layout.customId || (isBuiltinLayoutId(layout.templateId) ? layout.templateId : 'cashier')
    return {
      ...t,
      returnLayoutBlocks: { ...(t.returnLayoutBlocks || {}), [key]: clean },
    }
  }
  const next: PrintTemplate = {
    ...t,
    layoutBlocks: { ...t.layoutBlocks },
    customTemplates: t.customTemplates.map((item) => ({ ...item, blocks: { ...item.blocks } })),
  }
  if (layout.customId) {
    next.customTemplates = next.customTemplates.map((item) =>
      item.id === layout.customId ? { ...item, blocks: clean } : item,
    )
  } else {
    const id = isBuiltinLayoutId(layout.templateId) ? layout.templateId : 'cashier'
    next.layoutBlocks = { ...next.layoutBlocks, [id]: clean }
  }
  return next
}

export function withActiveColumns(t: PrintTemplate, columns: LayoutColumn[], isReturn = false): PrintTemplate | null {
  const layout = resolvePrintLayout(t, isReturn)
  if (!layout.customId) return null
  const clean = normalizeColumns(columns)
  if (!clean.length) return null
  return {
    ...t,
    customTemplates: t.customTemplates.map((item) =>
      item.id === layout.customId ? { ...item, columns: clean } : item,
    ),
  }
}

export function savePrintTemplate(t: PrintTemplate): PrintTemplate {
  if (!canEditPrintTemplate()) return t
  const next: PrintTemplate = {
    ...t,
    layoutBlocks: t.layoutBlocks || emptyLayoutMap(),
    returnLayoutBlocks: t.returnLayoutBlocks || {},
    customTemplates: t.customTemplates || [],
    activeCustomId: t.activeCustomId || '',
    returnTemplate: t.returnTemplate || '',
    returnActiveCustomId: t.returnActiveCustomId || '',
  }
  mirrorActiveLayout(next)
  persistTemplateLocal(next)
  markPrintPrefsDirty()
  schedulePushPrintSettings()
  return next
}

function readFileBase64(path: string): string {
  if (!path) return ''
  try {
    return String(wx.getFileSystemManager().readFileSync(path, 'base64') || '')
  } catch (_) {
    return ''
  }
}

/** 本机已有模版时随 prefs 上传；无本地记录则返回 null，保留云端原值 */
export function printTemplateCloudBlock(): Record<string, unknown> | null {
  try {
    const raw = wx.getStorageSync(KEY)
    if (!raw || typeof raw !== 'object') return null
  } catch (_) {
    return null
  }
  const t = loadPrintTemplate()
  const block: Record<string, unknown> = {
    'print.template': t.template,
    'print.header': resolveMerchantTitle(peekCachedShop()?.shopName, t.headerTitle),
    'print.footer': t.footerText,
    'print.payment_qr_hint': t.paymentQrHintText,
    'print.payment_qr': !!t.printPaymentQr,
    'print.new_arrival_qr': t.printNewArrivalQr !== false,
    'print.new_arrival_url': t.newArrivalQrUrl || '',
    'print.new_arrival_hint': t.newArrivalQrHintText || '',
    'print.header_lookup_qr': t.printHeaderLookupQr !== false,
    'print.header_new_arrival_qr': t.printHeaderNewArrivalQr !== false,
    'print.subtitle': t.printSubtitle !== false,
    'print.home_qr': t.showHomeQr === true,
    'print.logo': t.printLogo !== false,
    'print.home_shop_name': t.showHomeShopName !== false,
    'print.sheet_index': t.showSheetIndex !== false,
    'print.header_text_size': headerTextSizeOf(t.headerTextSize),
    'print.layout_blocks': t.layoutBlocks,
    'print.return_layout_blocks': t.returnLayoutBlocks || {},
    'print.custom_templates': t.customTemplates,
    'print.sale_custom_templates': t.customTemplates.filter((item) => item.doc !== 'return'),
    'print.return_custom_templates': t.customTemplates.filter((item) => item.doc === 'return'),
    'print.active_custom_id': t.activeCustomId || '',
    'print.return_template': t.returnTemplate || '',
    'print.return_active_custom_id': t.returnActiveCustomId || '',
  }
  if (t.wechatQrPath && fileExists(t.wechatQrPath)) {
    const b64 = readFileBase64(t.wechatQrPath)
    if (b64) block.wechatQrBase64 = b64
  } else if (!t.wechatQrPath) {
    block.clearWechatQr = true
  }
  if (t.alipayQrPath && fileExists(t.alipayQrPath)) {
    const b64 = readFileBase64(t.alipayQrPath)
    if (b64) block.alipayQrBase64 = b64
  } else if (!t.alipayQrPath) {
    block.clearAlipayQr = true
  }
  if (t.friendQrPath && fileExists(t.friendQrPath)) {
    const b64 = readFileBase64(t.friendQrPath)
    if (b64) block.friendQrBase64 = b64
  } else if (!t.friendQrPath) {
    block.clearFriendQr = true
  }
  return block
}

export function hasWechatQr(t: PrintTemplate): boolean {
  return !!(t.wechatQrPath && fileExists(t.wechatQrPath))
}

export function hasAlipayQr(t: PrintTemplate): boolean {
  return !!(t.alipayQrPath && fileExists(t.alipayQrPath))
}

export function hasFriendQr(t: PrintTemplate): boolean {
  return !!(t.friendQrPath && fileExists(t.friendQrPath))
}

export function clearQr(kind: 'wechat' | 'alipay') {
  const dest = kind === 'wechat' ? WECHAT_FILE : ALIPAY_FILE
  removeFile(dest)
  const t = loadPrintTemplate()
  if (kind === 'wechat') t.wechatQrPath = ''
  else t.alipayQrPath = ''
  savePrintTemplate(t)
  return t
}

/** 从云端 prefs 拉取打印模版（含收款码 Base64），写入本地 */
export async function pullPrintTemplateFromCloud(opts?: {
  applyPrintOptions?: boolean
  force?: boolean
}): Promise<{
  ok: boolean
  applied: boolean
  error?: string
  template: PrintTemplate
}> {
  const local = loadPrintTemplate()
  if (isGuest() || !isLoggedIn() || !isCloudSyncAllowed()) {
    return { ok: true, applied: false, template: local }
  }
  const force = !!opts?.force || !!opts?.applyPrintOptions
  if (!force && isPrintPrefsDirty()) {
    return { ok: true, applied: false, template: local }
  }
  try {
    const res = await request<{ hasPrefs?: boolean; prefs?: any }>({
      path: `/api/v1/team/prefs?clientId=${encodeURIComponent(getOrCreateClientId())}`,
      method: 'GET',
      needAuth: true,
    })
    if (!res.ok || !res.data) {
      return { ok: false, applied: false, error: res.message, template: local }
    }
    if (!res.data.hasPrefs || !res.data.prefs || typeof res.data.prefs !== 'object') {
      return { ok: true, applied: false, template: local }
    }
    // 仅登录水合等显式场景才覆盖打印选项；进设置页拉取模版绝不能把刚保存的本机选项冲掉
    if (opts?.applyPrintOptions) {
      applyPrintOptionsFromPrefs(res.data.prefs as Record<string, unknown>)
    }
    const pt = (res.data.prefs as any).printTemplate
    if (!pt || typeof pt !== 'object') {
      return { ok: true, applied: false, template: local }
    }

    const next: PrintTemplate = { ...local }

    const tplId = pt['print.template'] ?? pt.template
    if (tplId != null) next.template = normalizeTemplateId(tplId)

    const header = pt['print.header'] ?? pt.headerTitle
    if (typeof header === 'string' && header.trim()) next.headerTitle = header.trim()

    const footer = pt['print.footer'] ?? pt.footerText
    if (typeof footer === 'string') next.footerText = clothingFooterText(footer)

    const hint = pt['print.payment_qr_hint'] ?? pt.paymentQrHintText
    if (typeof hint === 'string' && hint.trim()) next.paymentQrHintText = hint.trim()

    const printQr = pt['print.payment_qr'] ?? pt.printPaymentQr
    if (typeof printQr === 'boolean') next.printPaymentQr = printQr

    const printNew =
      pt['print.new_arrival_qr'] ?? pt.printNewArrivalQr
    if (typeof printNew === 'boolean') next.printNewArrivalQr = printNew

    const newUrl =
      pt['print.new_arrival_url'] ?? pt.newArrivalQrUrl
    if (typeof newUrl === 'string') {
      next.newArrivalQrUrl = newUrl.trim()
    }

    const newHint =
      pt['print.new_arrival_hint'] ?? pt.newArrivalQrHintText
    if (typeof newHint === 'string') {
      next.newArrivalQrHintText = newHint.trim()
    }

    const headerLookup =
      pt['print.header_lookup_qr'] ?? pt.printHeaderLookupQr
    if (typeof headerLookup === 'boolean') next.printHeaderLookupQr = headerLookup

    const headerArrival =
      pt['print.header_new_arrival_qr'] ?? pt.printHeaderNewArrivalQr
    if (typeof headerArrival === 'boolean') next.printHeaderNewArrivalQr = headerArrival

    const printSub = pt['print.subtitle'] ?? pt.printSubtitle
    if (typeof printSub === 'boolean') next.printSubtitle = printSub

    const homeQr = pt['print.home_qr'] ?? pt.showHomeQr
    if (typeof homeQr === 'boolean') next.showHomeQr = homeQr
    const printLogo = pt['print.logo'] ?? pt.printLogo
    if (typeof printLogo === 'boolean') next.printLogo = printLogo
    const homeShop = pt['print.home_shop_name'] ?? pt.showHomeShopName
    if (typeof homeShop === 'boolean') next.showHomeShopName = homeShop
    const sheetIndex = pt['print.sheet_index'] ?? pt.showSheetIndex
    if (typeof sheetIndex === 'boolean') next.showSheetIndex = sheetIndex
    const headerSize = pt['print.header_text_size'] ?? pt.headerTextSize
    if (headerSize === 'sm' || headerSize === 'md' || headerSize === 'lg') next.headerTextSize = headerSize

    if (pt['print.layout_blocks'] && typeof pt['print.layout_blocks'] === 'object') {
      next.layoutBlocks = normalizeLayoutMap(pt['print.layout_blocks'], null)
    }
    if (pt['print.return_layout_blocks'] && typeof pt['print.return_layout_blocks'] === 'object') {
      next.returnLayoutBlocks = normalizeReturnLayoutMap(pt['print.return_layout_blocks'])
    } else {
      next.returnLayoutBlocks = {}
    }
    if (typeof pt['print.active_custom_id'] === 'string') {
      next.activeCustomId = customIdOk(pt['print.active_custom_id'])
    }
    if (typeof pt['print.return_template'] === 'string') {
      next.returnTemplate = optionalTemplateId(pt['print.return_template'])
    }
    if (typeof pt['print.return_active_custom_id'] === 'string') {
      next.returnActiveCustomId = customIdOk(pt['print.return_active_custom_id'])
    }
    const saleCloud = pt['print.sale_custom_templates']
    const returnCloud = pt['print.return_custom_templates']
    if (Array.isArray(saleCloud) || Array.isArray(returnCloud)) {
      const sale = Array.isArray(saleCloud)
        ? normalizeCustomList(saleCloud, { forceDoc: 'sale' })
        : next.customTemplates.filter((item) => item.doc !== 'return')
      const ret = Array.isArray(returnCloud)
        ? normalizeCustomList(returnCloud, { forceDoc: 'return' })
        : next.customTemplates.filter((item) => item.doc === 'return')
      const joined = joinDocLists(sale, ret, next.activeCustomId, next.returnActiveCustomId)
      next.customTemplates = joined.list
      next.returnActiveCustomId = joined.returnId
    } else if (Array.isArray(pt['print.custom_templates'])) {
      const rawList = pt['print.custom_templates']
      const rawCount = rawList.filter((item: unknown) => item && typeof item === 'object').length
      const cloudHasDoc = rawList.some(
        (item: { doc?: unknown }) => item && (item.doc === 'sale' || item.doc === 'return'),
      )
      const cleaned = normalizeCustomList(rawList, {
        activeId: next.activeCustomId,
        returnId: next.returnActiveCustomId,
      })
      const localReturn = next.customTemplates.filter((item) => item.doc === 'return')
      if (!cloudHasDoc && localReturn.length) {
        const returnIds = new Set(localReturn.map((item) => item.id))
        next.customTemplates = [
          ...cleaned.filter((item) => item.doc !== 'return' && !returnIds.has(item.id)),
          ...localReturn,
        ]
      } else if (cleaned.length || rawCount === 0 || !next.customTemplates.length) {
        next.customTemplates = cleaned
      }
    }
    const detached = detachSharedCustom(next.customTemplates, next.activeCustomId, next.returnActiveCustomId)
    next.customTemplates = detached.list
    next.returnActiveCustomId = detached.returnId
    reconcileActive(next)
    mirrorActiveLayout(next)

    if (pt.clearWechatQr === true) {
      removeFile(WECHAT_FILE)
      next.wechatQrPath = ''
    } else if (typeof pt.wechatQrBase64 === 'string' && pt.wechatQrBase64) {
      const p = writeBase64Png(WECHAT_FILE, pt.wechatQrBase64)
      if (p) next.wechatQrPath = p
    }

    if (pt.clearAlipayQr === true) {
      removeFile(ALIPAY_FILE)
      next.alipayQrPath = ''
    } else if (typeof pt.alipayQrBase64 === 'string' && pt.alipayQrBase64) {
      const p = writeBase64Png(ALIPAY_FILE, pt.alipayQrBase64)
      if (p) next.alipayQrPath = p
    }

    if (pt.clearFriendQr === true) {
      removeFile(FRIEND_FILE)
      next.friendQrPath = ''
    } else if (typeof pt.friendQrBase64 === 'string' && pt.friendQrBase64) {
      const p = writeBase64Png(FRIEND_FILE, pt.friendQrBase64)
      if (p) next.friendQrPath = p
    }

    const quieted = restoreSaleLineNo(applyHomeQrOffDefault(applyQuietReturnDefaults(applyQuietInfoDefaults(next, 2), 2)))
    if (quieted === next) persistTemplateLocal(next)
    else {
      markPrintPrefsDirty()
      schedulePushPrintSettings()
    }
    return { ok: true, applied: true, template: quieted }
  } catch (e: any) {
    return {
      ok: false,
      applied: false,
      error: String(e?.message || e || '拉取失败'),
      template: local,
    }
  }
}

/** 从相册选图保存为收款码（旧路径：原图直存，新绑定请用 saveQrFromPayload） */
export function saveQrFromTempFile(
  kind: 'wechat' | 'alipay',
  tempFilePath: string,
): string {
  const dest = kind === 'wechat' ? WECHAT_FILE : ALIPAY_FILE
  try {
    wx.getFileSystemManager().copyFileSync(tempFilePath, dest)
    const t = loadPrintTemplate()
    if (kind === 'wechat') t.wechatQrPath = dest
    else t.alipayQrPath = dest
    t.printPaymentQr = true
    savePrintTemplate(t)
    return dest
  } catch (_) {
    return ''
  }
}

/** 识别收款码内容后生成标准二维码图（对齐 App PaymentQrService.bindFromPayload） */
export function saveQrFromPayload(kind: 'wechat' | 'alipay', payload: string): string {
  const dest = kind === 'wechat' ? WECHAT_FILE : ALIPAY_FILE
  const b64 = generatePaymentQrBase64(payload)
  const path = writeBase64Png(dest, b64)
  if (!path) return ''
  const t = loadPrintTemplate()
  if (kind === 'wechat') t.wechatQrPath = path
  else t.alipayQrPath = path
  t.printPaymentQr = true
  savePrintTemplate(t)
  return path
}

/** 把扫到的微信好友码内容画成可打印的黑白二维码，全票共用这一张 */
export function saveFriendQrFromPayload(payload: string): string {
  const text = String(payload || '').trim()
  if (!text) return ''
  const b64 = renderQrPngBase64(text)
  const path = writeBase64Png(FRIEND_FILE, b64)
  if (!path) return ''
  const t = loadPrintTemplate()
  t.friendQrPath = path
  savePrintTemplate(t)
  return path
}
