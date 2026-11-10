import { genOrderNo, genJobNo } from '../../services/api'
import { extractOrderImage, extractOrderText, extractVoiceCommand } from '../../services/ai'
import type { AiItem } from '../../services/ai'
import { buildVoiceCommand } from '../../services/voice-intent'
import type { VoiceCommand } from '../../services/voice-intent'
import { extractDeskActions, actionsFromLlmJson, isSystemVoiceCommand, voiceShouldAskModel, spokenPersonName, spokenBillDate, rememberVoiceProduct, peekVoiceProduct, clearVoiceProduct, voiceFunctionPhrases, utteranceNamesCustomer, stripSpokenMarks } from '../../services/voice-router'
import { matchSpokenCustomer, rewriteVoiceFromCache } from '../../services/voice-fuzzy'
import type { VoiceDeskAction, VoiceOpenPage, VoiceSearchTarget } from '../../services/voice-router'
import {
  applySpokenAliases,
  cartToVoiceItems,
  clearVoiceSlot,
  consumeSessionUtterance,
  pickLastOrder,
  rememberSpokenAlias,
  rememberSpokenAliases,
  rememberVoiceCustomer,
  rememberVoiceFill,
  utteranceConfirmed,
} from '../../services/voice-memory'
import { setVoiceJump } from '../../services/voice-jump'
import type { VoiceJumpPage } from '../../services/voice-jump'
import {
  catalogCoversSpokenCode,
  extractVoiceSkuItems,
  mergeVoiceSkuItems,
  unglueSpokenQty,
} from '../../services/voice-sku'
import { linesFromLlmItems, parseVoiceMatrix, parseWrittenSkuBill, settleSpokenSku } from '../../services/voice-matrix'
import type { VoiceMatrixLine } from '../../services/voice-matrix'
import type { VoiceSkuAmbiguous, VoiceSkuResult } from '../../services/voice-sku'
import {
  buildStmtPreview,
  holdStmtPreview,
  orderCreatedAt,
  rangeBounds,
} from '../../services/analytics'
import type { RangeKey } from '../../services/analytics'
import { isLoggedIn, canBrowseApp, isGuest, getGuestSession, getSession, markGuestOrderReady } from '../../services/session'
import { enterBrowseOnlyGuest, exitAgentToLogin } from '../../services/auth'
import { isCloudSyncAllowed, refreshEntitlement } from '../../services/subscription'
import { getTabItems, i18nState, returnReasonLabels, t, tabIndexFor, weekLabels } from '../../services/i18n'
import { loadPrintSettings, shouldUseRasterPrint } from '../../services/print-settings'
import { agentOrderKind, applyAgentShop, captureLaunchInvites, consumeStallInvite, consumeStaffInvite, extractInviteToken, fetchAgentMe, fetchAgentPlaza, fetchAgentShopSetting, lookupSharePath, lookupShareTitle, merchantInviteStatsHint, merchantOpenShareMessage, ensureAgentInviteQr, merchantRenewShare, mintLookupShare, mintMerchantOpenInvite, plazaLogoSrc, shouldConsumeLaunchInvites, takePendingMerchantInvite, takePendingStaffInvite, takePendingStallInvite, type AgentBinding, type AgentRankItem, type AgentTrendDay, type LookupOrder, type PlazaShop } from '../../services/lookup'
import {
  applyWorkspaceAndRelaunch,
  canSwitchWorkspace,
  getWorkspacePreference,
  isAgentWorkspace,
  isDevelopMp,
  isMerchantSession,
  openAgentProfileGate,
  peekAgentBoundFlag,
  peekAgentOwnerId,
  saveAgentOwnerId,
  setWorkspacePreference,
  tabBarTheme,
} from '../../services/workspace'
import { assertMediaCheckAsync, assertMsgSecCheck } from '../../services/sec-check'
import { requireCloudAccount, requireCloudSync } from '../../services/account-gate'
import { verifyOrKick } from '../../services/session-guard'
import { softDeleteCustomer } from '../../services/recycle-bin'
import {
  forgetRecentCustomer,
  pruneRecentCustomers,
  removeRecentCustomer,
  saveRecentCustomer,
} from '../../services/recent-customers'
import { applyCapsuleStyle, capsuleStyleDefaults } from '../../utils/nav'
import { combineDateStrWithNow } from '../../utils/util'
import {
  persistDeliveryLocalPath,
  pickDeliveryImage,
  readLocalFileBase64,
} from '../../utils/delivery-photo'
import {
  headerTextSizePx,
  loadPrintTemplate,
  pullPrintTemplateFromCloud,
} from '../../services/print-template'
import { extraReceiptQr, resolveShopSubtitle } from '../../services/receipt-qr'
import { requestAgentApplyResultSubscribe, requestBillSubscribe, requestNewArrivalSubscribe } from '../../services/subscribe'
import {
  buildReceiptRenderModel,
  estimateReceiptCanvasHeight,
  receiptPrintFlags,
  receiptShopTitle,
  type ReceiptRenderModel,
} from '../../services/receipt-layout'
import { estimateQrBlockH } from '../../utils/receipt-canvas'
import { buildRasterPrintBytes, receiptFontScale, renderReceiptCanvas } from '../../utils/receipt-render'
import { ensureArrivalQrImage } from '../../utils/arrival-qr'
import { resolveNewArrivalQrWithImage } from '../../utils/return-receipt'
import {
  fetchCatalog,
  markTeamMetaPulled,
  shouldPullTeamMeta,
  fetchCustomers,
  fetchShop,
  fetchAllOrdersFull,
  recentOrdersSinceIso,
  isOwner,
  isJoinedEmployee,
  supplyEntryBlock,
  patchCatalog,
  peekCachedCatalog,
  peekCachedCategories,
  fetchCategories,
  uploadCategories,
  canEditCatalog,
  catalogEditDeniedText,
  peekCachedCustomers,
  peekCachedOrders,
  peekCachedShop,
  fetchStmtOrders,
  uploadCustomers,
  uploadOrder,
  uploadStockMovements,
  findCachedOrder,
  canEditOrder,
} from '../../services/team'
import type { CartItem, Customer, Product, ShopInfo, StockMovement } from '../../services/team'
import {
  applySkuStock,
  displayStock,
  findSkuCell,
  isSkuProduct,
  colorSizeFromItem,
  skuHint,
  skuSpec,
} from '../../services/product-sku'
import { applyAutoStockForOrder } from '../../services/stock-order'
import {
  getCustomerLastPrice,
  priceSourceLabel,
  pullUserPrices,
  pushUserPrices,
  resolveUnitPrice,
  resolveUnitPriceDetail,
} from '../../services/customer-price'
import { getSavedPrinter, refreshBleStatus, tryBlePrintOrExplain, writeBytes } from '../../services/bluetooth'

type SkuPickLine = {
  key: string
  color: string
  size: string
  spec: string
  qty: number
}

type SheetRow = {
  key: string
  productCode: string
  productName: string
  spec: string
  color: string
  size: string
  unit: string
  quantityText: string
  priceText: string
  subtotalLabel: string
  subtotalNeg: boolean
  countInStats: boolean
  skuLines: SkuPickLine[]
  skuOpen: boolean
  skuCount: number
  skuFoldLabel: string
  /** 上次 / 记忆 / 标价，跟单价同一级，不另算价 */
  priceSource?: string
}

type SuggestItem = {
  code: string
  name: string
  label: string
  stockLabel: string
  unit: string
  price: number
  countInStats: boolean
}

type VoiceAskChoice = { id: string; label: string }

type VoiceAskState = {
  kind: 'sku' | 'danger' | 'lastOrder' | 'matrix' | 'customer'
  msg: string
  choices: VoiceAskChoice[]
  items: Array<{ code: string; quantity: number }>
  customerName: string
  actions: VoiceDeskAction[]
  qty: number
  qtySpoken: boolean
  color: string
  size: string
  spoken: string
  lastOrderItems: Array<{ code: string; quantity: number }>
  customerAfter?: '' | 'prices' | 'statement'
  from?: string
  to?: string
  matrixAnswers?: string[]
  matrixFilled?: number
  pendingItems?: AiItem[]
  pendingAmbiguous?: VoiceSkuAmbiguous[]
  pendingDone?: boolean
}

const VOICE_OPEN_URL: Record<VoiceOpenPage, string> = {
  stock: '/pages/stock/stock',
  printSettings: '/pages/print-settings/print-settings',
  printer: '/pages/printer/printer',
  printTemplate: '/pages/print-template/print-template',
  analytics: '/pages/analytics/analytics',
  returns: '/pages/returns/returns',
  customers: '/pages/customers/customers',
  customerNew: '/pages/customers/customers',
  customerPrices: '/pages/customers/prices',
  recycle: '/pages/recycle-bin/recycle-bin',
  team: '/pages/team/team',
  teamData: '/pages/team-data/team-data',
  cloudPrinter: '/pages/cloud-printer/cloud-printer',
  subscription: '/pages/subscription/subscription',
  shop: '/pages/shop-edit/shop-edit',
  tracking: '/pages/tracking-scan/tracking-scan',
  orderLookup: '/pages/order-lookup/order-lookup',
  statementLookup: '/pages/statement-lookup/statement-lookup',
  agentApply: '/pages/agent-plaza/agent-plaza',
  category: '/pages/category-manage/category-manage',
  supplyStyles: '/pages/supply/styles',
  supplyFabric: '/pages/supply/parties?role=fabric',
  supplyTrim: '/pages/supply/parties?role=trim',
  supplyFactory: '/pages/supply/parties?role=factory',
  supplySupplier: '/pages/supply/parties?role=supplier',
  supplyCost: '/pages/supply/cost',
  supplyAgents: '/pages/supply/agents',
  supplySales: '/pages/analytics/analytics?tab=2',
  supplyMap: '/pages/supply/map',
}

const VOICE_SUPPLY_PAGES: VoiceOpenPage[] = [
  'supplyStyles',
  'supplyFabric',
  'supplyTrim',
  'supplyFactory',
  'supplySupplier',
  'supplyCost',
  'supplyAgents',
  'supplySales',
  'supplyMap',
]

const DEFAULT_ROWS = 8
const APPEND_BATCH = 8
const ROW_HEIGHT_PX = 44 // 与 wxss .row height 88rpx ≈ 44px 对齐
const MAX_ROWS = 2000 // 防极端内存，实际等同「无限」
const SUGGEST_PAGE_SIZE = 5
const SUGGEST_LIMIT = 100
/** 客户上次价的取价源（近期订单 + 个人记忆价）不受商品修订号门控，单独限频 */
const PRICE_SOURCES_MIN_MS = 2 * 60 * 1000
let _priceSourcesAt = 0

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '0'
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v))
  return String(Number(v.toFixed(2)))
}

function fmtMoney(v: number): string {
  return (Number.isFinite(v) ? v : 0).toFixed(2)
}

function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const WEEKDAYS_CN = ['日', '一', '二', '三', '四', '五', '六']

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s || '').trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Material 中文：如 8月21日周五 */
function formatCalHeader(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日周${WEEKDAYS_CN[d.getDay()]}`
}

function formatCalMonth(y: number, m0: number): string {
  return `${y}年${m0 + 1}月`
}

type CalCell = {
  key: string
  day: number
  ymd: string
  inMonth: boolean
  selected: boolean
  today: boolean
}

type CustPickRow = {
  id: string
  name: string
  phone: string
  initial: string
  subtitle: string
}

function formatRecentUsedLabel(usedAt: number): string {
  if (!usedAt) return ''
  const diff = Date.now() - usedAt
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '最近选用 · 刚刚'
  if (mins < 60) return `最近选用 · ${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `最近选用 · ${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `最近选用 · ${days} 天前`
  const d = new Date(usedAt)
  return `最近选用 · ${d.getMonth() + 1}/${d.getDate()}`
}

function toCustPickRow(c: Customer, subtitle?: string): CustPickRow {
  const name = c.name || ''
  const phone = String(c.phone || '')
  const parts = [phone, subtitle].filter(Boolean)
  return {
    id: c.id,
    name,
    phone,
    initial: name ? name.substring(0, 1) : '?',
    subtitle: parts.join(' · '),
  }
}

/** 周一为一周起始，对齐 Flutter Material 中文本地化 */
function buildCalCells(viewYear: number, viewMonth0: number, selectedYmd: string): CalCell[] {
  const today = todayStr()
  const first = new Date(viewYear, viewMonth0, 1)
  // JS: Sun=0..Sat=6 → Mon-first offset: Mon=0 ... Sun=6
  const mondayIndex = (first.getDay() + 6) % 7
  const start = new Date(viewYear, viewMonth0, 1 - mondayIndex)
  const cells: CalCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const ymd = ymdOf(d)
    const inMonth = d.getMonth() === viewMonth0
    cells.push({
      key: ymd,
      day: d.getDate(),
      ymd,
      inMonth,
      selected: ymd === selectedYmd,
      today: ymd === today,
    })
  }
  return cells
}

/** 进入退单时自动写入的备注，退出/开销售单时必须清掉，否则扫码查账会在货单下看到「退单」 */
const AUTO_RETURN_REMARK_RE = /^【\d{4}-\d{2}-\d{2}退单】(?:经办：.*)?$/

function isAutoReturnRemark(remark?: string | null): boolean {
  return AUTO_RETURN_REMARK_RE.test(String(remark || '').trim())
}

function remarkForSave(remark: string, isReturn: boolean): string {
  const s = String(remark || '').trim()
  if (isReturn) return s
  if (isAutoReturnRemark(s)) return ''
  return s
}

function customerKey(name?: string | null, phone?: string | null): string {
  const n = String(name || '').trim()
  const p = String(phone || '').trim()
  if (!n && !p) return ''
  return `${n}|${p}`
}

function emptyRow(i: number): SheetRow {
  return {
    key: `r-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
    productCode: '',
    productName: '',
    spec: '',
    color: '',
    size: '',
    unit: '',
    quantityText: '',
    priceText: '',
    subtotalLabel: '',
    subtotalNeg: false,
    countInStats: true,
    skuLines: [],
    skuOpen: false,
    skuCount: 0,
    skuFoldLabel: '',
  }
}

/** 这一行已经写过内容（品名、单位、数量、单价或规格任一有值） */
function rowHasSheetInput(r: SheetRow): boolean {
  return !!(
    (r.productName || '').trim() ||
    (r.productCode || '').trim() ||
    (r.unit || '').trim() ||
    (r.quantityText || '').trim() ||
    (r.priceText || '').trim() ||
    (r.skuLines && r.skuLines.length)
  )
}

function rowCodeOf(row: SheetRow): string {
  return (row.productCode || row.productName || '').trim()
}

function decorateSkuRow(row: SheetRow, isReturn = false): SheetRow {
  const lines = row.skuLines || []
  row.skuCount = lines.length
  if (!lines.length) {
    row.skuFoldLabel = ''
    row.skuOpen = false
    return row
  }
  const sum = lines.reduce((s, x) => s + (Number(x.qty) || 0), 0)
  row.quantityText = isReturn ? String(-Math.abs(sum)) : String(Math.abs(sum))
  row.spec = lines.length === 1 ? lines[0].spec : ''
  row.color = lines.length === 1 ? lines[0].color : ''
  row.size = lines.length === 1 ? lines[0].size : ''
  const short = (s: string) => s.replace(/\s*\/\s*/g, '/')
  const part = (x: { spec: string; qty: number }) => `${short(x.spec)}(${Number(x.qty) || 0})`
  const priceNote = row.priceSource && row.priceText ? ` ${row.priceSource} ${row.priceText}` : ''
  if (lines.length === 1) row.skuFoldLabel = part(lines[0]) + priceNote
  else if (lines.length === 2) row.skuFoldLabel = `${part(lines[0])} · ${part(lines[1])}${priceNote}`
  else {
    row.skuFoldLabel = `${part(lines[0])} ${t('skuEtc')}${lines.length}${t('skuItems')}${priceNote}`
  }
  return row
}

function findSameCodeIndex(rows: SheetRow[], code: string, prefer = -1): number {
  const c = code.trim()
  if (!c) return prefer
  const hit = rows.findIndex(
    (r, i) =>
      rowCodeOf(r) === c &&
      (r.skuCount > 0 ||
        !!(parseFloat(r.quantityText) || 0) ||
        (i !== prefer && !!r.productName.trim())),
  )
  return hit >= 0 ? hit : prefer
}

function rowSubtotal(row: SheetRow): number {
  const q = parseFloat(row.quantityText)
  const p = parseFloat(row.priceText)
  if (!Number.isFinite(q) || !Number.isFinite(p)) return 0
  return q * p
}

function refreshRow(row: SheetRow): SheetRow {
  const sub = rowSubtotal(row)
  const has =
    !!(row.productName.trim() || row.quantityText.trim() || row.priceText.trim())
  return {
    ...row,
    subtotalLabel: has ? fmtMoney(sub) : '',
    subtotalNeg: has && sub < 0,
  }
}

function displaySuggestLabel(p: Product): string {
  const name = (p.name || '').trim()
  const code = (p.code || '').trim()
  if (!name) return code
  if (!code) return name
  if (name.startsWith(code) || name.includes(code)) return name
  return `${code}${name}`
}

function normalizeReturnQty(raw: string): string {
  const t = raw.trim()
  if (!t || t === '-') return raw
  if (t.startsWith('-')) return raw
  return `-${t}`
}

function money2(n: number) {
  return (Number(n) || 0).toFixed(2)
}

function qtyLabel(n: number) {
  const v = Number(n) || 0
  if (Math.abs(v - Math.round(v)) < 0.001) return String(Math.round(v))
  return v.toFixed(1)
}

function mapAgentRank(rows?: AgentRankItem[], fallbackShop?: string) {
  const list = (rows || []).slice(0, 5)
  const max = Math.max(0, ...list.map((r) => Number(r.qty || 0)))
  const shopFallback = String(fallbackShop || '').trim()
  return list.map((r, i) => {
    const qty = Number(r.qty || 0)
    const code = String(r.code || '').trim()
    const name = String(r.name || '').trim()
    const shop = String(r.shopName || shopFallback).trim()
    const title = shop && code ? `${shop} ${code}` : shop || (name && name !== code ? name : code)
    const sub = shop ? (name && name !== code ? name : '') : name && name !== code ? code : ''
    return {
      rank: i + 1,
      code,
      rowKey: `${shop}-${code}-${i}`,
      title,
      sub,
      qtyLabel: qtyLabel(qty),
      amountLabel: money2(Number(r.amount || 0)),
      barPct: max > 0 && qty > 0 ? Math.max(8, Math.round((qty / max) * 100)) : 0,
    }
  })
}

function dayNum(ymd: string) {
  const p = String(ymd || '').split('-')
  if (p.length < 3) return ymd
  return String(Number(p[2]) || p[2])
}

function mdLabel(ymd: string) {
  const p = String(ymd || '').split('-')
  if (p.length < 3) return ymd
  return `${Number(p[1])}/${Number(p[2])}`
}

/** 表头竖线拖动后的列宽（rpx）：序号、商品名、单位、数量、单价、总价 */
const SHEET_COL_KEY = 'home-sheet-cols-v2'
const SHEET_COL_MIN = [48, 120, 72, 80, 80, 96]
const SHEET_COL_DEF = [64, 210, 106, 106, 106, 158]
const SHEET_COL_PREV = [64, 220, 106, 106, 106, 148]

function clampSheetCols(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length !== SHEET_COL_DEF.length) return SHEET_COL_DEF.slice()
  const nums = raw.map((n) => Math.round(Number(n)))
  if (nums.every((n, i) => n === SHEET_COL_PREV[i])) return SHEET_COL_DEF.slice()
  return SHEET_COL_DEF.map((def, i) => {
    const v = nums[i]
    if (!Number.isFinite(v)) return def
    return Math.max(SHEET_COL_MIN[i], Math.min(560, v))
  })
}

/** 首页顶部：填了店铺名就显示店铺名；没填或仍是默认名时用打印抬头。 */
function homeBillShopTitle(
  shopName: string | null | undefined,
  headerTitle: string | null | undefined,
  guest: boolean,
): string {
  const brand = t('brand')
  const shop = String(shopName || '').trim()
  const header = String(headerTitle || '').trim()
  const unset = !shop || shop === '图可开单打印' || shop === brand
  if (guest || unset) {
    if (header && (guest || !shop || header !== shop)) return header
    return shop || header || brand
  }
  return shop
}

const AI_PHOTO_READY_BYTES = 1024 * 1024

function aiPhotoFileSize(path: string): Promise<number> {
  return new Promise((resolve) => {
    wx.getFileSystemManager().getFileInfo({
      filePath: path,
      success: (r) => resolve(Number(r.size) || 0),
      fail: () => resolve(0),
    })
  })
}

function aiCompressOnce(src: string, quality: number, width: number): Promise<string> {
  return new Promise((resolve) => {
    if (!wx.compressImage) {
      resolve('')
      return
    }
    wx.compressImage({
      src,
      quality,
      compressedWidth: width,
      success: (r) => resolve(String(r.tempFilePath || '')),
      fail: () => resolve(''),
    })
  })
}

function imageSize(path: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    wx.getImageInfo({
      src: path,
      success: (info) =>
        resolve({ width: Number(info.width) || 0, height: Number(info.height) || 0 }),
      fail: () => resolve({ width: 0, height: 0 }),
    })
  })
}

/** 长边压到 1280，体积约 1MB 以内再上传。 */
async function compressOriginalPhoto(path: string, knownSize = 0): Promise<string> {
  let size = knownSize > 0 ? knownSize : await aiPhotoFileSize(path)
  const info = await imageSize(path)
  const longEdge = Math.max(info.width, info.height)
  const widthFor = (edge: number) => {
    if (info.width <= 0 || info.height <= 0 || info.width >= info.height) return edge
    return Math.max(1, Math.round((edge * info.width) / info.height))
  }
  if (size > 0 && size <= AI_PHOTO_READY_BYTES && (longEdge === 0 || longEdge <= 1280)) return path
  const steps: Array<[number, number]> = [
    [80, widthFor(1280)],
    [60, widthFor(1280)],
    [45, widthFor(960)],
  ]
  let current = path
  let currentSize = size
  for (const [quality, width] of steps) {
    const next = await aiCompressOnce(current, quality, width)
    if (!next || next === current) continue
    const nextSize = await aiPhotoFileSize(next)
    if (nextSize > 0 && (currentSize === 0 || nextSize < currentSize)) {
      current = next
      currentSize = nextSize
      if (nextSize <= AI_PHOTO_READY_BYTES) return current
    }
  }
  if (current === path) throw new Error('原图压缩失败，请重试')
  return current
}

function sheetColView(ws: number[], foldIndex = false) {
  const cols = foldIndex ? [0, ...ws.slice(1)] : ws
  const sum = cols.reduce((a, b) => a + b, 0)
  const sheet = Math.max(sum, 750)
  return {
    colGrid: `width:${sheet}rpx;grid-template-columns:${cols.map((w) => `${w}rpx`).join(' ')};`,
    colSheetW: `width:${sheet}rpx;min-width:${sheet}rpx;`,
    colOverflow: sum > 750,
  }
}

Page({
  data: {
    ...capsuleStyleDefaults(),
    ...i18nState(),
    guestMode: false,
    guestFeatIn: false,
    agentMode: false,
    agentDeskOpen: false,
    agentPlaza: [] as Array<PlazaShop & { logoSrc: string; shopMark: string; arrivalText: string; btnText: string }>,
    agentPlazaHasMore: false,
    agentPlazaLoading: false,
    agentHubUnpaid: '0.00',
    agentHubToday: '0.00',
    agentApplyOpen: false,
    agentApplyName: '',
    agentApplyPhone: '',
    agentApplyNote: '',
    agentApplyBusy: false,
    agentApplyShopName: '',
    agentShopName: '',
    agentCustomerName: '',
    agentUnpaid: '0.00',
    agentTodayPickup: '0.00',
    agentAccept: true,
    agentMerchantExpired: false,
    agentExpireRows: [] as Array<{ ownerUserId: number; shopName: string }>,
    agentCanSwitch: false,
    agentShopPicker: false,
    agentShopList: [] as Array<{
      ownerUserId: number
      shopName: string
      customerName: string
      current: boolean
    }>,
    showRoleSwitch: false,
    merchantInviteToken: '',
    inviteStatsHint: '',
    agentTotalCount: '0',
    agentReturnCount: '0',
    agentTotalAmount: '0.00',
    agentRefundAmount: '0.00',
    agentAvgTicket: '0.00',
    agentSince: '',
    agentChartMode: 'pickup' as 'pickup' | 'refund',
    agentChartRange: '',
    agentChartAmount: '0.00',
    agentChartQty: '0',
    agentChartCount: '0',
    agentChartHasData: false,
    agentChartBars: [] as Array<{
      d: string
      label: string
      h: number
      qtyLabel: string
      peak: boolean
      on: boolean
      zero: boolean
    }>,
    agentChartFocus: null as null | { dateLabel: string; amountLabel: string; qtyLabel: string },
    agentPickupRank: [] as Array<{
      rank: number
      code: string
      rowKey: string
      title: string
      sub: string
      qtyLabel: string
      amountLabel: string
      barPct: number
    }>,
    agentReturnRank: [] as Array<{
      rank: number
      code: string
      rowKey: string
      title: string
      sub: string
      qtyLabel: string
      amountLabel: string
      barPct: number
    }>,
    agentPendingCount: '0',
    agentInTransitCount: '0',
    agentRejectedCount: '0',
    agentNewArrivalCount: '0',
    agentShippedCount: '0',
    merchantPendingCount: 0,
    guestNick: '',
    browseOnly: false,
    guestOrderReady: false,
    /** 游客本地开单（可开单打印，仅缓存不上云） */
    guestLocal: false,
    shop: null as ShopInfo | null,
    hdrShop: '',
    hdrSubtitle: '',
    hdrShopSize: 'md' as 'sm' | 'md' | 'lg',
    hdrShopPx: 40,
    hdrShopPx: 42,
    hdrShowInvite: false,
    hdrShowArrival: false,
    hdrInviteQr: '',
    hdrInviteHint: '',
    hdrArrivalQr: '',
    hdrArrivalHint: '',
    customers: [] as Customer[],
    customerName: '',
    customerPhone: '',
    customerId: '',
    dateStr: todayStr(),
    remark: '',
    rows: [] as SheetRow[],
    totalAmountLabel: '0.00',
    totalQtyLabel: '0',
    /** 合计浮层盖在「内容后面那条空行」的下一行上，不占行号 */
    sumAfter: -1,
    optionalExpanded: false,
    moreTop: 0,
    moreLeft: 0,
    moreMaxH: 0,
    moreMaxW: 0,
    dockFolded: false,
    /** 付费云同步：拖表头竖线改变整列宽度 */
    sheetExcel: false,
    colGrid: '',
    colSheetW: '',
    colOverflow: false,
    colDrag: -1,
    indexFolded: false,
    isReturnMode: false,
    selectedIndex: -1,
    isPaid: false,
    isPickedUp: false,
    isShipped: false,
    isDelivered: false,
    deliveryPhotoPath: '',
    delivSheetVisible: false,
    returnReasonVisible: false,
    billKindVisible: false,
    returnReasonOptions: returnReasonLabels(),
    trackingNos: [] as string[],
    shippedLabel: t('shipped'),
    saving: false,
    printing: false,
    btConnected: false,
    focusNameIndex: -1,
    focusQtyIndex: -1,
    /** 只有选中货号后自动跳进数量时才为真，平时点击不走这条。 */
    qtyForceIndex: -1,
    /** 用户点数量框时全选，离开后立刻作废，避免下一次刷新把光标拉回去。 */
    qtyArmIndex: -1,
    qtySelStart: -1,
    qtySelEnd: -1,
    suggestVisible: false,
    /** 联想收起后的一小段时间挡住点击穿透，避免焦点回到品名框。 */
    suggestGuard: false,
    suggestTop: 0,
    suggestLeft: 0,
    /** 教程下沿到表头上沿，弹出层不超过这段高度 */
    suggestMaxH: 0,
    suggestMaxW: 0,
    suggestListH: 0,
    suggestPageItems: [] as SuggestItem[],
    suggestTotal: 0,
    suggestPage: 0,
    suggestPages: 1,
    suggestHighlight: 0,
    suggestKbH: 0,
    sbVisible: false,
    sbThumbH: 40,
    sbThumbTop: 0,
    // Material 中文日历（对齐 App showChineseDatePicker）
    calVisible: false,
    calTitle: t('pickOrderDate'),
    calHeaderLabel: '',
    calMonthLabel: '',
    calViewYear: 2026,
    calViewMonth: 0,
    calSelectedYmd: '',
    calPickerValue: '',
    calCells: [] as CalCell[],
    calWeekLabels: weekLabels(),
    // 选择客户弹窗（对齐 App CustomerPickerDialog）
    custPickerVisible: false,
    custKeyword: '',
    custSearching: false,
    custCanManage: true,
    custSectionTitle: t('recentCustomers'),
    custHint: t('custSearchMore'),
    custRows: [] as CustPickRow[],
    custHasMore: false,
    // 新增/编辑客户表单（对齐 App AlertDialog _editForm）
    custFormVisible: false,
    custFormTitle: t('newCustomer'),
    custFormName: '',
    custFormPhone: '',
    custFormEditId: '',
    custFormNameFocus: false,
    custFormPhoneFocus: false,
    // 客户行右侧 PopupMenu（对齐 App PopupMenuButton）
    custMenuVisible: false,
    custMenuTop: 0,
    custMenuLeft: 0,
    custMenuIndex: -1,
    custMenuIsRecent: false,
    // 顶部 Toast（对齐 App AppToast）
    topToastVisible: false,
    topToastMsg: '',
    topToastTop: 48,
    // AI 识别开单（对齐 App _AiExtractSheet）
    aiVisible: false,
    aiText: '',
    aiLoading: false,
    aiOverflow: false,
    aiThumbH: 28,
    aiThumbY: 0,
    aiScrollTop: 0,
    voiceAskVisible: false,
    voiceAskMsg: '',
    voiceAskChoices: [] as VoiceAskChoice[],
    voiceAskTop: 72,
    // 导出销售单图片（对齐 App OrderImageExportDialog）
    expVisible: false,
    expTitle: '导出销售单图片',
    expReceiptModel: {} as ReceiptRenderModel,
    expFontScale: 1,
    expIsReturn: false,
    expSaving: false,
    expCanvasH: 600,
    expShareReady: false,
    expShareToken: '',
    expShareShop: '',
    expShareOrderNo: '',
    expShareImage: '',
    // 入库/出库（对齐 App StockAdjustDialog）
    stkVisible: false,
    stkIn: true,
    stkTitle: '商品入库',
    stkKeyword: '',
    stkRows: [] as Array<{
      code: string
      name: string
      subtitle: string
      selected: boolean
    }>,
    stkSelectedCode: '',
    stkSelectedLabel: '',
    stkQty: '1',
    stkRemark: '',
    stkSubmitting: false,
    stkCanSubmit: false,
    stkColor: '',
    stkSize: '',
    stkNeedSku: false,
    stkColors: [] as string[],
    stkSizes: [] as string[],
    skuPickVisible: false,
    skuPickRow: -1,
    skuPickCode: '',
    skuPickTitle: '',
    skuPickColors: [] as string[],
    skuPickSizes: [] as string[],
    skuPickColor: '',
    skuPickSize: '',
    skuPickQty: '1',
    skuPickStockLabel: '',
    skuPickLines: [] as SkuPickLine[],
    skuPickTotal: 0,
  },

  _products: [] as Product[],
  _aiViewH: 0,
  _aiContentH: 0,
  _aiScrollH: 0,
  _aiScrollTop: 0,
  _aiDragY: 0,
  _aiDragTop: 0,
  _undoSnapshot: null as SheetRow[] | null,
  _editingOrderNo: '' as string,
  _hdrSeq: 0,
  _sheetIndexShown: null as boolean | null,
  _hdrTplAt: 0,
  _hdrTplFlight: null as Promise<unknown> | null,
  _hdrInviteFor: '',
  _hdrInviteQr: '',
  _hdrInviteToken: '',
  _hdrInviteBoundFor: '',
  _hdrInviteCheckedAt: 0,
  _hdrInviteTimer: 0 as any,
  _hdrInviteFlight: null as null | {
    custId: string
    done: Promise<{ qr: string; token: string; bound: boolean }>
  },
  _editingCreatedAt: '' as string,
  _loadedCustomerKey: '' as string,
  _returnReason: '' as string,
  _remarkBeforeReturn: '' as string,
  _calPickResolve: null as null | ((ymd: string | null) => void),
  _reasonPickResolve: null as null | ((reason: string | null) => void),
  _suggestAll: [] as SuggestItem[],
  _suggestRowIndex: -1,
  _suggestTimer: 0 as any,
  _suggestGuardTimer: 0 as any,
  _pickingSuggest: false,
  _lastSuggestQuery: '',
  /** 选中货号后短时间内忽略品名框的 focus/input，避免苹果把联想再弹出来。 */
  _nameLockUntil: 0,
  _pendingQtyIndex: -1,
  _pendingQtyLen: 0,
  _qtyRearmTimer: 0 as any,
  _qtyRearmCount: 0,
  _appending: false,
  _scrollCheckAt: 0,
  _viewportH: 0,
  _scrollTop: 0,
  _scrollHeight: 0,
  _onKbHeight: null as ((res: { height: number }) => void) | null,
  /** 数字键盘收起的时间。P60 会在收起后再补一帧旧高度，这段时间内丢掉页面级的正高度。 */
  _kbClosedAt: 0,
  /** 按住说话时先收键盘，右下角按钮先别跟着落，否则手指会丢。 */
  _voiceHoldKbLock: false,
  _digitLeaveTimer: 0 as any,
  _custEnsureResolve: null as ((ok: boolean) => void) | null,
  _billKindResolve: null as ((kind: 'sale' | 'return' | null) => void) | null,
  _topToastTimer: 0 as any,
  _voiceAsk: null as VoiceAskState | null,
  _missingCustAt: 0,
  _askedProduct: '',
  _addAskKind: '' as '' | 'customer' | 'product',
  _nextProductCode: '',
  _afterCustomerAdd: '' as '' | 'prices',
  _custAllRows: [] as CustPickRow[],
  _custShowCount: 20,

  _inviteBusy: false,
  _inviteDone: '',
  _guestFeatPlayed: false,
  _pageHasInvite: false,
  _wantAgentHome: false,
  _colW: null as number[] | null,
  _colDrag: null as { i: number; x: number; w: number; scale: number } | null,

  onLoad(query: Record<string, string | undefined>) {
    // 打印/语音跟键盘上浮。文字键盘收起会回 0；P60 的数字键盘点折叠经常不回 0，或回 0 后再推一帧旧高度。
    this._onKbHeight = (res) => {
      this.applySuggestKb(Number(res.height) || 0, 'page')
    }
    wx.onKeyboardHeightChange(this._onKbHeight)
    const ws = String(query?.ws || '').trim()
    if (ws === 'merchant' || ws === 'agent') {
      setWorkspacePreference(ws)
    }
    this._wantAgentHome = ws === 'agent'
    this._pageHasInvite = shouldConsumeLaunchInvites(query)
    captureLaunchInvites(query)
    if (ws !== 'merchant' && this._pageHasInvite) {
      this.consumePendingInvites()
    }
  },

  consumePendingInvites() {
    if (!this._pageHasInvite) return
    const merchant = takePendingMerchantInvite()
    if (merchant) {
      wx.reLaunch({
        url: `/pages/login/login?stay=1&invite=${encodeURIComponent(merchant)}`,
      })
      return
    }
    const stall = takePendingStallInvite()
    const staff = takePendingStaffInvite()
    if (!stall && !staff) return
    // 商家开单台不是代理绑定入口，打开首页绝不能弹「无法绑定」
    if (isMerchantSession() && !isAgentWorkspace()) return
    if (!isAgentWorkspace()) {
      const q = [
        stall ? `invite=${encodeURIComponent(stall)}` : '',
        staff ? `staffInvite=${encodeURIComponent(staff)}` : '',
      ]
        .filter(Boolean)
        .join('&')
      wx.reLaunch({ url: `/pages/login/login?mode=agent&stay=1${q ? `&${q}` : ''}` })
      return
    }
    if (stall) void this.consumeInvite(stall)
    if (staff) void this.consumeStaffInvite(staff)
  },

  enterAgentHome() {
    this.setData({ agentMode: true, guestMode: false, guestLocal: false })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ list: getTabItems(), theme: tabBarTheme() })
    }
    void this.loadAgentHome()
  },

  async consumeInvite(token: string) {
    const invite = String(token || '').trim()
    if (!invite || this._inviteBusy || this._inviteDone === invite) return
    this._inviteBusy = true
    try {
      const r = await consumeStallInvite(invite)
      if (!r.bound) {
        void this.probeAgentBind({ forceAgent: true })
        return
      }
      this._inviteDone = invite
      this.enterAgentHome()
    } catch (_) {
      void this.probeAgentBind({ forceAgent: true })
    } finally {
      this._inviteBusy = false
    }
  },

  async consumeStaffInvite(token: string) {
    const invite = String(token || '').trim()
    if (!invite || this._inviteBusy || this._inviteDone === invite) return
    this._inviteBusy = true
    try {
      const r = await consumeStaffInvite(invite)
      if (!r.bound) {
        void this.probeAgentBind({ forceAgent: true })
        return
      }
      this._inviteDone = invite
      if (!r.skipped) wx.showToast({ title: '已加入', icon: 'none' })
      this.enterAgentHome()
    } catch (_) {
      void this.probeAgentBind({ forceAgent: true })
    } finally {
      this._inviteBusy = false
    }
  },

  onReady() {
    applyCapsuleStyle(this)
  },

  onUnload() {
    this.stopInviteWatch()
    this.cancelDigitLeave()
    if (this._suggestGuardTimer) clearTimeout(this._suggestGuardTimer)
    if (this._qtyRearmTimer) clearTimeout(this._qtyRearmTimer)
    this.setTabBarHidden(false)
    if (this._onKbHeight) {
      try {
        wx.offKeyboardHeightChange(this._onKbHeight)
      } catch (e) {
        /* ignore */
      }
      this._onKbHeight = null
    }
  },

  onHide() {
    this.stopInviteWatch()
    // 离开页面时恢复底栏，避免其它 tab 被隐藏
    if (this.data.aiVisible || this.data.delivSheetVisible || this.data.agentShopPicker) {
      this.setTabBarHidden(false)
    }
    this.closeVoiceAsk()
    clearVoiceSlot()
  },

  applyLocale() {
    const nos = this.data.trackingNos || []
    this.setData({
      ...i18nState(),
      shippedLabel: nos.length ? `${t('shipped')}(${nos.length})` : t('shipped'),
      calTitle: this.data.isReturnMode ? t('pickReturnDate') : t('pickOrderDate'),
      calWeekLabels: weekLabels(),
      returnReasonOptions: returnReasonLabels(),
    })
    if (this.data.custPickerVisible) this.refreshCustomerPicker()
  },

  syncSheetExcel() {
    const on = isCloudSyncAllowed()
    const patch: Record<string, unknown> = {}
    if (on !== this.data.sheetExcel) patch.sheetExcel = on
    if (on) {
      if (!this._colW) {
        let raw: unknown = null
        try {
          raw = wx.getStorageSync(SHEET_COL_KEY)
        } catch (_) {}
        this._colW = clampSheetCols(raw)
      }
      if (!this.data.colGrid) Object.assign(patch, sheetColView(this._colW, !!this.data.indexFolded))
    } else if (this.data.colGrid) {
      patch.colGrid = ''
      patch.colSheetW = ''
      patch.colOverflow = false
      patch.colDrag = -1
    }
    if (Object.keys(patch).length) this.setData(patch)
  },

  onColResizeStart(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.sheetExcel) return
    const i = Number(e.currentTarget.dataset.i)
    const t = e.touches && e.touches[0]
    if (!t || !(i >= 0 && i < SHEET_COL_DEF.length)) return
    const ws = this._colW || SHEET_COL_DEF.slice()
    let scale = 1
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
      scale = (info.windowWidth || 375) / 750
    } catch (_) {}
    this._colDrag = { i, x: t.clientX, w: ws[i], scale: scale || 1 }
    this.setData({ colDrag: i })
  },

  onColResizeMove(e: WechatMiniprogram.TouchEvent) {
    const drag = this._colDrag
    if (!drag) return
    const t = e.touches && e.touches[0]
    if (!t) return
    const dx = (t.clientX - drag.x) / (drag.scale || 1)
    const next = Math.max(SHEET_COL_MIN[drag.i], Math.min(560, Math.round(drag.w + dx)))
    const ws = (this._colW || SHEET_COL_DEF.slice()).slice()
    if (ws[drag.i] === next) return
    ws[drag.i] = next
    this._colW = ws
    this.setData(sheetColView(ws, !!this.data.indexFolded))
  },

  onToggleIndexCol() {
    const indexFolded = !this.data.indexFolded
    const patch: Record<string, unknown> = { indexFolded }
    if (this.data.sheetExcel && this._colW) Object.assign(patch, sheetColView(this._colW, indexFolded))
    this.setData(patch)
  },

  onColResizeEnd() {
    if (!this._colDrag) return
    this._colDrag = null
    if (this._colW) {
      try {
        wx.setStorageSync(SHEET_COL_KEY, this._colW)
      } catch (_) {}
    }
    if (this.data.colDrag !== -1) this.setData({ colDrag: -1 })
  },

  applySheetChrome() {
    const tpl = loadPrintTemplate()
    const shown = tpl.showSheetIndex !== false
    const size = tpl.headerTextSize === 'sm' || tpl.headerTextSize === 'lg' ? tpl.headerTextSize : 'md'
    const px = headerTextSizePx(size)
    const patch: Record<string, unknown> = {}
    if (this.data.hdrShopSize !== size) patch.hdrShopSize = size
    if (this.data.hdrShopPx !== px) patch.hdrShopPx = px
    if (this._sheetIndexShown !== shown) {
      this._sheetIndexShown = shown
      const indexFolded = !shown
      patch.indexFolded = indexFolded
      if (this.data.sheetExcel && this._colW) Object.assign(patch, sheetColView(this._colW, indexFolded))
    }
    if (Object.keys(patch).length) this.setData(patch)
  },

  onShow() {
    this.applyLocale()
    this.applySheetChrome()
    this.syncSheetExcel()
    if (isLoggedIn() && !isGuest()) {
      void refreshEntitlement({ force: false })
        .then(() => {
          this.syncSheetExcel()
        })
        .finally(() => {
          void this.refreshBillHead()
        })
    }
    try {
      wx.showShareMenu({ withShareTicket: false, menus: ['shareAppMessage', 'shareTimeline'] })
    } catch (_) {}
    const paintTab = () => {
      const bar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
      if (!bar) return
      bar.setData({
        selected: tabIndexFor('home'),
        hidden: false,
        list: getTabItems(),
        theme: tabBarTheme(),
      })
    }
    if (typeof wx.nextTick === 'function') wx.nextTick(paintTab)
    else setTimeout(paintTab, 0)
    if (this._pageHasInvite) this.consumePendingInvites()
    if (this._inviteBusy) return
    // 未登录直接进游客开单表，打印和语音都在这一页
    if (!isLoggedIn() && !isGuest()) {
      try {
        enterBrowseOnlyGuest()
      } catch (_) {}
    }
    if (!canBrowseApp()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    if (isAgentWorkspace()) {
      this.setData({ agentMode: true, guestMode: false, guestLocal: false })
      void this.loadAgentHome()
      return
    }
    if (isGuest() || !isLoggedIn()) {
      if (!getGuestSession()?.orderReady) {
        try {
          markGuestOrderReady()
        } catch (e) {
          console.warn('[guest] markGuestOrderReady', e)
        }
      }
      this.enterGuestBilling()
      void this.probeAgentBind()
      return
    }
    this.setData({
      agentMode: false,
      guestMode: false,
      guestLocal: false,
      browseOnly: false,
      guestOrderReady: false,
    })
    if (!this.data.rows.length) this.resetRows()
    this.consumePendingSheet()
    this.consumeAgentStock()
    void this.loadMeta()
    setTimeout(() => this.ensureMinRowsForViewport(), 50)
    setTimeout(() => {
      void this.refreshBtForPrint()
    }, 800)
    void (async () => {
      try {
        await verifyOrKick()
      } catch (_) {}
    })()
  },

  _agentBindings: [] as AgentBinding[],
  _plazaPage: 1,
  _applyOwnerId: 0,
  _agentTrend: [] as AgentTrendDay[],
  _agentChartDay: '',

  async probeAgentBind(opts?: { forceAgent?: boolean }) {
    let me: Awaited<ReturnType<typeof fetchAgentMe>>
    try {
      me = await fetchAgentMe()
    } catch (_) {
      this.setData({ showRoleSwitch: canSwitchWorkspace() })
      return
    }
    if (!(me.ok && me.data?.bound)) {
      this.setData({ showRoleSwitch: canSwitchWorkspace() })
      return
    }
    if (!opts?.forceAgent && getWorkspacePreference() === 'merchant' && isMerchantSession()) {
      this.setData({ showRoleSwitch: canSwitchWorkspace() })
      return
    }
    setWorkspacePreference('agent')
    this.setData({ agentMode: true, guestMode: false, showRoleSwitch: canSwitchWorkspace() })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ list: getTabItems(), theme: tabBarTheme() })
    }
    void this.loadAgentHome()
  },

  agentFlagLabel(o: LookupOrder) {
    if (agentOrderKind(o.remark) === 'pending') return t('agentPendingStat')
    const bits: string[] = []
    bits.push(o.isPaid ? t('tagPaid') : t('tagUnpaid'))
    if (o.isShipped) bits.push(t('tagShipped'))
    if (o.isDelivered) bits.push(t('tagDelivered'))
    return bits.join(' · ')
  },

  plazaBtnText(status: string) {
    if (status === 'joined') return t('plazaEnter')
    if (status === 'pending') return t('plazaPending')
    return t('plazaApply')
  },

  mapPlaza(shops: PlazaShop[]) {
    return shops.map((s) => ({
      ...s,
      logoSrc: plazaLogoSrc(s),
      shopMark: String(s.shopName || '档').slice(0, 1),
      arrivalText: t('newArrivalCount').replace('{n}', String(s.newArrivalCount || 0)),
      btnText: this.plazaBtnText(String(s.applyStatus || '')),
    }))
  },

  async loadAgentHub() {
    this.setData({
      agentMode: true,
      guestMode: false,
      agentDeskOpen: false,
      agentPlazaLoading: true,
      showRoleSwitch: canSwitchWorkspace(),
    })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ list: getTabItems(), theme: tabBarTheme() })
    }
    const me = await fetchAgentMe(undefined, { home: true })
    const hubBound = !!(me.ok && me.data?.bound)
    this._agentBindings = hubBound ? me.data?.bindings || [] : []
    let hubUnpaid = 0
    for (const b of this._agentBindings) hubUnpaid += Number(b.unpaidAmount || 0)
    const plaza = await fetchAgentPlaza({ page: 1 })
    this._plazaPage = 1
    this.setData({
      agentPlazaLoading: false,
      agentShopList: this.agentShopPickerRows(),
      agentHubUnpaid: money2(hubUnpaid),
      agentHubToday: '0.00',
      agentPlaza: plaza.ok ? this.mapPlaza(plaza.shops) : [],
      agentPlazaHasMore: !!(plaza.ok && plaza.hasMore),
      agentCustomerName: String(this._agentBindings[0]?.customerName || '').trim(),
    })
    if (hubBound && me.data?.current?.ownerUserId) {
      const todayKey = ymdOf(new Date())
      const todayRow = (me.data.stats?.trend || []).find((d) => String(d.date || '').slice(0, 10) === todayKey)
      this.setData({ agentHubToday: money2(Number(todayRow?.pickupAmount || 0)) })
    }
    if (hubBound) void this.ensureMerchantInviteToken()
  },

  async onPlazaMore() {
    if (!this.data.agentPlazaHasMore || this.data.agentPlazaLoading) return
    const next = (this._plazaPage || 1) + 1
    this.setData({ agentPlazaLoading: true })
    const plaza = await fetchAgentPlaza({ page: next })
    this._plazaPage = next
    this.setData({
      agentPlazaLoading: false,
      agentPlaza: plaza.ok ? this.data.agentPlaza.concat(this.mapPlaza(plaza.shops)) : this.data.agentPlaza,
      agentPlazaHasMore: !!(plaza.ok && plaza.hasMore),
    })
  },

  onAgentEnterShop(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id || 0)
    const status = String(e.currentTarget.dataset.status || '')
    const name = String(e.currentTarget.dataset.name || '')
    if (!id) return
    if (status === 'joined' || status === '') {
      if (status === 'joined') {
        saveAgentOwnerId(id)
        this.setData({ agentDeskOpen: true })
        void this.loadAgentHome()
        return
      }
    }
    if (status === 'pending') {
      wx.showToast({ title: t('plazaPending'), icon: 'none' })
      return
    }
    this._applyOwnerId = id
    this.setData({
      agentApplyOpen: true,
      agentApplyShopName: name,
      agentApplyName: this.data.agentApplyName || '',
      agentApplyPhone: this.data.agentApplyPhone || '',
      agentApplyNote: '',
    })
  },

  onCloseApply() {
    this.setData({ agentApplyOpen: false })
  },

  onApplyName(e: WechatMiniprogram.Input) {
    this.setData({ agentApplyName: e.detail.value })
  },

  onApplyPhone(e: WechatMiniprogram.Input) {
    this.setData({ agentApplyPhone: e.detail.value })
  },

  onApplyNote(e: WechatMiniprogram.Input) {
    this.setData({ agentApplyNote: e.detail.value })
  },

  async onSubmitApply() {
    if (this.data.agentApplyBusy) return
    const name = String(this.data.agentApplyName || '').trim()
    if (!name) {
      wx.showToast({ title: t('plazaNamePh'), icon: 'none' })
      return
    }
    const ownerId = this._applyOwnerId
    if (!ownerId) return
    this.setData({ agentApplyBusy: true })
    await requestAgentApplyResultSubscribe()
    const r = await applyAgentShop({
      ownerUserId: ownerId,
      displayName: name,
      phone: String(this.data.agentApplyPhone || '').trim(),
      note: String(this.data.agentApplyNote || '').trim(),
    })
    this.setData({ agentApplyBusy: false, agentApplyOpen: false })
    wx.showToast({ title: (r.message || r.error || t('plazaSubmit')).slice(0, 20), icon: 'none' })
    void this.loadAgentHub()
  },

  onAgentBackPlaza() {
    this.setData({ agentDeskOpen: false })
    void this.loadAgentHub()
  },

  async loadAgentHome() {
    let me: Awaited<ReturnType<typeof fetchAgentMe>>
    try {
      me = await fetchAgentMe(peekAgentOwnerId() || undefined, { home: true })
    } catch (_) {
      me = { ok: false, error: '微信登录暂不可用', data: null }
    }
    if (me.ok && me.data && !me.data.profile?.complete) {
      openAgentProfileGate()
      return
    }
    const cur = me.ok ? me.data?.current : undefined
    const peek = peekAgentOwnerId()
    const deskBound = !!(me.ok && me.data?.bound)
    this._agentBindings = me.ok ? me.data?.bindings || [] : []
    const st = me.ok ? me.data?.stats || {} : {}
    this._agentTrend = st.trend || []
    this._agentChartDay = ''
    const todayKey = ymdOf(new Date())
    const todayRow = this._agentTrend.find((d) => String(d.date || '').slice(0, 10) === todayKey)
    this.setData({
      agentMode: true,
      guestMode: false,
      agentDeskOpen: true,
      agentShopName: peek ? cur?.shopName || t('stallName') : t('allShops'),
      agentCustomerName: cur?.customerName || me.data?.profile?.displayName || '',
      agentTodayPickup: money2(Number(todayRow?.pickupAmount || 0)),
      agentUnpaid: money2(Number(st.unpaidAmount ?? cur?.unpaidAmount ?? 0)),
      agentAccept: me.ok ? !!(me.data?.acceptAgentOrders || cur?.acceptAgentOrders) : true,
      ...this.agentExpireState(cur),
      agentCanSwitch: this._agentBindings.length > 0,
      agentShopList: this.agentShopPickerRows(),
      showRoleSwitch: canSwitchWorkspace(),
      agentTotalCount: String(st.totalCount || 0),
      agentReturnCount: String(st.returnCount || 0),
      agentTotalAmount: money2(Number(st.totalAmount || 0)),
      agentRefundAmount: money2(Number(st.refundAmount || 0)),
      agentAvgTicket: money2(Number(st.avgTicket || 0)),
      agentSince: String(st.since || ''),
      agentShippedCount: String(st.shippedCount || 0),
      agentPendingCount: String(me.data?.inbox?.pending || 0),
      agentInTransitCount: String(me.data?.inbox?.inTransit || 0),
      agentRejectedCount: String(me.data?.inbox?.rejected || 0),
      agentNewArrivalCount: String(me.data?.inbox?.newArrivalCount || 0),
      agentPickupRank: mapAgentRank(st.pickupRank, peek ? cur?.shopName || '' : ''),
      agentReturnRank: mapAgentRank(st.returnRank, peek ? cur?.shopName || '' : ''),
    })
    void requestNewArrivalSubscribe()
    this.applyAgentChart(this.data.agentChartMode || 'pickup')
    if (deskBound) void this.ensureMerchantInviteToken()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ list: getTabItems(), theme: tabBarTheme() })
    }
  },

  applyAgentChart(mode: 'pickup' | 'refund') {
    const trend = this._agentTrend || []
    const first = trend[0]?.date || ''
    const last = trend.length ? trend[trend.length - 1]?.date || '' : ''
    const range = first && last ? `${mdLabel(first)} – ${mdLabel(last)}` : ''
    let maxAmt = 0
    let sumAmt = 0
    let sumQty = 0
    let sumCount = 0
    let peakDay = ''
    const vals = trend.map((d) => {
      const amount = mode === 'refund' ? Number(d.refundAmount || 0) : Number(d.pickupAmount || 0)
      const qty = mode === 'refund' ? Number(d.refundQty || 0) : Number(d.pickupQty || 0)
      const count = mode === 'refund' ? Number(d.refundCount || 0) : Number(d.pickupCount || 0)
      sumAmt += amount
      sumQty += qty
      sumCount += count
      if (amount > maxAmt) {
        maxAmt = amount
        peakDay = String(d.date || '')
      }
      return { d, amount, qty, count }
    })
    if (!peakDay) {
      for (let i = vals.length - 1; i >= 0; i--) {
        if (vals[i].qty > 0 || vals[i].amount > 0) {
          peakDay = String(vals[i].d.date || '')
          break
        }
      }
    }
    const focusDay = this._agentChartDay && vals.some((v) => v.d.date === this._agentChartDay)
      ? this._agentChartDay
      : peakDay || String(vals[vals.length - 1]?.d.date || '')
    this._agentChartDay = focusDay
    const bars = vals.map((v) => {
      const ymd = String(v.d.date || '')
      const h = v.amount > 0 && maxAmt > 0 ? Math.max(8, Math.round((v.amount / maxAmt) * 100)) : v.qty > 0 ? 8 : 0
      return {
        d: ymd,
        label: dayNum(ymd),
        h,
        qtyLabel: v.qty > 0 ? String(v.qty) : '',
        peak: ymd === peakDay && maxAmt > 0,
        on: ymd === focusDay,
        zero: h <= 0,
      }
    })
    const focus = vals.find((v) => String(v.d.date || '') === focusDay)
    this.setData({
      agentChartMode: mode,
      agentChartRange: range,
      agentChartAmount: money2(sumAmt),
      agentChartQty: String(sumQty),
      agentChartCount: String(sumCount),
      agentChartHasData: sumAmt > 0 || sumQty > 0 || sumCount > 0,
      agentChartBars: bars,
      agentChartFocus: focus
        ? {
            dateLabel: mdLabel(String(focus.d.date || '')),
            amountLabel: money2(focus.amount),
            qtyLabel: String(focus.qty),
          }
        : null,
    })
  },

  onAgentChartMode(e: WechatMiniprogram.TouchEvent) {
    const mode = String(e.currentTarget.dataset.mode || 'pickup') === 'refund' ? 'refund' : 'pickup'
    this._agentChartDay = ''
    this.applyAgentChart(mode)
  },

  onAgentChartBar(e: WechatMiniprogram.TouchEvent) {
    const d = String(e.currentTarget.dataset.d || '')
    if (!d) return
    this._agentChartDay = d
    this.applyAgentChart(this.data.agentChartMode || 'pickup')
  },

  onAgentGoBills() {
    void requestBillSubscribe()
    wx.navigateTo({ url: '/pages/agent-bills/agent-bills' })
  },

  onAgentGoNew() {
    try {
      wx.setStorageSync('tuk_agent_catalog_tab', 'new')
    } catch (_) {}
    wx.switchTab({ url: '/pages/products/products' })
  },

  onAgentGoPending() {
    try {
      wx.setStorageSync('tuk_agent_order_filter', 'pending')
    } catch (_) {}
    wx.switchTab({ url: '/pages/orders/orders' })
  },

  onAgentGoTransit() {
    try {
      wx.setStorageSync('tuk_agent_order_filter', 'shipped')
    } catch (_) {}
    wx.switchTab({ url: '/pages/orders/orders' })
  },

  onAgentGoRejected() {
    try {
      wx.setStorageSync('tuk_agent_order_filter', 'rejected')
    } catch (_) {}
    wx.switchTab({ url: '/pages/orders/orders' })
  },

  onOpenFolders() {
    wx.navigateTo({ url: '/pages/agent-folders/agent-folders' })
  },

  onGoMerchantPending() {
    try {
      wx.setStorageSync('tuk_merchant_order_filter', 'agentPending')
    } catch (_) {}
    wx.switchTab({ url: '/pages/orders/orders' })
  },

  onSwitchWorkspace() {
    applyWorkspaceAndRelaunch('merchant')
  },

  onAgentExit() {
    wx.showModal({
      title: t('logoutAgent'),
      content: t('logoutAskAgent'),
      confirmText: t('exit'),
      cancelText: t('cancel'),
      confirmColor: '#e53935',
      success: (res) => {
        if (!res.confirm) return
        exitAgentToLogin()
      },
    })
  },

  agentExpireState(cur?: AgentBinding) {
    const peek = peekAgentOwnerId()
    const expired = (this._agentBindings || []).filter((b) => !!b.merchantExpired)
    const rows = (peek
      ? expired.filter((b) => Number(b.ownerUserId) === Number(peek))
      : expired
    ).map((b) => ({
      ownerUserId: Number(b.ownerUserId || 0),
      shopName: String(b.shopName || t('stallName')).trim() || t('stallName'),
    }))
    const currentExpired = !!(peek && (cur?.merchantExpired || rows.length))
    const allBlocked =
      !peek && (this._agentBindings || []).length > 0 && expired.length === this._agentBindings.length
    return {
      agentExpireRows: rows,
      agentMerchantExpired: currentExpired || allBlocked,
    }
  },

  agentShopPickerRows() {
    const curId = peekAgentOwnerId()
    const all = {
      ownerUserId: 0,
      shopName: t('allShops'),
      customerName: '',
      merchantExpired: false,
      current: !curId,
    }
    return [all].concat(
      (this._agentBindings || []).map((b) => ({
        ownerUserId: b.ownerUserId,
        shopName: String(b.shopName || t('stallName')).trim() || t('stallName'),
        customerName: b.merchantExpired
          ? t('merchantExpiredTitle')
          : String(b.customerName || '').trim(),
        merchantExpired: !!b.merchantExpired,
        current: !!curId && Number(b.ownerUserId) === Number(curId),
      })),
    )
  },

  preventMove() {},

  onAgentSwitchShop() {
    this.closeInputKeyboard()
    this.setTabBarHidden(true)
    this.setData({
      agentShopPicker: true,
      agentShopList: this.agentShopPickerRows(),
    })
  },

  onCloseAgentShopPicker() {
    this.setData({ agentShopPicker: false })
    this.setTabBarHidden(false)
  },

  onPickAgentShop(e: WechatMiniprogram.TouchEvent) {
    const id = Number(e.currentTarget.dataset.id || 0)
    const same = Number(peekAgentOwnerId()) === id
    this.setData({ agentShopPicker: false })
    this.setTabBarHidden(false)
    if (same) return
    saveAgentOwnerId(id)
    this.setData({ agentDeskOpen: true })
    const pick = (this._agentBindings || []).find((b) => Number(b.ownerUserId) === id)
    wx.showToast({
      title: `${t('switchedTo')} ${id ? pick?.shopName || pick?.customerName || t('stallName') : t('allShops')}`,
      icon: 'none',
    })
    void this.loadAgentHome()
  },

  onOpenPlaza() {
    this.setData({ agentShopPicker: false })
    this.setTabBarHidden(false)
    wx.navigateTo({ url: '/pages/agent-plaza/agent-plaza' })
  },

  onAgentOpenOrder(e: WechatMiniprogram.TouchEvent) {
    const token = String(e.currentTarget.dataset.token || '')
    if (!token) return
    wx.navigateTo({
      url: `/pages/order-lookup/order-lookup?token=${encodeURIComponent(token)}`,
    })
  },

  /** 登录后拉一次云端抬头，避免首页还用本机默认「图可开单打印」。 */
  ensureHomeHeaderTemplate() {
    if (isGuest() || !isLoggedIn() || !isCloudSyncAllowed()) return Promise.resolve()
    if (this._hdrTplFlight) return this._hdrTplFlight
    if (Date.now() - (this._hdrTplAt || 0) < 20000) return Promise.resolve()
    this._hdrTplFlight = pullPrintTemplateFromCloud()
      .catch(() => undefined)
      .finally(() => {
        this._hdrTplAt = Date.now()
        this._hdrTplFlight = null
      })
    return this._hdrTplFlight
  },

  /** 票头：店名、副标题。左侧邀请代理。右侧付费用户是查看新款，游客是 APP 下载。 */
  async refreshBillHead() {
    const seq = ++this._hdrSeq
    try {
      await this.ensureHomeHeaderTemplate()
    } catch (_) {}
    if (seq !== this._hdrSeq) return
    const shop = this.data.shop
    const tpl = loadPrintTemplate()
    const guest = isGuest() || !isLoggedIn()
    const isReturn = !!this.data.isReturnMode
    const shopName =
      !guest && tpl.showHomeShopName === false
        ? ''
        : homeBillShopTitle(shop?.shopName, tpl.headerTitle, guest)
    const subtitle = guest ? '' : resolveShopSubtitle(shop, tpl)
    const paid = isCloudSyncAllowed()
    const showHomeQr = tpl.showHomeQr === true
    const showInvite =
      showHomeQr && paid && !isReturn && isLoggedIn() && !isGuest() && (isOwner() || isJoinedEmployee())
    const showGuestApp = showHomeQr && guest && !isReturn
    const showArrival = showHomeQr && paid && !isReturn && isLoggedIn() && !isGuest()
    let arrivalQr = ''
    let arrivalHint = ''
    if (showGuestApp) {
      arrivalHint = t('guestQrApp')
      try {
        arrivalQr = await ensureArrivalQrImage('https://imageok.cn/downloads/tukorder.apk')
        if (seq !== this._hdrSeq) return
      } catch (_) {}
    } else if (showArrival) {
      try {
        const fresh = await resolveNewArrivalQrWithImage({ ...tpl, printNewArrivalQr: true })
        if (seq !== this._hdrSeq) return
        arrivalQr = fresh.qrPath || ''
        arrivalHint = fresh.hint || '查看新款'
      } catch (_) {}
    }
    let inviteQr = ''
    let guestSiteHint = ''
    const guestOfficial = showHomeQr && guest && !isReturn
    if (guestOfficial) {
      try {
        inviteQr = await ensureArrivalQrImage('https://imageok.cn')
        if (seq !== this._hdrSeq) return
        guestSiteHint = t('guestQrSite')
      } catch (_) {}
    }
    if (showInvite) {
      const session = getSession()
      const merchantId = Number(session?.team?.ownerUserId || 0)
      const ownerId = merchantId > 0 ? merchantId : Number(session?.userId || 0)
      if (ownerId > 0) {
        try {
          inviteQr = await ensureAgentInviteQr(ownerId)
          if (seq !== this._hdrSeq) return
        } catch (_) {}
      }
    }
    if (seq !== this._hdrSeq) return
    this.setData({
      hdrShop: shopName,
      hdrSubtitle: subtitle,
      hdrShopSize: tpl.headerTextSize === 'sm' || tpl.headerTextSize === 'lg' ? tpl.headerTextSize : 'md',
      hdrShopPx: headerTextSizePx(tpl.headerTextSize),
      hdrShowInvite: guestOfficial || showInvite,
      hdrShowArrival: showGuestApp || showArrival,
      hdrInviteQr: guestOfficial || showInvite ? inviteQr : '',
      hdrInviteHint: guestOfficial ? guestSiteHint : showInvite ? t('inviteAgent') : '',
      hdrArrivalQr: showGuestApp || showArrival ? arrivalQr : '',
      hdrArrivalHint: showGuestApp || showArrival ? arrivalHint : '',
    })
    this.stopInviteWatch()
  },

  stopInviteWatch() {
    if (!this._hdrInviteTimer) return
    clearTimeout(this._hdrInviteTimer)
    this._hdrInviteTimer = 0
  },

  onPreviewHdrQr(e: WechatMiniprogram.TouchEvent) {
    const src = String(e.currentTarget.dataset.src || '').trim()
    if (!src) return
    wx.previewImage({ urls: [src], current: src })
  },

  /** 游客只用本地缓存，不请求云端（避免 401） */
  loadMetaLocal() {
    const cachedCat = peekCachedCatalog()
    const cachedCust = peekCachedCustomers()
    const cachedShop = peekCachedShop()
    if (cachedCat.length) this._products = cachedCat
    this.setData({
      customers: cachedCust.length ? cachedCust : this.data.customers,
      shop: cachedShop || this.data.shop,
    })
    void this.refreshBillHead()
  },

  enterGuestBilling() {
    this.setData({
      agentMode: false,
      guestMode: false,
      guestLocal: true,
      guestOrderReady: true,
    })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ list: getTabItems(), theme: tabBarTheme() })
    }
    if (!this.data.rows.length) {
      this.resetRows()
    }
    this.loadMetaLocal()
    void this.refreshBtForPrint()
    setTimeout(() => this.ensureMinRowsForViewport(), 50)
  },

  /** 介绍页「开始/继续开单」 */
  onGuestStartOrder() {
    if (!getGuestSession()?.orderReady) {
      try {
        markGuestOrderReady()
      } catch (e) {
        console.warn('[guest] markGuestOrderReady', e)
      }
    }
    this.enterGuestBilling()
  },

  onGuestBind() {
    requireCloudAccount('sync')
  },

  onGoAgentEntry() {
    if (peekAgentBoundFlag()) {
      applyWorkspaceAndRelaunch('agent')
      return
    }
    wx.reLaunch({ url: '/pages/login/login?mode=agent&stay=1' })
  },

  onGuestLogin() {
    wx.reLaunch({ url: '/pages/login/login' })
  },

  async refreshBtForPrint() {
    try {
      const st = await refreshBleStatus({ tryReconnect: true })
      this.setData({ btConnected: st.connected })
    } catch (_) {
      this.setData({ btConnected: false })
    }
  },

  /** 至少铺满表格可视高度 + 1 行，才能触发无限滚动 */
  ensureMinRowsForViewport() {
    wx.createSelectorQuery()
      .in(this as any)
      .select('.table-body')
      .boundingClientRect((rect) => {
        if (!rect || !rect.height) return
        this._viewportH = rect.height
        const minRows = Math.ceil(rect.height / ROW_HEIGHT_PX) + 1
        this.ensureMinRows(minRows)
        // 铺满后刷新自定义滚动条
        const sh = Math.max(rect.height, minRows * ROW_HEIGHT_PX)
        this.updateScrollbar(this._scrollTop || 0, sh, rect.height)
      })
      .exec()
  },

  ensureMinRows(min: number) {
    const need = Math.min(Math.max(min, DEFAULT_ROWS), MAX_ROWS)
    const cur = this.data.rows.length
    if (cur >= need) return
    const add = need - cur
    const rows = this.data.rows.concat(
      Array.from({ length: add }, (_, i) => emptyRow(cur + i)),
    )
    this.setData({ rows })
  },

  /** 滚动到底附近：追加一批空行（像 Excel 无限表格） */
  appendRows(count = APPEND_BATCH) {
    if (this._appending) return
    const cur = this.data.rows.length
    if (cur >= MAX_ROWS) {
      wx.showToast({ title: '已达最大行数', icon: 'none' })
      return
    }
    this._appending = true
    const n = Math.min(count, MAX_ROWS - cur)
    const rows = this.data.rows.concat(
      Array.from({ length: n }, (_, i) => emptyRow(cur + i)),
    )
    this.setData({ rows }, () => {
      this._appending = false
    })
  },

  onScrollLower() {
    this.appendRows(APPEND_BATCH)
  },

  /** 对齐 App Material 滚动条：细灰圆角拇指 */
  updateScrollbar(scrollTop: number, scrollHeight: number, viewportH: number) {
    this._scrollTop = scrollTop
    this._scrollHeight = scrollHeight
    if (viewportH > 0) this._viewportH = viewportH
    const vh = this._viewportH
    const sh = scrollHeight
    if (vh <= 0 || sh <= vh + 1) {
      if (this.data.sbVisible) this.setData({ sbVisible: false })
      return
    }
    const trackPad = 8 // 上下各 4px
    const trackH = Math.max(0, vh - trackPad)
    const minThumb = 28
    const thumbH = Math.max(minThumb, Math.round((vh / sh) * trackH))
    const maxTop = Math.max(0, trackH - thumbH)
    const maxScroll = Math.max(1, sh - vh)
    const thumbTop = Math.round((scrollTop / maxScroll) * maxTop)
    this.setData({
      sbVisible: true,
      sbThumbH: thumbH,
      sbThumbTop: thumbTop,
    })
  },

  onTableScroll(e: WechatMiniprogram.ScrollViewScroll) {
    this.closeSuggest()
    const detail = e.detail as { scrollTop?: number; scrollHeight?: number }
    const top = Number(detail.scrollTop || 0)
    const sh = Number(detail.scrollHeight || 0)
    if (sh > 0) {
      const apply = (vh: number) => {
        this.updateScrollbar(top, sh, vh)
        // 距底部不足约 2 行高度时追加（与 App 一致）
        if (vh > 0 && top + vh >= sh - ROW_HEIGHT_PX * 2) {
          this.appendRows(APPEND_BATCH)
        }
      }
      if (this._viewportH > 0) {
        apply(this._viewportH)
      } else {
        wx.createSelectorQuery()
          .in(this as any)
          .select('.table-body')
          .boundingClientRect((rect) => {
            if (!rect || !rect.height) return
            this._viewportH = rect.height
            apply(rect.height)
          })
          .exec()
      }
    }

    const now = Date.now()
    if (now - this._scrollCheckAt < 120) return
    this._scrollCheckAt = now
  },

  consumeAgentStock() {
    let pending: any = null
    try {
      pending = wx.getStorageSync('tuk_agent_stock_open_v1')
      wx.removeStorageSync('tuk_agent_stock_open_v1')
    } catch (e) {
      pending = null
    }
    if (!pending || !pending.code) return
    const code = String(pending.code)
    const qty = Math.max(1, Math.min(9999, Math.round(Number(pending.qty) || 1)))
    const stockIn = pending.stockIn !== false
    this.openStockAdjust(stockIn)
    const apply = () => {
      const product = this._products.find(
        (item) => String(item.code || '').toUpperCase() === code.toUpperCase(),
      )
      if (!product) return false
      const n = displayStock(product)
      const hint = skuHint(product)
      const stockPart = n != null ? `  库存 ${n}` : hint ? `  ${hint}` : '  库存未设'
      this.setData({
        stkKeyword: product.code,
        stkSelectedCode: product.code,
        stkSelectedLabel: `已选：${product.name || product.code}（${product.code}）${stockPart}`,
        stkQty: String(qty),
        stkCanSubmit: !isSkuProduct(product),
        stkNeedSku: isSkuProduct(product),
        stkColors: product.colors || [],
        stkSizes: product.sizes || [],
      })
      this.refreshStockRows()
      return true
    }
    if (apply() || this._products.length) return
    void fetchCatalog().then((r) => {
      if (!r.ok) return
      this._products = r.products || []
      apply()
    })
  },

  consumePendingSheet() {
    let pending: any = null
    try {
      pending = wx.getStorageSync('tuk_pending_sheet')
      wx.removeStorageSync('tuk_pending_sheet')
    } catch (e) {
      pending = null
    }
    if (!pending || !Array.isArray(pending.items)) return

    const items = pending.items as CartItem[]
    const rows: SheetRow[] = []
    const byCode = new Map<string, number>()
    for (const it of items) {
      const code = String(it.productCode || it.productName || '').trim()
      const sku = colorSizeFromItem(it)
      const color = sku.color
      const size = sku.size
      const spec = sku.spec
      const qty = Number(it.quantity) || 0
      const isSku = !!(color || size)
      const priceKey = String(Number(it.price) || 0)
      const groupKey = isSku && code ? `${code}|${priceKey}|${String(it.unit || '').trim()}` : ''
      const exist = groupKey ? byCode.get(groupKey) : undefined
      if (exist != null) {
        const row = rows[exist]
        const hit = (row.skuLines || []).find((x) => x.color === color && x.size === size)
        if (hit) hit.qty += Math.abs(qty)
        else {
          row.skuLines = (row.skuLines || []).concat({
            key: `${color}-${size}-${row.skuLines.length}`,
            color,
            size,
            spec,
            qty: Math.abs(qty),
          })
        }
        const next = refreshRow(decorateSkuRow(row, !!pending.isReturn))
        next.skuOpen = (next.skuLines || []).length > 1
        rows[exist] = next
        continue
      }
      const row = refreshRow(
        decorateSkuRow(
          {
            ...emptyRow(rows.length),
            productCode: code,
            productName: code || it.productName,
            spec,
            color,
            size,
            unit: it.unit || '',
            quantityText: fmtNum(qty),
            priceText: fmtNum(it.price),
            countInStats: it.countInStats !== false,
            skuLines: isSku
              ? [
                  {
                    key: `${color}-${size}-0`,
                    color,
                    size,
                    spec,
                    qty: Math.abs(qty),
                  },
                ]
              : [],
            skuOpen: false,
          },
          !!pending.isReturn,
        ),
      )
      row.skuOpen = (row.skuLines || []).length > 1
      if (groupKey) byCode.set(groupKey, rows.length)
      rows.push(row)
    }
    while (rows.length < DEFAULT_ROWS) rows.push(emptyRow(rows.length))
    let editingNo = String(pending.orderNo || '')
    const existing = editingNo ? findCachedOrder(editingNo) : null
    if (existing && !canEditOrder(existing)) {
      editingNo = ''
    }
    this._editingOrderNo = editingNo
    this._editingCreatedAt = editingNo
      ? String(pending.createdAt || existing?.createdAt || '')
      : ''
    this._loadedCustomerKey = editingNo
      ? customerKey(pending.customerName, pending.customerPhone)
      : ''
    this._returnReason = String(pending.returnReason || '')
    this.setData({
      rows,
      customerName: pending.customerName || '',
      customerPhone: pending.customerPhone || '',
      customerId: pending.customerId || '',
      remark: pending.remark || '',
      dateStr: pending.dateStr || todayStr(),
      isReturnMode: !!pending.isReturn,
      isPaid: !!pending.isPaid,
      isPickedUp: !!pending.isPickedUp,
      isShipped: !!pending.isShipped,
      isDelivered: !!pending.isDelivered,
      deliveryPhotoPath: pending.deliveryPhotoPath || '',
      trackingNos: Array.isArray(pending.trackingNos)
        ? pending.trackingNos.map((n: any) => String(n).trim()).filter(Boolean)
        : [],
      shippedLabel: Array.isArray(pending.trackingNos) && pending.trackingNos.length
        ? `${t('shipped')}(${pending.trackingNos.length})`
        : t('shipped'),
      selectedIndex: -1,
    })
    this.recomputeTotal(rows)
    void this.refreshBillHead()
  },

  resetRows(count = DEFAULT_ROWS) {
    const rows = Array.from({ length: count }, (_, i) => emptyRow(i))
    this.setData({
      rows,
      totalAmountLabel: '0.00',
      totalQtyLabel: '0',
      sumAfter: -1,
      selectedIndex: -1,
    })
    setTimeout(() => this.ensureMinRowsForViewport(), 30)
  },

  async loadMeta() {
    // 缓存秒开
    const cachedCat = peekCachedCatalog()
    const cachedCust = peekCachedCustomers()
    const cachedShop = peekCachedShop()
    if (cachedCat.length) this._products = cachedCat
    if (cachedCust.length || cachedShop) {
      this.setData({
        customers: cachedCust.length ? cachedCust : this.data.customers,
        shop: cachedShop || this.data.shop,
      })
    }

    if (isGuest() || !isLoggedIn()) {
      this._products = peekCachedCatalog()
      this.setData({
        shop: peekCachedShop() || this.data.shop,
        customers: peekCachedCustomers(),
      })
      void this.refreshBillHead()
      return
    }
    if (!isCloudSyncAllowed()) {
      try {
        await refreshEntitlement({ force: true })
      } catch (_) {}
    }
    if (!isCloudSyncAllowed()) {
      this._products = peekCachedCatalog()
      this.setData({
        shop: peekCachedShop() || this.data.shop,
        customers: peekCachedCustomers(),
      })
      void this.refreshBillHead()
      void fetchShop().then((shop) => {
        if (!shop.shop) return
        this.setData({ shop: shop.shop })
        void this.refreshBillHead()
      })
      return
    }

    void this.loadMerchantPending()
    const gate = await shouldPullTeamMeta('home', cachedCat.length > 0 && !!cachedShop)
    if (!gate.pull) {
      if (Date.now() - _priceSourcesAt >= PRICE_SOURCES_MIN_MS) void this.refreshPriceSources()
      void this.refreshBillHead()
      return
    }

    const [cat, shop, cust] = await Promise.all([
      fetchCatalog(),
      fetchShop(),
      fetchCustomers(),
    ])
    if (cat.ok) this._products = cat.products || []
    this.setData({
      shop: shop.ok ? shop.shop || null : this.data.shop,
      customers: cust.ok ? cust.customers || [] : this.data.customers,
    })
    if (cat.ok && !cat.fromCache && shop.ok && !shop.fromCache && cust.ok && !cust.fromCache) {
      markTeamMetaPulled(['home', 'catalog'], gate.owner, gate.rev)
    }
    void this.refreshBillHead()
    // 后台拉近期订单明细 + 个人记忆价，供「客户上次价」取价（对齐 App）
    void this.refreshPriceSources()
  },

  async loadMerchantPending() {
    if (isGuest() || !isLoggedIn() || isAgentWorkspace()) return
    const r = await fetchAgentShopSetting()
    this.setData({ merchantPendingCount: r.ok ? Number(r.pendingCount || 0) : 0 })
  },

  async refreshPriceSources() {
    if (isGuest() || !isLoggedIn() || !isCloudSyncAllowed()) return
    _priceSourcesAt = Date.now()
    try {
      await Promise.all([
        fetchAllOrdersFull({ since: recentOrdersSinceIso() }),
        pullUserPrices().then((r) => {
          if (r.ok) return pushUserPrices()
          return r
        }),
      ])
    } catch (_) {
      /* 取价源失败不挡开单；有本地缓存仍可按客户价 */
    }
  },

  /** 选定客户后：已有货号行换成该客户上次成交价（仅覆盖有历史的行，对齐 App） */
  applyCustomerPricesToRows(customerName: string) {
    const name = String(customerName || '').trim()
    if (!name) return
    const rows = this.data.rows.slice()
    let changed = false
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const code = (row.productCode || row.productName || '').trim()
      if (!code) continue
      const cp = getCustomerLastPrice(name, code)
      if (cp == null) continue
      const next = fmtNum(cp)
      if (row.priceText !== next || row.priceSource !== '上次') {
        row.priceText = next
        row.priceSource = '上次'
        rows[i] = refreshRow(decorateSkuRow(row, !!this.data.isReturnMode))
        changed = true
      }
    }
    if (!changed) return
    if ((this.data.customerName || '').trim() !== name) return
    this.setData({ rows })
    this.recomputeTotal(rows)
  },

  /** 选货号后取价：客户上次成交价 > 个人记忆价 > 目录价（对齐 App，直接覆盖单价） */
  resolveRowPrice(productCode: string, catalogPrice?: number): string {
    return fmtNum(
      resolveUnitPrice({
        customerName: this.data.customerName,
        productCode,
        catalogPrice,
      }),
    )
  },

  recomputeTotal(rows?: SheetRow[]) {
    let list = rows || this.data.rows
    let total = 0
    let qty = 0
    let last = -1
    for (let i = 0; i < list.length; i++) {
      const r = list[i]
      total += rowSubtotal(r)
      const q = parseFloat(r.quantityText)
      if (Number.isFinite(q) && (r.productName.trim() || r.quantityText.trim())) qty += q
      if (rowHasSheetInput(r)) last = i
    }
    const hasCode = list.some((r) => (r.productName || '').trim())
    const sumOn = hasCode ? last + 2 : -1
    const patch: Record<string, string | number | SheetRow[]> = {
      totalAmountLabel: fmtMoney(total),
      totalQtyLabel: fmtNum(this.data.isReturnMode ? Math.abs(qty) : qty),
      sumAfter: sumOn,
    }
    // 浮层盖在空行的下一行上，行不够时补空行，不另插一行
    if (hasCode) {
      const need = Math.min(sumOn + 1, MAX_ROWS)
      if (list.length < need) {
        const add = need - list.length
        list = list.concat(Array.from({ length: add }, (_, i) => emptyRow(list.length + i)))
        patch.rows = list
      }
      if (sumOn >= list.length) patch.sumAfter = Math.max(0, list.length - 1)
    }
    this.setData(patch)
  },

  snapshotUndo() {
    this._undoSnapshot = this.data.rows.map((r) => ({
      ...r,
      skuLines: (r.skuLines || []).map((x) => ({ ...x })),
    }))
  },

  contentRows(): SheetRow[] {
    return this.data.rows.filter((r) => r.productName.trim() && parseFloat(r.quantityText))
  },

  ensureCustomer(): boolean {
    if (!(this.data.customerName || '').trim()) {
      return false
    }
    return true
  },

  showTopToast(msg: string, durationMs = 2000) {
    if (this._topToastTimer) {
      clearTimeout(this._topToastTimer)
      this._topToastTimer = 0
    }
    const sys = wx.getSystemInfoSync()
    const top = (sys.statusBarHeight || 20) + 8
    this.setData({
      topToastVisible: true,
      topToastMsg: msg,
      topToastTop: top,
    })
    this._topToastTimer = setTimeout(() => {
      this.setData({ topToastVisible: false })
      this._topToastTimer = 0
    }, durationMs) as any
  },

  /** 打印/保存/另存前必须先选择客户（对齐 App _ensureCustomerSelected） */
  ensureCustomerSelected(): Promise<boolean> {
    if ((this.data.customerName || '').trim()) return Promise.resolve(true)
    this.showTopToast('请先添加客户名称')
    this.openCustomerPicker()
    return new Promise((resolve) => {
      this._custEnsureResolve = resolve
    })
  },

  finishCustEnsure(ok: boolean) {
    const fn = this._custEnsureResolve
    if (!fn) return
    this._custEnsureResolve = null
    fn(!!ok)
  },

  offerBillKind(): Promise<'sale' | 'return' | null> {
    return new Promise((resolve) => {
      this._billKindResolve = resolve
      this.closeInputKeyboard()
      this.setData({ billKindVisible: true })
    })
  },

  closeBillKind(kind: 'sale' | 'return' | null) {
    const fn = this._billKindResolve
    this._billKindResolve = null
    this.setData({ billKindVisible: false }, () => {
      if (fn) fn(kind)
    })
  },

  onBillKindSale() {
    this.closeBillKind('sale')
  },

  onBillKindReturn() {
    this.closeBillKind('return')
  },

  onBillKindClose() {
    this.closeBillKind(null)
  },

  /** 选中客户后二选一。退单走原来的选日期、选原因、进入退单，不直接打印。 */
  async afterCustomerPicked() {
    const kind = await this.offerBillKind()
    if (kind === 'sale') {
      await this.onExitReturn()
      this.finishCustEnsure(true)
      void this.refreshBillHead()
      return
    }
    if (kind === 'return') {
      if (this.data.isReturnMode) {
        this.finishCustEnsure(true)
        void this.refreshBillHead()
        return
      }
      // 先结束正在等待的销售打印，再进入退单，避免选完原因立刻打出销售单
      this.finishCustEnsure(false)
      await this.beginReturnEntry()
      return
    }
    this.finishCustEnsure(!!(this.data.customerName || '').trim())
    void this.refreshBillHead()
  },

  /** 第一次进入退单：选退单日期和原因，不打印 */
  async beginReturnEntry(): Promise<boolean> {
    if (this.data.saving || this.data.printing) return false
    if (this.data.isReturnMode) return true
    const picked = await new Promise<string | null>((resolve) => {
      this._calPickResolve = resolve
      const cur = parseYmd(this.data.dateStr) || new Date()
      this.openCalendar(cur)
      this.setData({ calTitle: t('pickReturnDate') })
    })
    this._calPickResolve = null
    if (!picked) return false
    let reason = t('reasonOther') || '其他'
    if (loadPrintSettings().askReturnReason) {
      const pickedReason = await this.pickReturnReason()
      if (!pickedReason) return false
      reason = pickedReason
    }
    await this.enterReturnMode(reason)
    this.showTopToast(t('enteredReturn').replace('{reason}', reason), 2800)
    return true
  },

  onExpandOptional() {
    this.placeMore({}, undefined, true)
  },
  onCollapseOptional() {
    this.setData({ optionalExpanded: false })
  },
  onToggleMore() {
    if (this.data.optionalExpanded) {
      this.setData({ optionalExpanded: false })
      return
    }
    this.placeMore({}, undefined, true)
  },
  /** 其他快捷层与联想窗同一锚点。只有 open 为真才展开；已展开时更新数据仍保持展开。 */
  placeMore(extra: Record<string, unknown> = {}, done?: () => void, open = false) {
    const keepOpen = open || !!this.data.optionalExpanded
    if (!keepOpen) {
      if (Object.keys(extra).length) this.setData(extra, done)
      else if (done) done()
      return
    }
    this.measurePopAnchor((box) => {
      this.setData(
        {
          ...extra,
          optionalExpanded: true,
          moreTop: box.top,
          moreLeft: box.left,
          moreMaxH: box.maxH,
          moreMaxW: box.maxW,
        },
        done,
      )
    })
  },

  /** 教程下沿偏右一截，底边停在表头上沿。联想窗和三点快捷层共用。 */
  measurePopAnchor(done: (box: { top: number; left: number; maxH: number; maxW: number }) => void) {
    wx.createSelectorQuery()
      .in(this)
      .select('tutorial-link')
      .boundingClientRect()
      .select('.nav-row')
      .boundingClientRect()
      .select('.table-header')
      .boundingClientRect()
      .exec((res: any[]) => {
        const tut = res && res[0]
        const nav = res && res[1]
        const header = res && res[2]
        const anchor = tut && tut.bottom ? tut : nav
        const width = (wx.getWindowInfo && wx.getWindowInfo().windowWidth) || 375
        const rpx = width / 750
        const gutter = Math.round(48 * rpx)
        const baseLeft = anchor && anchor.left != null ? Number(anchor.left) : 0
        const left = Math.max(gutter, Math.round(baseLeft + gutter))
        const top = anchor && anchor.bottom ? Math.round(Number(anchor.bottom) + 10 * rpx) : 0
        const headerTop = header && header.top ? Number(header.top) : 0
        const maxH = headerTop > top + 8 ? Math.floor(headerTop - top) : 0
        const maxW = Math.max(Math.round(220 * rpx), Math.round(width - left - 32 * rpx))
        done({ top, left, maxH, maxW })
      })
  },
  onToggleDockFold() {
    this.setData({ dockFolded: !this.data.dockFolded })
  },
  closeMore() {
    if (this.data.optionalExpanded) this.setData({ optionalExpanded: false })
  },

  onPickCustomer() {
    this.openCustomerPicker()
  },
  onClearCustomer() {
    if (!(this.data.customerName || '').trim()) return
    this.exitReturnIfCustomerChanged('')
    this.setData({ customerName: '', customerPhone: '', customerId: '' })
    void this.refreshBillHead()
  },

  openCustomerPicker() {
    this.closeInputKeyboard()
    this.setData({
      custPickerVisible: true,
      custKeyword: '',
      custSearching: false,
      // 游客也可本机新增客户
      custCanManage:
        !isAgentWorkspace() &&
        (isGuest() || !isLoggedIn() || isOwner() || isJoinedEmployee()),
    })
    this.refreshCustomerPicker()
  },

  refreshCustomerPicker() {
    const all = this.data.customers || []
    const q = stripSpokenMarks(this.data.custKeyword || '').trim().toLowerCase()
    let rows: CustPickRow[] = []
    let searching = false
    let sectionTitle = t('recentCustomers')
    let hint = ''

    if (q) {
      searching = true
      sectionTitle = t('searchResults')
      rows = all
        .filter(
          (c) =>
            stripSpokenMarks(c.name || '').toLowerCase().includes(q) ||
            stripSpokenMarks(String(c.phone || '')).includes(q),
        )
        .map((c) => toCustPickRow(c))
      hint = rows.length ? '' : t('noMatchCustomer')
    } else {
      const recent = pruneRecentCustomers(all)
      const seen = new Set<string>()
      const liveIds = new Set(all.map((c) => String(c.id || '')).filter(Boolean))
      for (const r of recent) {
        const key = `${r.name}|${r.phone}`
        if (seen.has(key)) continue
        const libraryId =
          r.id && !r.id.startsWith('recent:') ? String(r.id) : ''
        // 客户库已删（含回收站 / 彻底删除）的正式客户，不再用最近记录伪造一条
        if (libraryId && !liveIds.has(libraryId)) continue
        seen.add(key)
        const matched =
          (libraryId ? all.find((c) => c.id === libraryId) : undefined) ||
          all.find(
            (c) => c.name === r.name && String(c.phone || '') === r.phone,
          ) ||
          all.find((c) => c.name === r.name)
        if (matched) {
          rows.push(toCustPickRow(matched, formatRecentUsedLabel(r.usedAt)))
        } else {
          rows.push(
            toCustPickRow(
              {
                id: r.id || `recent:${key}`,
                name: r.name,
                phone: r.phone || null,
              },
              formatRecentUsedLabel(r.usedAt),
            ),
          )
        }
      }
      for (const c of all) {
        const key = `${c.name}|${c.phone || ''}`
        if (seen.has(key)) continue
        seen.add(key)
        rows.push(toCustPickRow(c))
      }
      hint = rows.length ? t('custScrollOrSearch') : t('noCustomersSearchAdd')
    }

    this._custAllRows = rows
    this._custShowCount = 20
    this.applyCustRowsWindow(searching, sectionTitle, hint)
  },

  applyCustRowsWindow(searching?: boolean, sectionTitle?: string, hint?: string) {
    const all = this._custAllRows
    const n = Math.min(this._custShowCount, all.length)
    const patch: Record<string, any> = {
      custRows: all.slice(0, n),
      custHasMore: n < all.length,
    }
    if (searching != null) patch.custSearching = searching
    if (sectionTitle != null) patch.custSectionTitle = sectionTitle
    if (hint != null) patch.custHint = hint
    this.setData(patch)
  },

  onCustListMore() {
    if (!this.data.custHasMore) return
    this._custShowCount += 20
    this.applyCustRowsWindow()
  },

  onCustKeyword(e: WechatMiniprogram.Input) {
    this.setData({ custKeyword: stripSpokenMarks(e.detail.value) })
    this.refreshCustomerPicker()
  },

  onCustClearKeyword() {
    this.setData({ custKeyword: '' })
    this.refreshCustomerPicker()
  },

  onCustSelect(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const row = this.data.custRows[index]
    if (!row) return
    saveRecentCustomer(row)
    this.exitReturnIfCustomerChanged(row.name)
    this.setData({
      customerName: row.name,
      customerPhone: row.phone || '',
      customerId: row.id.startsWith('recent:') ? '' : row.id,
      custPickerVisible: false,
      custKeyword: '',
    })
    this.applyCustomerPricesToRows(row.name)
    void this.afterCustomerPicked()
  },

  onCustNone() {
    this.exitReturnIfCustomerChanged('')
    this.setData({
      customerName: '',
      customerPhone: '',
      customerId: '',
      custPickerVisible: false,
      custKeyword: '',
    })
    this.finishCustEnsure(false)
    void this.refreshBillHead()
  },

  onCustClose() {
    this.setData({ custPickerVisible: false, custKeyword: '' })
    this.finishCustEnsure(!!(this.data.customerName || '').trim())
  },

  onCustAdd() {
    if (!this.data.custCanManage) {
      wx.showToast({ title: '仅商家可新增客户', icon: 'none' })
      return
    }
    this.closeInputKeyboard()
    this.setData({
      custFormVisible: true,
      custFormTitle: t('newCustomer'),
      custFormName: '',
      custFormPhone: '',
      custFormEditId: '',
      custFormNameFocus: true,
      custFormPhoneFocus: false,
    })
  },

  onCustFormName(e: WechatMiniprogram.Input) {
    this.setData({ custFormName: stripSpokenMarks(e.detail.value) })
  },

  onCustFormPhone(e: WechatMiniprogram.Input) {
    this.setData({ custFormPhone: e.detail.value })
  },

  onCustFormNameFocus() {
    this.setData({ custFormNameFocus: true, custFormPhoneFocus: false })
  },

  onCustFormPhoneFocus() {
    this.setData({ custFormNameFocus: false, custFormPhoneFocus: true })
  },

  onCustFormBlur() {
    this.setData({ custFormNameFocus: false, custFormPhoneFocus: false })
  },

  onCustFormCancel() {
    this.setData({
      custFormVisible: false,
      custFormName: '',
      custFormPhone: '',
      custFormEditId: '',
      custFormNameFocus: false,
      custFormPhoneFocus: false,
    })
    this.finishMissingCustomer('')
  },

  async onCustFormSave() {
    const name = stripSpokenMarks(this.data.custFormName || '').trim()
    const phone = (this.data.custFormPhone || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写客户名称', icon: 'none' })
      return
    }
    if (!(await assertMsgSecCheck([name, phone]))) return
    const editId = this.data.custFormEditId
    if (!editId) {
      const next: Customer[] = [
        ...(this.data.customers || []),
        { id: genJobNo(), name, phone },
      ]
      const up = await uploadCustomers(next)
      if (!up.ok) {
        wx.showToast({ title: up.error || '新增失败', icon: 'none' })
        return
      }
      const created = next[next.length - 1]
      this.setData({ customers: next })
      saveRecentCustomer(created)
      this.exitReturnIfCustomerChanged(name)
      this.setData({
        customerName: name,
        customerPhone: phone,
        customerId: created.id,
        custPickerVisible: false,
        custKeyword: '',
        custFormVisible: false,
        custFormName: '',
        custFormPhone: '',
        custFormEditId: '',
        custFormNameFocus: false,
        custFormPhoneFocus: false,
      })
      this.applyCustomerPricesToRows(name)
      wx.showToast({ title: '已添加', icon: 'success' })
      void this.afterCustomerPicked()
      this.finishMissingCustomer(name)
      return
    }
    if (editId.startsWith('recent:')) {
      const oldRow = (this.data.custRows || []).find((r) => r.id === editId)
      let next = [...(this.data.customers || [])]
      let saved = next.find(
        (c) =>
          (c.name || '').trim() === (oldRow?.name || '').trim() &&
          String(c.phone || '') === String(oldRow?.phone || ''),
      )
      if (saved) {
        next = next.map((c) => (c.id === saved!.id ? { ...c, name, phone } : c))
        saved = { ...saved, name, phone }
      } else {
        saved = { id: genJobNo(), name, phone }
        next = [...next, saved]
      }
      const up = await uploadCustomers(next)
      if (!up.ok) {
        wx.showToast({ title: up.error || '保存失败', icon: 'none' })
        return
      }
      if (oldRow) removeRecentCustomer(oldRow.name, oldRow.phone)
      saveRecentCustomer(saved)
      this.exitReturnIfCustomerChanged(name)
      this.setData({
        customers: next,
        customerName: name,
        customerPhone: phone,
        customerId: saved.id,
        custFormVisible: false,
        custFormName: '',
        custFormPhone: '',
        custFormEditId: '',
        custFormNameFocus: false,
        custFormPhoneFocus: false,
      })
      this.applyCustomerPricesToRows(name)
      this.refreshCustomerPicker()
      void this.afterCustomerPicked()
      return
    }
    const next = (this.data.customers || []).map((c) =>
      c.id === editId ? { ...c, name, phone } : c,
    )
    const up = await uploadCustomers(next)
    if (!up.ok) {
      wx.showToast({ title: up.error || '保存失败', icon: 'none' })
      return
    }
    this.setData({
      customers: next,
      custFormVisible: false,
      custFormName: '',
      custFormPhone: '',
      custFormEditId: '',
      custFormNameFocus: false,
      custFormPhoneFocus: false,
    })
    if (this.data.customerId === editId) {
      this.exitReturnIfCustomerChanged(name)
      this.setData({ customerName: name, customerPhone: phone })
      this.applyCustomerPricesToRows(name)
    }
    this.refreshCustomerPicker()
  },

  onCustMore(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.custCanManage) return
    this.closeInputKeyboard()
    const index = Number(e.currentTarget.dataset.index)
    const row = this.data.custRows[index]
    if (!row) return
    const isRecent = row.id.startsWith('recent:')
    wx.createSelectorQuery()
      .in(this)
      .select(`#cust-more-${index}`)
      .boundingClientRect((rect) => {
        if (!rect) return
        const sys = wx.getSystemInfoSync()
        const menuW = 168
        const menuH = isRecent ? 144 : 96
        let left = rect.right - menuW
        let top = rect.bottom - 4
        if (left < 8) left = 8
        if (left + menuW > sys.windowWidth - 8) {
          left = Math.max(8, sys.windowWidth - menuW - 8)
        }
        if (top + menuH > sys.windowHeight - 8) {
          top = Math.max(8, rect.top - menuH + 4)
        }
        this.setData({
          custMenuVisible: true,
          custMenuTop: top,
          custMenuLeft: left,
          custMenuIndex: index,
          custMenuIsRecent: isRecent,
        })
      })
      .exec()
  },

  onCustMenuClose() {
    this.setData({ custMenuVisible: false, custMenuIndex: -1 })
  },

  onCustMenuAction(e: WechatMiniprogram.TouchEvent) {
    const action = String(e.currentTarget.dataset.action || '')
    const index = this.data.custMenuIndex
    const row = this.data.custRows[index]
    this.setData({ custMenuVisible: false, custMenuIndex: -1 })
    if (!row) return
    if (action === 'save') void this.saveRecentToLibrary(row)
    if (action === 'edit') this.editCustomerRow(row)
    if (action === 'delete') this.deleteCustomerRow(row)
  },

  async saveRecentToLibrary(row: CustPickRow) {
    const name = (row.name || '').trim()
    if (!name) return
    const phone = String(row.phone || '')
    let saved = (this.data.customers || []).find(
      (c) => (c.name || '').trim() === name && String(c.phone || '') === phone,
    )
    if (!saved) {
      saved = { id: genJobNo(), name, phone }
      const next = [...(this.data.customers || []), saved]
      const up = await uploadCustomers(next)
      if (!up.ok) {
        wx.showToast({ title: up.error || '保存失败', icon: 'none' })
        return
      }
      this.setData({ customers: next })
    }
    removeRecentCustomer(name, phone)
    saveRecentCustomer(saved)
    wx.showToast({ title: `已保存客户「${saved.name}」`, icon: 'none' })
    this.refreshCustomerPicker()
  },

  editCustomerRow(row: CustPickRow) {
    const isRecent = row.id.startsWith('recent:')
    this.closeInputKeyboard()
    this.setData({
      custFormVisible: true,
      custFormTitle: isRecent ? t('saveAndEditCustomer') : t('editCustomer'),
      custFormName: row.name || '',
      custFormPhone: row.phone || '',
      custFormEditId: row.id,
      custFormNameFocus: true,
      custFormPhoneFocus: false,
    })
  },

  deleteCustomerRow(row: CustPickRow) {
    this.closeInputKeyboard()
    if (row.id.startsWith('recent:')) {
      wx.showModal({
        title: '移除最近客户？',
        content: `「${row.name}」来自历史开单记录，尚未加入客户库。\n移除后不会再出现在最近列表（历史账单不受影响）。`,
        confirmText: '移除',
        confirmColor: '#e53935',
        success: (res) => {
          if (!res.confirm) return
          removeRecentCustomer(row.name, row.phone)
          this.refreshCustomerPicker()
        },
      })
      return
    }
    wx.showModal({
      title: '删除客户？',
      content: '确定删除该客户？将移入回收站。',
      confirmText: '删除',
      confirmColor: '#e53935',
      success: async (res) => {
        if (!res.confirm) return
        const up = await softDeleteCustomer(row)
        if (!up.ok) {
          wx.showToast({ title: up.error || '删除失败', icon: 'none' })
          return
        }
        forgetRecentCustomer(row)
        const next = (this.data.customers || []).filter((c) => c.id !== row.id)
        this.setData({ customers: next })
        if (this.data.customerId === row.id) {
          this.exitReturnIfCustomerChanged('')
          this.setData({ customerName: '', customerPhone: '', customerId: '' })
          void this.refreshBillHead()
        }
        this.refreshCustomerPicker()
        wx.showToast({ title: '已移入回收站', icon: 'success' })
      },
    })
  },

  onEditDate() {
    const cur = parseYmd(this.data.dateStr) || new Date()
    this.openCalendar(cur)
  },

  openCalendar(initial: Date) {
    this.closeInputKeyboard()
    const y = initial.getFullYear()
    const m0 = initial.getMonth()
    const ymd = ymdOf(initial)
    this.setData({
      calVisible: true,
      calTitle: this.data.isReturnMode ? t('pickReturnDate') : t('pickOrderDate'),
      calViewYear: y,
      calViewMonth: m0,
      calSelectedYmd: ymd,
      calPickerValue: `${y}-${pad2(m0 + 1)}`,
      calHeaderLabel: formatCalHeader(initial),
      calMonthLabel: formatCalMonth(y, m0),
      calCells: buildCalCells(y, m0, ymd),
    })
  },

  refreshCalGrid() {
    const y = this.data.calViewYear
    const m0 = this.data.calViewMonth
    const sel = parseYmd(this.data.calSelectedYmd) || new Date(y, m0, 1)
    this.setData({
      calMonthLabel: formatCalMonth(y, m0),
      calPickerValue: `${y}-${pad2(m0 + 1)}`,
      calHeaderLabel: formatCalHeader(sel),
      calCells: buildCalCells(y, m0, this.data.calSelectedYmd),
    })
  },

  onCalPrevMonth() {
    let y = this.data.calViewYear
    let m0 = this.data.calViewMonth - 1
    if (m0 < 0) {
      m0 = 11
      y -= 1
    }
    this.setData({ calViewYear: y, calViewMonth: m0 }, () => this.refreshCalGrid())
  },

  onCalNextMonth() {
    let y = this.data.calViewYear
    let m0 = this.data.calViewMonth + 1
    if (m0 > 11) {
      m0 = 0
      y += 1
    }
    this.setData({ calViewYear: y, calViewMonth: m0 }, () => this.refreshCalGrid())
  },

  onCalPickDay(e: WechatMiniprogram.TouchEvent) {
    const ymd = String(e.currentTarget.dataset.ymd || '')
    const inMonth = Number(e.currentTarget.dataset.inmonth) === 1
    if (!ymd) return
    const d = parseYmd(ymd)
    if (!d) return
    const patch: Record<string, any> = {
      calSelectedYmd: ymd,
      calHeaderLabel: formatCalHeader(d),
    }
    if (!inMonth) {
      patch.calViewYear = d.getFullYear()
      patch.calViewMonth = d.getMonth()
      patch.calMonthLabel = formatCalMonth(d.getFullYear(), d.getMonth())
    }
    this.setData(patch, () => this.refreshCalGrid())
  },

  onCalPickMonth() {
    // 由 wxml 中 picker 触发，此方法保留兼容
  },

  onCalYmChange(e: WechatMiniprogram.PickerChange) {
    const v = String(e.detail.value || '')
    // mode=date fields=month → yyyy-MM
    const m = /^(\d{4})-(\d{2})/.exec(v)
    if (!m) return
    this.setData(
      {
        calViewYear: Number(m[1]),
        calViewMonth: Number(m[2]) - 1,
      },
      () => this.refreshCalGrid(),
    )
  },

  onCalCancel() {
    this.setData({ calVisible: false })
    if (this._calPickResolve) {
      const resolve = this._calPickResolve
      this._calPickResolve = null
      resolve(null)
    }
  },

  onCalConfirm() {
    const ymd = this.data.calSelectedYmd
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }
    this.setData({ dateStr: ymd, calVisible: false })
    if (this._calPickResolve) {
      const resolve = this._calPickResolve
      this._calPickResolve = null
      resolve(ymd)
    }
  },

  onCellInput(e: WechatMiniprogram.Input) {
    const index = Number(e.currentTarget.dataset.index)
    const field = String(e.currentTarget.dataset.field)
    let value = e.detail.value
    const rows = this.data.rows.slice()
    const row = rows[index]
    if (!row) return

    if (field === 'quantityText' && row.skuCount) return
    if (field === 'quantityText' && this.data.isReturnMode) {
      value = normalizeReturnQty(value)
    }
    ;(row as any)[field] = value
    rows[index] = refreshRow(row)
    const patch: Record<string, unknown> = { rows }
    this.dropQtyCursor(patch)
    this.setData(patch)
    this.recomputeTotal(rows)
  },

  applySuggestKb(height: number, _from: 'page' | 'input') {
    if (this._voiceHoldKbLock) return
    const h = height > 0 ? Math.round(height) : 0
    // 收起后 800ms 内的正高度是 P60 数字键盘补回来的旧值，不是新键盘。
    if (h > 0 && Date.now() - this._kbClosedAt < 800) return
    if (h <= 0) this._kbClosedAt = Date.now()
    if (this.data.suggestKbH === h) return
    this.setData({ suggestKbH: h })
  },

  noteKbFocus(e: WechatMiniprogram.Input) {
    this._kbClosedAt = 0
    const h = Number(e.detail?.height) || 0
    if (h > 0) this.applySuggestKb(h, 'input')
  },

  /** 数字键盘点折叠：输入框自己的高度事件，或失焦。页面级监听在 P60 上不可靠。 */
  onDigitKbHeight(e: WechatMiniprogram.Input) {
    this.applySuggestKb(Number(e.detail?.height) || 0, 'input')
  },

  releaseDigitKb() {
    if (this._voiceHoldKbLock) return
    this._kbClosedAt = Date.now()
    if (this.data.suggestKbH !== 0) this.setData({ suggestKbH: 0 })
  },

  onVoiceWillHold() {
    this._voiceHoldKbLock = true
    const patch: Record<string, unknown> = {}
    this.dropQtyCursor(patch)
    if (Object.keys(patch).length) this.setData(patch)
    wx.hideKeyboard()
  },

  onVoiceFabIdle() {
    this._voiceHoldKbLock = false
    this.releaseDigitKb()
  },

  cancelDigitLeave() {
    if (this._digitLeaveTimer) {
      clearTimeout(this._digitLeaveTimer)
      this._digitLeaveTimer = 0
    }
  },

  /** 数字框失焦后，若没有马上进入别的输入框，就把右下角按钮放回原位。 */
  scheduleDigitLeave() {
    this.cancelDigitLeave()
    this._digitLeaveTimer = setTimeout(() => {
      this._digitLeaveTimer = 0
      this.releaseDigitKb()
    }, 120) as any
  },

  /** 弹出层出现时收起当前输入键盘。表格框按住键盘，点按钮不会自己收。 */
  closeInputKeyboard() {
    this.releaseDigitKb()
    wx.hideKeyboard()
  },

  dropQtyCursor(patch: Record<string, unknown>) {
    if (this.data.qtyForceIndex !== -1) patch.qtyForceIndex = -1
    if (this.data.qtyArmIndex !== -1) patch.qtyArmIndex = -1
    if (this.data.qtySelStart !== -1) patch.qtySelStart = -1
    if (this.data.qtySelEnd !== -1) patch.qtySelEnd = -1
  },

  onQtyFocus(e: WechatMiniprogram.Input) {
    this.cancelDigitLeave()
    this.noteKbFocus(e)
    const index = Number(e.currentTarget.dataset.index)
    if (this.data.qtyForceIndex === index) return
    const len = String(e.detail?.value ?? this.data.rows[index]?.quantityText ?? '').length
    this.setData({
      qtyArmIndex: index,
      qtySelStart: 0,
      qtySelEnd: Math.max(len, 0),
    })
  },

  onQtyBlur() {
    // 只改内存。这里 setData 会在新输入框落点之前把光标拽走。
    this.data.qtyForceIndex = -1
    this.data.qtyArmIndex = -1
    this.data.qtySelStart = -1
    this.data.qtySelEnd = -1
    this.scheduleDigitLeave()
  },

  onPriceFocus() {
    this.cancelDigitLeave()
  },

  onPriceBlur() {
    this.scheduleDigitLeave()
  },

  onUnitFocus() {
    this.cancelDigitLeave()
  },

  stepQtyText(raw: string, dir: number) {
    const n = parseFloat(String(raw || '').trim())
    const cur = Number.isFinite(n) ? n : 0
    const abs = Math.abs(cur)
    let nextAbs = abs + dir
    if (nextAbs < 0) nextAbs = 0
    if (this.data.isReturnMode) {
      if (nextAbs < 1) nextAbs = 1
      return String(-nextAbs)
    }
    return Number.isInteger(nextAbs) ? String(nextAbs) : String(Math.round(nextAbs * 1000) / 1000)
  },

  onQtyStep(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const dir = Number(e.currentTarget.dataset.dir) || 0
    const rows = this.data.rows.slice()
    const row = rows[index]
    if (!row || row.skuCount) return
    row.quantityText = this.stepQtyText(row.quantityText, dir)
    rows[index] = refreshRow(row)
    this.setData({ rows, focusQtyIndex: -1 })
    this.recomputeTotal(rows)
  },

  onSkuLineQtyStep(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const key = String(e.currentTarget.dataset.key || '')
    const dir = Number(e.currentTarget.dataset.dir) || 0
    const rows = this.data.rows.slice()
    const row = rows[index]
    if (!row || !row.skuCount) return
    const lines = (row.skuLines || []).map((x) => ({ ...x }))
    const line = lines.find((x) => x.key === key)
    if (!line) return
    const next = line.qty + dir
    if (next < 1) {
      row.skuLines = lines.filter((x) => x.key !== key)
      rows[index] = refreshRow(decorateSkuRow(row, this.data.isReturnMode))
      this.setData({ rows })
      this.recomputeTotal(rows)
      return
    }
    if (dir > 0 && !this.data.isReturnMode) {
      const p = this._products.find((x) => x.code === rowCodeOf(row))
      if (p) {
        const remain = this.skuPickRemain(p, line.color, line.size, lines)
        if (remain != null && remain < 1) {
          wx.showToast({ title: t('skuStockNeed'), icon: 'none' })
          return
        }
      }
    }
    line.qty = next
    row.skuLines = lines
    row.skuOpen = true
    rows[index] = refreshRow(decorateSkuRow(row, this.data.isReturnMode))
    this.setData({ rows })
    this.recomputeTotal(rows)
  },

  onNameFocus(e: WechatMiniprogram.Input) {
    if (this.nameEventsLocked()) {
      this.rearmQtyAfterNameSteal()
      return
    }
    this.cancelDigitLeave()
    const index = Number(e.currentTarget.dataset.index)
    this._suggestRowIndex = index
    this.data.focusNameIndex = index
    const text = this.data.rows[index]?.productName || ''
    this.scheduleSuggest(text)
  },

  onNameInput(e: WechatMiniprogram.Input) {
    if (this.nameEventsLocked()) return
    const index = Number(e.currentTarget.dataset.index)
    const value = stripSpokenMarks(e.detail.value)
    const rows = this.data.rows.slice()
    const row = rows[index]
    if (!row) return
    row.productName = value
    row.productCode = value.trim()
    row.spec = ''
    row.color = ''
    row.size = ''
    row.skuLines = []
    row.skuOpen = false
    row.skuCount = 0
    row.skuFoldLabel = ''
    rows[index] = refreshRow(row)
    const patch: Record<string, unknown> = { rows, focusNameIndex: index }
    this.dropQtyCursor(patch)
    this.setData(patch)
    this.recomputeTotal(rows)
    this._suggestRowIndex = index
    this.scheduleSuggest(value)
  },

  onNameConfirm(e: WechatMiniprogram.Input) {
    const index = Number(e.currentTarget.dataset.index)
    // 有高亮候选则选中
    if (this.data.suggestVisible && this.data.suggestPageItems.length) {
      const hi = this.data.suggestHighlight
      const it = this.data.suggestPageItems[hi]
      if (it) {
        this.applySuggestProduct(index, it)
        return
      }
    }
    void this.lookupProductAt(index)
  },

  onNameBlur(e: WechatMiniprogram.Input) {
    if (this.nameEventsLocked()) return
    const index = Number(e.currentTarget.dataset.index)
    // 延迟：给浮层点击时间（对齐 App armPickFromOverlay）
    setTimeout(() => {
      if (this._pickingSuggest) {
        if (this._pickingSuggest) this._pickingSuggest = false
        return
      }
      this.closeSuggest()
      if (this.data.rows[index]?.skuCount) return
      void this.lookupProductAt(index)
    }, 180)
  },

  noop() {},

  scheduleSuggest(text: string) {
    if (!loadPrintSettings().productNameSuggestions) {
      this.closeSuggest()
      return
    }
    if (this._suggestTimer) clearTimeout(this._suggestTimer)
    this._suggestTimer = setTimeout(() => {
      this.runSuggest(text)
    }, 120) as any
  },

  searchProductsLocal(query: string): SuggestItem[] {
    const q = stripSpokenMarks(query).trim().toLowerCase()
    let list = this._products.slice()
    if (q) {
      list = list.filter(
        (p) =>
          stripSpokenMarks(p.code || '').toLowerCase().includes(q) ||
          stripSpokenMarks(p.name || '').toLowerCase().includes(q) ||
          stripSpokenMarks(p.barcode || '').toLowerCase().includes(q) ||
          stripSpokenMarks(p.spec || '').toLowerCase().includes(q),
      )
      list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'))
    } else {
      list.sort((a, b) => (a.code || '').localeCompare(b.code || '', 'zh'))
    }
    return list.slice(0, SUGGEST_LIMIT).map((p) => ({
      code: p.code,
      name: p.name || '',
      label: displaySuggestLabel(p),
      stockLabel: (() => {
        const n = displayStock(p)
        const hint = skuHint(p)
        if (n == null) return hint
        return hint ? `${n} · ${hint}` : String(n)
      })(),
      unit: p.unit || '',
      price: Number(p.price) || 0,
      countInStats: p.countInStats !== false,
    }))
  },

  runSuggest(text: string) {
    const query = text.trim()
    if (!query) {
      this.closeSuggest()
      return
    }
    if (query === this._lastSuggestQuery && this.data.suggestVisible) return
    this._lastSuggestQuery = query
    const all = this.searchProductsLocal(query)
    this._suggestAll = all
    this.setSuggestPage(0, 0)
  },

  setSuggestPage(page: number, highlight = 0) {
    const total = this._suggestAll.length
    const pages = Math.max(1, Math.ceil(total / SUGGEST_PAGE_SIZE))
    const p = Math.max(0, Math.min(page, pages - 1))
    const start = p * SUGGEST_PAGE_SIZE
    const pageItems = this._suggestAll.slice(start, start + SUGGEST_PAGE_SIZE)
    const opening = total > 0 && !this.data.suggestVisible
    const patch: Record<string, unknown> = {
      suggestVisible: total > 0,
      suggestPageItems: pageItems,
      suggestTotal: total,
      suggestPage: p,
      suggestPages: pages,
      suggestHighlight: Math.max(0, Math.min(highlight, Math.max(0, pageItems.length - 1))),
    }
    const applyBox = (box: { top: number; left: number; maxH: number; maxW: number }) => {
      if (box.top > 0) patch.suggestTop = box.top
      patch.suggestLeft = box.left
      patch.suggestMaxH = box.maxH
      patch.suggestMaxW = box.maxW
      patch.suggestListH = this.suggestListHeight(box.maxH, pages)
      this.setData(patch)
    }
    if (!opening && this.data.suggestMaxH > 0) {
      patch.suggestListH = this.suggestListHeight(this.data.suggestMaxH, pages)
      this.setData(patch)
      return
    }
    this.measurePopAnchor(applyBox)
  },

  /** 列表铺满弹出层扣掉表头和翻页条后的高度，不随条数收缩。 */
  suggestListHeight(maxH: number, pages: number) {
    if (!(maxH > 0)) return 0
    const width = (wx.getWindowInfo && wx.getWindowInfo().windowWidth) || 375
    const rpx = width / 750
    const chrome = (64 + (pages > 1 ? 72 : 0)) * rpx
    return Math.max(0, Math.round(maxH - chrome))
  },

  nameEventsLocked() {
    return Date.now() < this._nameLockUntil
  },

  /** 选中货号、跳到数量的这一小段，品名框的焦点和输入都先丢掉。 */
  lockNameEvents(ms = 560) {
    this._nameLockUntil = Date.now() + ms
    if (this._suggestTimer) {
      clearTimeout(this._suggestTimer)
      this._suggestTimer = 0
    }
  },

  armPendingQty(forceRemount = false) {
    const index = this._pendingQtyIndex
    if (index < 0 || !this.nameEventsLocked()) return
    const apply = () => {
      if (this._pendingQtyIndex !== index || !this.nameEventsLocked()) return
      this.setData({
        qtyForceIndex: index,
        qtyArmIndex: index,
        qtySelStart: 0,
        qtySelEnd: this._pendingQtyLen,
      })
    }
    if (forceRemount && this.data.qtyForceIndex === index) {
      this.setData({ qtyForceIndex: -1, qtyArmIndex: -1, qtySelStart: -1, qtySelEnd: -1 })
      setTimeout(apply, 30)
      return
    }
    apply()
  },

  /** 穿透把焦点送回品名框时，再送回数量并全选。只补一次，避免来回抢焦点。 */
  rearmQtyAfterNameSteal() {
    if (this._pendingQtyIndex < 0 || this._qtyRearmCount >= 1) return
    this._qtyRearmCount += 1
    if (this._qtyRearmTimer) clearTimeout(this._qtyRearmTimer)
    this._qtyRearmTimer = setTimeout(() => {
      this._qtyRearmTimer = 0
      this.armPendingQty(true)
    }, 40) as any
  },

  closeSuggest() {
    if (this._suggestTimer) {
      clearTimeout(this._suggestTimer)
      this._suggestTimer = 0
    }
    this._lastSuggestQuery = ''
    this._suggestAll = []
    if (!this.data.suggestVisible && !this.data.suggestPageItems.length) return
    const wasOpen = this.data.suggestVisible
    this.setData({
      suggestVisible: false,
      suggestPageItems: [],
      suggestTotal: 0,
      suggestPage: 0,
      suggestPages: 1,
      suggestHighlight: 0,
      suggestGuard: wasOpen,
    })
    if (!wasOpen) return
    if (this._suggestGuardTimer) clearTimeout(this._suggestGuardTimer)
    this._suggestGuardTimer = setTimeout(() => {
      this._suggestGuardTimer = 0
      if (this.data.suggestGuard && !this.data.suggestVisible) {
        this.setData({ suggestGuard: false })
      }
    }, 420) as any
  },

  onSuggestClose() {
    this._pickingSuggest = true
    this.closeSuggest()
  },

  onSuggestPrev() {
    this._pickingSuggest = true
    if (this.data.suggestPage <= 0) return
    this.setSuggestPage(this.data.suggestPage - 1, SUGGEST_PAGE_SIZE - 1)
  },

  onSuggestNext() {
    this._pickingSuggest = true
    if (this.data.suggestPage >= this.data.suggestPages - 1) return
    this.setSuggestPage(this.data.suggestPage + 1, 0)
  },

  onSuggestPick(e: WechatMiniprogram.TouchEvent) {
    this._pickingSuggest = true
    const code = e.currentTarget.dataset.code as string
    const hi = Number(e.currentTarget.dataset.index)
    const it = this._suggestAll.find((x) => x.code === code) || this.data.suggestPageItems[hi]
    const rowIndex = this._suggestRowIndex
    if (!it || rowIndex < 0) return
    this.lockNameEvents(560)
    this.setData({ suggestHighlight: hi })
    this.applySuggestProduct(rowIndex, it)
  },

  applySuggestProduct(index: number, it: SuggestItem) {
    const p = this._products.find((x) => x.code === it.code)
    if (p && isSkuProduct(p)) {
      this._pendingQtyIndex = -1
      this.closeSuggest()
      const target = findSameCodeIndex(this.data.rows, p.code, index)
      this.openSkuPicker(target, p)
      return
    }
    this.applyPlainProduct(index, it.code, it.name, it.unit, it.price, it.countInStats)
  },

  applyPlainProduct(
    index: number,
    code: string,
    name: string,
    unit: string,
    price: number,
    countInStats: boolean,
    sku?: { color: string; size: string },
  ) {
    const rows = this.data.rows.slice()
    const row = rows[index]
    if (!row) return
    row.productCode = code
    row.productName = code || name
    row.unit = unit || row.unit || ''
    row.priceText = this.resolveRowPrice(code, price)
    row.countInStats = countInStats
    row.color = sku?.color || ''
    row.size = sku?.size || ''
    row.spec = skuSpec(row.color, row.size)
    row.skuLines = []
    row.skuOpen = false
    row.skuCount = 0
    row.skuFoldLabel = ''
    if (!row.quantityText.trim()) {
      row.quantityText = this.data.isReturnMode ? '-1' : '1'
    } else if (this.data.isReturnMode) {
      row.quantityText = normalizeReturnQty(row.quantityText)
    }
    rows[index] = refreshRow(row)
    this.closeSuggest()
    this.focusQtyAndSelect(index, { rows })
    this.recomputeTotal(rows)
  },

  openSkuPicker(index: number, p: Product) {
    const seed = (this.data.rows[index]?.skuLines || []).map((x) => ({ ...x }))
    const skuPickTotal = seed.reduce((s, x) => s + x.qty, 0)
    const colors = p.colors || []
    const sizes = p.sizes || []
    this.closeInputKeyboard()
    this.setData({
      skuPickVisible: true,
      skuPickRow: index,
      skuPickCode: p.code,
      skuPickTitle: `${p.code} 选颜色尺码`,
      skuPickColors: colors,
      skuPickSizes: sizes,
      skuPickColor: colors[0] || '',
      skuPickSize: sizes.length === 1 ? sizes[0] : '',
      skuPickQty: '1',
      skuPickLines: seed,
      skuPickTotal,
      skuPickStockLabel: skuHint(p) || t('skuPickHint'),
      focusNameIndex: -1,
      focusQtyIndex: -1,
      qtySelStart: -1,
      qtySelEnd: -1,
    }, () => this.refreshSkuPickStock())
  },

  onSkuPickClose() {
    this.setData({
      skuPickVisible: false,
      skuPickRow: -1,
      skuPickLines: [],
      skuPickTotal: 0,
      skuPickQty: '1',
    })
  },

  onSkuPickColor(e: WechatMiniprogram.TouchEvent) {
    this.setData({ skuPickColor: String(e.currentTarget.dataset.name || '') })
    this.refreshSkuPickStock()
  },
  onSkuPickSize(e: WechatMiniprogram.TouchEvent) {
    this.setData({ skuPickSize: String(e.currentTarget.dataset.name || '') })
    this.refreshSkuPickStock()
  },
  onSkuPickQty(e: WechatMiniprogram.Input) {
    this.setData({ skuPickQty: e.detail.value })
  },

  onSkuPickQtyStep(e: WechatMiniprogram.TouchEvent) {
    const dir = Number(e.currentTarget.dataset.dir) || 0
    const next = this.parseSkuPickQty() + dir
    this.setData({ skuPickQty: String(Math.max(1, next)) })
  },

  skuPickReserved(color: string, size: string, lines?: SkuPickLine[]) {
    return (lines || this.data.skuPickLines)
      .filter((x) => x.color === color && x.size === size)
      .reduce((s, x) => s + x.qty, 0)
  },

  skuPickRemain(p: Product, color: string, size: string, lines?: SkuPickLine[]) {
    const cell = findSkuCell(p, color, size)
    if (!cell || cell.stock == null || !Number.isFinite(Number(cell.stock))) return null
    return Number(cell.stock) - this.skuPickReserved(color, size, lines)
  },

  refreshSkuPickStock() {
    const p = this._products.find((x) => x.code === this.data.skuPickCode)
    if (!p) return
    const color = this.data.skuPickColor
    const size = this.data.skuPickSize
    if (!color || !size) {
      this.setData({ skuPickStockLabel: skuHint(p) || t('skuPickHint') })
      return
    }
    const remain = this.skuPickRemain(p, color, size)
    const name = `${color} ${size}`
    if (remain == null) {
      this.setData({ skuPickStockLabel: `${name}，${t('skuUncounted')}` })
      return
    }
    this.setData({ skuPickStockLabel: `${name}，${t('skuStockLeft')} ${remain}` })
  },

  parseSkuPickQty() {
    const n = parseInt(String(this.data.skuPickQty || '').trim(), 10)
    return Number.isFinite(n) && n > 0 ? n : 1
  },

  onSkuPickAdd() {
    const color = this.data.skuPickColor
    const size = this.data.skuPickSize
    const p = this._products.find((x) => x.code === this.data.skuPickCode)
    if (!color || !size) {
      wx.showToast({ title: t('skuPickHint'), icon: 'none' })
      return
    }
    if (!p) return
    const qty = this.parseSkuPickQty()
    const remain = this.skuPickRemain(p, color, size)
    if (!this.data.isReturnMode && remain != null && qty > remain) {
      wx.showToast({ title: t('skuStockNeed'), icon: 'none' })
      return
    }
    const lines = this.data.skuPickLines.slice()
    const hit = lines.find((x) => x.color === color && x.size === size)
    if (hit) hit.qty += qty
    else {
      lines.push({
        key: `${color}-${size}-${Date.now()}`,
        color,
        size,
        spec: skuSpec(color, size),
        qty,
      })
    }
    const skuPickTotal = lines.reduce((s, x) => s + x.qty, 0)
    this.setData({ skuPickLines: lines, skuPickTotal, skuPickQty: '1' })
    this.refreshSkuPickStock()
  },

  onSkuPickRemoveLine(e: WechatMiniprogram.TouchEvent) {
    const key = String(e.currentTarget.dataset.key || '')
    const lines = this.data.skuPickLines.filter((x) => x.key !== key)
    this.setData({
      skuPickLines: lines,
      skuPickTotal: lines.reduce((s, x) => s + x.qty, 0),
    })
    this.refreshSkuPickStock()
  },

  applySkuPickLines(index: number, p: Product, lines: SkuPickLine[]) {
    const rows = this.data.rows.slice()
    const target = findSameCodeIndex(rows, p.code, index)
    if (!rows[target]) rows[target] = emptyRow(target)
    const row = rows[target]
    row.productCode = p.code
    row.productName = p.code || p.name || row.productName
    row.unit = p.unit || row.unit || ''
    row.priceText = this.resolveRowPrice(p.code, Number(p.price) || 0)
    row.countInStats = p.countInStats !== false
    row.skuLines = lines.map((x) => ({ ...x }))
    row.skuOpen = false
    rows[target] = refreshRow(decorateSkuRow(row, this.data.isReturnMode))
    if (target !== index && rows[index] && rowCodeOf(rows[index]) === p.code && !rows[index].skuCount) {
      rows[index] = emptyRow(index)
    }
    this.closeSuggest()
    this.focusQtyAndSelect(target, { rows })
    this.recomputeTotal(rows)
  },

  onToggleSku(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const rows = this.data.rows.slice()
    const row = rows[index]
    if (!row || !row.skuCount) return
    row.skuOpen = !row.skuOpen
    this.closeInputKeyboard()
    this.setData({ rows, focusNameIndex: -1, focusQtyIndex: -1 })
  },

  onSkuQtyTap(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const row = this.data.rows[index]
    if (!row || !row.skuCount) return
    const p = this._products.find((x) => x.code === rowCodeOf(row))
    if (p && isSkuProduct(p)) this.openSkuPicker(index, p)
  },

  onSkuPickConfirm() {
    const index = this.data.skuPickRow
    const p = this._products.find((x) => x.code === this.data.skuPickCode)
    let lines = this.data.skuPickLines.slice()
    if (!lines.length) {
      const color = this.data.skuPickColor
      const size = this.data.skuPickSize
      if (!color || !size) {
        wx.showToast({ title: t('skuPickHint'), icon: 'none' })
        return
      }
      if (!p) {
        this.onSkuPickClose()
        return
      }
      const qty = this.parseSkuPickQty()
      const remain = this.skuPickRemain(p, color, size)
      if (!this.data.isReturnMode && remain != null && qty > remain) {
        wx.showToast({ title: t('skuStockNeed'), icon: 'none' })
        return
      }
      lines = [{ key: 'one', color, size, spec: skuSpec(color, size), qty }]
    }
    if (!p || index < 0) {
      this.onSkuPickClose()
      return
    }
    this.setData({
      skuPickVisible: false,
      skuPickRow: -1,
      skuPickLines: [],
      skuPickTotal: 0,
      skuPickQty: '1',
    })
    this.applySkuPickLines(index, p, lines)
  },

  async lookupProductAt(index: number) {
    const rows = this.data.rows.slice()
    const row = rows[index]
    if (!row) return
    const code = stripSpokenMarks(row.productName).trim()
    if (!code) return
    if (code !== row.productName.trim()) {
      row.productName = code
      row.productCode = code
      rows[index] = refreshRow(row)
      this.setData({ rows })
    }
    const p = this._products.find(
      (x) =>
        x.code.toLowerCase() === code.toLowerCase() ||
        (x.name || '').toLowerCase() === code.toLowerCase(),
    )
    if (!p) {
      this.offerMissingProduct(code)
      return
    }
    if (isSkuProduct(p)) {
      if (row.skuCount) return
      if (row.color && row.size && row.productCode === p.code) return
      this.openSkuPicker(findSameCodeIndex(this.data.rows, p.code, index), p)
      return
    }
    this.applyPlainProduct(index, p.code, p.name || p.code, p.unit || '', Number(p.price) || 0, p.countInStats !== false, {
      color: row.color,
      size: row.size,
    })
  },

  /** 货号选定后跳到数量并全选，方便直接改数字 */
  focusQtyAndSelect(index: number, extra: Record<string, unknown> = {}) {
    const rows = (extra.rows as SheetRow[] | undefined) || this.data.rows
    const len = String(rows[index]?.quantityText || '').length
    this._pendingQtyIndex = index
    this._pendingQtyLen = Math.max(len, 0)
    this._qtyRearmCount = 0
    this.lockNameEvents(560)
    this.setData({
      ...extra,
      focusNameIndex: -1,
      focusQtyIndex: -1,
      qtyForceIndex: -1,
      qtyArmIndex: -1,
      qtySelStart: -1,
      qtySelEnd: -1,
    })
    if (this._qtyRearmTimer) {
      clearTimeout(this._qtyRearmTimer)
      this._qtyRearmTimer = 0
    }
    this._qtyRearmTimer = setTimeout(() => {
      this._qtyRearmTimer = 0
      this.armPendingQty(false)
    }, 60) as any
  },

  onTapRowNo(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ selectedIndex: this.data.selectedIndex === index ? -1 : index })
  },

  onCancelSelect() {
    this.setData({ selectedIndex: -1 })
  },

  onClearRow() {
    const i = this.data.selectedIndex
    if (i < 0) return
    this.clearSheetRowAt(i, { toast: false })
  },

  onDeleteRow() {
    const i = this.data.selectedIndex
    if (i < 0) return
    this.deleteSheetRowAt(i, { toast: false })
  },

  clearSheetRowAt(index: number, opts?: { toast?: boolean }) {
    const i = Number(index)
    if (!Number.isFinite(i) || i < 0 || i >= this.data.rows.length) {
      this.showTopToast('没有这一行', 2000)
      return
    }
    this.snapshotUndo()
    const rows = this.data.rows.slice()
    rows[i] = emptyRow(i)
    this.setData({ rows, selectedIndex: -1 })
    this.recomputeTotal(rows)
    if (opts?.toast !== false) this.showTopToast(`已清空第${i + 1}行`, 2000)
  },

  deleteSheetRowAt(index: number, opts?: { toast?: boolean }) {
    const i = Number(index)
    if (!Number.isFinite(i) || i < 0 || i >= this.data.rows.length) {
      this.showTopToast('没有这一行', 2000)
      return
    }
    this.snapshotUndo()
    const rows = this.data.rows.slice()
    rows.splice(i, 1)
    if (rows.length < DEFAULT_ROWS) {
      while (rows.length < DEFAULT_ROWS) rows.push(emptyRow(rows.length))
    }
    this.setData({ rows, selectedIndex: -1 })
    this.recomputeTotal(rows)
    if (opts?.toast !== false) this.showTopToast(`已删除第${i + 1}行`, 2000)
  },

  onTogglePaid() {
    this.setData({ isPaid: !this.data.isPaid })
  },
  onTogglePicked() {
    this.setData({ isPickedUp: !this.data.isPickedUp })
  },

  openTrackingScan() {
    const initial = (this.data.trackingNos || []).slice()
    wx.navigateTo({
      url: '/pages/tracking-scan/tracking-scan',
      events: {
        done: (data: { nos?: string[] }) => {
          const nos = Array.isArray(data?.nos)
            ? data.nos.map((n) => String(n).trim()).filter(Boolean)
            : []
          this.setData({
            trackingNos: nos,
            isShipped: true,
            shippedLabel: nos.length ? `${t('shipped')}(${nos.length})` : t('shipped'),
          })
        },
      },
      success: (res) => {
        res.eventChannel.emit('init', { nos: initial })
      },
    })
  },

  onToggleShipped() {
    this.closeInputKeyboard()
    // 已发货且无单号：再点提供「取消已发货」入口（对齐 App）
    if (this.data.isShipped && !(this.data.trackingNos || []).length) {
      wx.showActionSheet({
        itemList: ['录入/扫描快递单号', '取消已发货状态'],
        itemColor: '#000000',
        success: (res) => {
          if (res.tapIndex === 0) this.openTrackingScan()
          if (res.tapIndex === 1) {
            this.setData({
              isShipped: false,
              trackingNos: [],
              shippedLabel: t('shipped'),
            })
          }
        },
      })
      return
    }
    this.openTrackingScan()
  },

  onRemoveTracking(e: WechatMiniprogram.TouchEvent) {
    const no = String(e.currentTarget.dataset.no || '')
    const next = (this.data.trackingNos || []).filter((n) => n !== no)
    this.setData({
      trackingNos: next,
      shippedLabel: next.length ? `${t('shipped')}(${next.length})` : t('shipped'),
      // 删光单号即取消已发货（对齐 App）
      isShipped: next.length > 0,
    })
  },

  onToggleDelivered() {
    this.closeInputKeyboard()
    this.setTabBarHidden(true)
    this.setData({ delivSheetVisible: true })
  },

  onDelivSheetClose() {
    this.setData({ delivSheetVisible: false })
    this.setTabBarHidden(false)
  },

  async onDelivPick(e: WechatMiniprogram.TouchEvent) {
    const action = String(e.currentTarget.dataset.action || '')
    if (action === 'clear') {
      this.setData({
        delivSheetVisible: false,
        deliveryPhotoPath: '',
        isDelivered: false,
      })
      this.setTabBarHidden(false)
      return
    }
    if (action !== 'camera' && action !== 'album') return
    this.setData({ delivSheetVisible: false })
    this.setTabBarHidden(false)
    try {
      const temp = await pickDeliveryImage(action)
      await this.persistDeliveryPhoto(temp)
    } catch (err: any) {
      if (String(err?.message || err) === 'cancel') return
      wx.showToast({
        title: String(err?.message || '选择图片失败').slice(0, 40),
        icon: 'none',
      })
    }
  },

  async persistDeliveryPhoto(tempPath: string) {
    if (!(await assertMediaCheckAsync({ filePath: tempPath, mediaType: 2 }))) return
    const dest = persistDeliveryLocalPath(tempPath)
    this.setData({ deliveryPhotoPath: dest, isDelivered: true })
  },

  onPreviewDeliveryPhoto() {
    const path = this.data.deliveryPhotoPath
    if (!path) return
    wx.previewImage({ urls: [path], current: path })
  },

  async onExportImage() {
    this.closeInputKeyboard()
    const items = this.buildCartItems()
    if (!items.length) {
      this.showTopToast('请先开单')
      return
    }
    if (!(await this.assertBillingInputsSafe())) return
    const { totalQuantity, totalAmount } = this.buildTotals(items)
    const session = getSession()
    const handler =
      (session?.team?.displayName || '').trim() ||
      (session?.phone || '').trim()
    let orderNo = this._editingOrderNo || genOrderNo()
    const isReturn = !!this.data.isReturnMode

    // 分享查账前先落云，扫码看到的是档口当前账本
    let shareReady = false
    let shareToken = ''
    if (isLoggedIn() && !isGuest()) {
      try {
        const saved = await this.saveOrder({ asReturn: isReturn })
        if (saved.ok && saved.orderNo) {
          orderNo = saved.orderNo
          this._editingOrderNo = orderNo
        }
      } catch (_) {}
      try {
        wx.showLoading({ title: t('shareLookupPreparing'), mask: true })
        const share = await mintLookupShare(orderNo)
        shareReady = share.ok && !!share.token
        shareToken = share.token
      } catch (_) {
      } finally {
        try {
          wx.hideLoading()
        } catch (_) {}
      }
    }

    // 优先拉云端收款码（商家在 App 配置后同步到小程序）
    let tpl = loadPrintTemplate()
    try {
      const pulled = await pullPrintTemplateFromCloud()
      if (pulled.ok && pulled.applied) tpl = pulled.template
      else tpl = loadPrintTemplate()
    } catch (_) {
      tpl = loadPrintTemplate()
    }

    const qr = await extraReceiptQr(tpl, orderNo, isReturn, this.data.shop)
    const printFlags = receiptPrintFlags(this.data.customerName, isReturn)

    const shopName = receiptShopTitle(
      this.data.shop?.shopName,
      tpl.headerTitle,
      isGuest() || !isLoggedIn(),
    )
    const receiptModel = buildReceiptRenderModel({
      templateId: tpl.template,
      shopName,
      isReturn,
      orderNo,
      dateStr: this.data.dateStr,
      customerName: this.data.customerName || '',
      customerPhone: this.data.customerPhone || '',
      handler,
      items,
      totalQuantity,
      totalAmount,
      footer: (tpl.footerText || this.data.shop?.footer || '').trim(),
      shopAddress: String(this.data.shop?.address || '').trim(),
      shopPhone: String(this.data.shop?.phone || '').trim(),
      ...qr,
      ...printFlags,
    })
    const qrBlockH = estimateQrBlockH(receiptModel)
    const canvasH = estimateReceiptCanvasHeight(receiptModel.templateId, items.length, qrBlockH, items)

    this.setData({
      expVisible: true,
      expTitle: isReturn ? t('exportReturnImage') : t('exportSaleImage'),
      expReceiptModel: receiptModel,
      expFontScale: receiptFontScale(),
      expIsReturn: isReturn,
      expSaving: false,
      expCanvasH: Math.max(560, canvasH),
      expShareReady: false,
      expShareToken: shareToken,
      expShareShop: shopName,
      expShareOrderNo: orderNo,
      expShareImage: '',
    })
    try {
      wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
    } catch (_) {}
    void this.prepareExportShareCover().finally(() => {
      this.setData({ expShareReady: shareReady && !!shareToken })
    })
  },

  async prepareExportShareCover() {
    const model = this.data.expReceiptModel as ReceiptRenderModel
    if (!model?.layoutKind) return
    try {
      const painted = await renderReceiptCanvas(this, model, {
        canvasH: this.data.expCanvasH,
        shareCover: true,
      })
      if (painted.path) this.setData({ expShareImage: painted.path })
    } catch (_) {}
  },

  onExportShareTap() {
    if (this.data.expShareReady && this.data.expShareToken) return
    if (!isLoggedIn() || isGuest()) {
      wx.showToast({ title: t('shareLookupNeedLogin'), icon: 'none' })
      return
    }
    wx.showToast({ title: t('shareLookupFail'), icon: 'none' })
  },

  async ensureMerchantInviteToken() {
    if (this.data.merchantInviteToken) return
    const minted = await mintMerchantOpenInvite()
    if (minted.ok && minted.token) {
      this.setData({
        merchantInviteToken: minted.token,
        inviteStatsHint: merchantInviteStatsHint(minted.stats),
      })
    }
  },

  onInviteRules() {
    wx.navigateTo({ url: '/pages/legal/legal?type=invite' })
  },

  onShareAppMessage(e: WechatMiniprogram.ShareAppMessageOption) {
    const dataset = (e.target && (e.target as { dataset?: { kind?: string; shop?: string } }).dataset) || {}
    const kind = String(dataset.kind || '')
    if (kind === 'merchantRenew') return merchantRenewShare(dataset.shop)
    const merchantTok = String(this.data.merchantInviteToken || '').trim()
    const token = String(this.data.expShareToken || '').trim()
    if (token && this.data.expVisible) {
      const imageUrl = String(this.data.expShareImage || '').trim()
      return {
        title: lookupShareTitle(this.data.expShareShop, this.data.expShareOrderNo),
        path: lookupSharePath(token),
        ...(imageUrl ? { imageUrl } : {}),
      }
    }
    if (this.data.agentMode || kind === 'merchantOpen' || e.from === 'button') {
      const name = this.data.agentMode
        ? String(
            this.data.agentCustomerName ||
              this._agentBindings[0]?.customerName ||
              this.data.guestNick ||
              '',
          ).trim()
        : String(this.data.shop?.shopName || '').trim()
      return merchantOpenShareMessage(merchantTok, name)
    }
    const shop = this.data.shop?.shopName || t('brand')
    return { title: shop || t('shareStallTitle'), path: '/pages/home/home' }
  },

  onShareTimeline() {
    if (this.data.agentMode) return { title: t('agentHello') }
    if (this.data.guestMode || isGuest() || !isLoggedIn()) return { title: t('brand') }
    const shop = String(this.data.shop?.shopName || '').trim()
    return { title: shop || t('brand') }
  },

  onExportClose() {
    if (this.data.expSaving) return
    this.setData({
      expVisible: false,
      expShareReady: false,
      expShareToken: '',
      expShareOrderNo: '',
      expShareImage: '',
    })
  },

  /** 下载预览里去票据预览，在那里选本机打印或云打印。 */
  onExportPrint() {
    if (this.data.expSaving || this.data.saving || this.data.printing) return
    this.setData({ expVisible: false })
    void this.openReceiptPreview({
      asReturn: !!this.data.isReturnMode || !!this.data.expIsReturn,
    })
  },

  async onExportSave() {
    if (this.data.expSaving) return
    this.setData({ expSaving: true })
    try {
      await this.ensureAlbumAuth()
      const path = await this.renderExportCanvas()
      await new Promise<void>((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: path,
          success: () => resolve(),
          fail: (err) => reject(err),
        })
      })
      this.setData({ expVisible: false, expSaving: false })
      this.showTopToast('已保存到相册，可在图库 / 相册中查看', 3000)
    } catch (e: any) {
      this.setData({ expSaving: false })
      const msg = String(e?.errMsg || e?.message || e || '保存失败')
      if (msg.includes('auth deny') || msg.includes('authorize')) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许保存到相册',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) wx.openSetting({})
          },
        })
      } else {
        this.showTopToast(`保存失败: ${msg}`, 3000)
      }
    }
  },

  ensureAlbumAuth(): Promise<void> {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (res) => {
          if (res.authSetting['scope.writePhotosAlbum']) {
            resolve()
            return
          }
          wx.authorize({
            scope: 'scope.writePhotosAlbum',
            success: () => resolve(),
            fail: () => reject(new Error('authorize deny')),
          })
        },
        fail: reject,
      })
    })
  },

  renderExportCanvas(): Promise<string> {
    const model = this.data.expReceiptModel as ReceiptRenderModel
    if (!model?.layoutKind) return Promise.reject(new Error('预览数据未就绪'))
    return renderReceiptCanvas(this, model, { canvasH: this.data.expCanvasH }).then((r) => r.path)
  },

  onExitReturn(): Promise<void> {
    if (!this.data.isReturnMode) return Promise.resolve()
    const rows = this.data.rows.map((r) => {
      if (!r.productName.trim() && !r.quantityText.trim()) return r
      const q = parseFloat(r.quantityText)
      if (!Number.isFinite(q) || q >= 0) return r
      const abs = Math.abs(q)
      const next = {
        ...r,
        quantityText: abs === Math.round(abs) ? String(Math.round(abs)) : String(abs),
      }
      return refreshRow(next)
    })
    this._returnReason = ''
    // 恢复进入退单前的备注，避免销售单带上「【日期退单】」
    const restored = this._remarkBeforeReturn || ''
    this._remarkBeforeReturn = ''
    return new Promise((resolve) => {
      this.setData(
        {
          isReturnMode: false,
          rows,
          remark: isAutoReturnRemark(restored) ? '' : restored,
        },
        () => {
          this.recomputeTotal(rows)
          void this.refreshBillHead()
          wx.showToast({ title: '已退出退单模式', icon: 'none' })
          resolve()
        },
      )
    })
  },

  /** 更换客户名时自动退出退单（须在写入新客户名之前调用） */
  exitReturnIfCustomerChanged(nextName: string) {
    if (!this.data.isReturnMode) return
    const prev = (this.data.customerName || '').trim()
    const next = String(nextName || '').trim()
    if (prev === next) return
    this.onExitReturn()
  },

  pickReturnReason(): Promise<string | null> {
    this.closeInputKeyboard()
    const options = returnReasonLabels()
    return new Promise((resolve) => {
      this._reasonPickResolve = resolve
      this.setData({
        returnReasonVisible: true,
        returnReasonOptions: options,
      })
    })
  },

  onReturnReasonCancel() {
    this.setData({ returnReasonVisible: false })
    if (this._reasonPickResolve) {
      const resolve = this._reasonPickResolve
      this._reasonPickResolve = null
      resolve(null)
    }
  },

  onReturnReasonPick(e: WechatMiniprogram.TouchEvent) {
    const reason = String(e.currentTarget.dataset.reason || '').trim()
    this.setData({ returnReasonVisible: false })
    if (this._reasonPickResolve) {
      const resolve = this._reasonPickResolve
      this._reasonPickResolve = null
      resolve(reason || null)
    }
  },

  /** 进入退单模式：数量转负、写备注；保留当前单价（不回落到商品库价） */
  async enterReturnMode(reason: string): Promise<void> {
    this.snapshotUndo()
    const reasonText = (reason || '').trim() || '其他'
    this._returnReason = reasonText
    // 退单始终另存新单，避免把原销售单改成退单或带上旧快照价
    this.clearEditingBind()
    this._remarkBeforeReturn = this.data.remark || ''

    const session = getSession()
    const handler =
      (session?.team?.displayName || '').trim() ||
      (session?.phone || '').trim()
    const dateLabel = this.data.dateStr || todayStr()
    let remark = `【${dateLabel}退单】`
    if (handler) remark += `经办：${handler}`

    const rows = this.data.rows.map((r) => {
      if (!r.productName.trim() && !r.quantityText.trim()) return r
      // 只改数量符号，单价保持开单页当前值
      const next = {
        ...r,
        quantityText: normalizeReturnQty(r.quantityText || '-1'),
      }
      return refreshRow(next)
    })

    await new Promise<void>((resolve) => {
      this.placeMore(
        {
          isReturnMode: true,
          rows,
          remark,
          isPaid: false,
        },
        () => resolve(),
      )
    })
    this.recomputeTotal(rows)
    void this.refreshBillHead()
  },

  onStockIn() {
    this.closeMore()
    this.openStockAdjust(true)
  },
  onStockOut() {
    this.closeMore()
    this.openStockAdjust(false)
  },

  openStockAdjust(stockIn: boolean) {
    this.closeInputKeyboard()
    if (!this._products.length) {
      const cached = peekCachedCatalog()
      if (cached.length) this._products = cached
    }
    this.setData({
      stkVisible: true,
      stkIn: stockIn,
      stkTitle: stockIn ? '商品入库' : '商品出库',
      stkKeyword: '',
      stkSelectedCode: '',
      stkSelectedLabel: '',
      stkQty: '1',
      stkRemark: '',
      stkSubmitting: false,
      stkCanSubmit: false,
    })
    this.refreshStockRows()
    if (!this._products.length) {
      void fetchCatalog().then((r) => {
        if (r.ok) {
          this._products = r.products || []
          this.refreshStockRows()
        }
      })
    }
  },

  refreshStockRows() {
    const q = (this.data.stkKeyword || '').trim().toLowerCase()
    let list = this._products.slice()
    if (q) {
      list = list.filter(
        (p) =>
          (p.code || '').toLowerCase().includes(q) ||
          (p.name || '').toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q),
      )
    }
    list = list.slice(0, 80)
    const sel = this.data.stkSelectedCode
    const rows = list.map((p) => {
      const parts = [
        p.code || '',
        p.unit ? String(p.unit) : '',
        (() => {
          const n = displayStock(p)
          const hint = skuHint(p)
          if (n == null && !hint) return ''
          if (hint) return n == null ? hint : `库存 ${n} · ${hint}`
          return `库存 ${n}`
        })(),
      ].filter(Boolean)
      return {
        code: p.code,
        name: p.name || p.code,
        subtitle: parts.join(' · '),
        selected: p.code === sel,
      }
    })
    this.setData({ stkRows: rows })
  },

  onStkKeyword(e: WechatMiniprogram.Input) {
    this.setData({ stkKeyword: e.detail.value })
    this.refreshStockRows()
  },

  onStkClearKeyword() {
    this.setData({ stkKeyword: '' })
    this.refreshStockRows()
  },

  onStkSelect(e: WechatMiniprogram.TouchEvent) {
    const code = String(e.currentTarget.dataset.code || '')
    const p = this._products.find((x) => x.code === code)
    if (!p) return
    const n = displayStock(p)
    const hint = skuHint(p)
    const stockPart = n != null ? `  库存 ${n}` : hint ? `  ${hint}` : '  库存未设'
    this.setData({
      stkSelectedCode: code,
      stkSelectedLabel: `已选：${p.name || p.code}（${p.code}）${stockPart}`,
      stkCanSubmit: !isSkuProduct(p),
      stkQty: this.data.stkQty || '1',
      stkColor: '',
      stkSize: '',
      stkNeedSku: isSkuProduct(p),
      stkColors: p.colors || [],
      stkSizes: p.sizes || [],
    })
    this.refreshStockRows()
  },

  onStkColor(e: WechatMiniprogram.TouchEvent) {
    const stkColor = String(e.currentTarget.dataset.name || '')
    this.setData({ stkColor, stkCanSubmit: !!(stkColor && this.data.stkSize) })
  },
  onStkSize(e: WechatMiniprogram.TouchEvent) {
    const stkSize = String(e.currentTarget.dataset.name || '')
    this.setData({ stkSize, stkCanSubmit: !!(this.data.stkColor && stkSize) })
  },

  onStkQty(e: WechatMiniprogram.Input) {
    this.setData({ stkQty: e.detail.value })
  },

  onStkRemark(e: WechatMiniprogram.Input) {
    this.setData({ stkRemark: e.detail.value })
  },

  onStkClose() {
    if (this.data.stkSubmitting) return
    this.setData({
      stkVisible: false,
      stkKeyword: '',
      stkSelectedCode: '',
      stkSelectedLabel: '',
      stkRows: [],
      stkNeedSku: false,
      stkColor: '',
      stkSize: '',
    })
  },

  async onStkSubmit() {
    if (this.data.stkSubmitting || !this.data.stkCanSubmit) return
    const code = this.data.stkSelectedCode
    const p = this._products.find((x) => x.code === code)
    if (!p) {
      this.showTopToast('请先选择商品')
      return
    }
    const qty = parseInt(String(this.data.stkQty || '').trim(), 10)
    if (!Number.isFinite(qty) || qty <= 0) {
      this.showTopToast('请输入有效数量')
      return
    }
    const skuOn = isSkuProduct(p)
    const color = this.data.stkColor
    const size = this.data.stkSize
    if (skuOn && (!color || !size)) {
      this.showTopToast('请先选颜色和尺码')
      return
    }
    const cell = skuOn ? findSkuCell(p, color, size) : null
    const before = skuOn
      ? cell?.stock != null
        ? Number(cell.stock)
        : 0
      : p.stock != null
        ? Number(p.stock)
        : 0
    const delta = this.data.stkIn ? qty : -qty
    const after = before + delta
    if (after < 0) {
      this.showTopToast('库存不足，无法出库')
      return
    }
    if (!(await assertMsgSecCheck([this.data.stkRemark, p.code, p.name]))) return
    this.setData({ stkSubmitting: true })
    const remark = (this.data.stkRemark || '').trim()
    const mv: StockMovement = {
      cloudUid: genJobNo(),
      productCode: p.code,
      productName: p.name || p.code,
      type: this.data.stkIn ? 'in' : 'out',
      quantity: delta,
      stockBefore: before,
      stockAfter: after,
      color: color || undefined,
      size: size || undefined,
      remark: remark || null,
      createdAt: new Date().toISOString(),
    }
    const up = await uploadStockMovements([mv])
    if (!up.ok) {
      this.setData({ stkSubmitting: false })
      this.showTopToast(up.error || '操作失败', 3000)
      return
    }
    const updated: Product = applySkuStock(p, delta, color, size)
    const patch = await patchCatalog([updated])
    if (!patch.ok) {
      this.setData({ stkSubmitting: false })
      this.showTopToast(patch.error || '库存更新失败', 3000)
      return
    }
    this._products = this._products.map((x) => (x.code === code ? updated : x))
    const wasIn = this.data.stkIn
    this.setData({
      stkSubmitting: false,
      stkVisible: false,
      stkKeyword: '',
      stkSelectedCode: '',
      stkSelectedLabel: '',
      stkRows: [],
    })
    this.showTopToast(wasIn ? '入库成功' : '出库成功')
  },

  onRestore() {
    this.closeMore()
    if (!this._undoSnapshot) {
      wx.showToast({ title: '没有可恢复的内容', icon: 'none' })
      return
    }
    const rows = this._undoSnapshot.map((r) => ({ ...r }))
    this.setData({ rows })
    this.recomputeTotal(rows)
    wx.showToast({ title: '已恢复', icon: 'success' })
  },

  onClear() {
    const hasContent = this.data.rows.some(
      (r) =>
        !!(r.productName || '').trim() ||
        !!(r.productCode || '').trim() ||
        !!(r.unit || '').trim() ||
        !!(r.quantityText || '').trim() ||
        !!(r.priceText || '').trim() ||
        !!(r.spec || '').trim() ||
        !!(r.color || '').trim() ||
        !!(r.size || '').trim() ||
        (r.skuLines || []).length > 0,
    )
    const hasFulfill =
      !!this.data.isPaid ||
      !!this.data.isPickedUp ||
      !!this.data.isShipped ||
      !!this.data.isDelivered ||
      !!(this.data.deliveryPhotoPath || '').trim() ||
      (this.data.trackingNos || []).length > 0 ||
      !!(this.data.remark || '').trim() ||
      !!this.data.isReturnMode
    if (!hasContent && !hasFulfill) {
      wx.showToast({ title: '当前无内容', icon: 'none' })
      return
    }
    this.snapshotUndo()
    this.resetRows()
    this.clearEditingBind()
    this._returnReason = ''
    this._remarkBeforeReturn = ''
    this.setData({
      remark: '',
      isReturnMode: false,
      isPaid: false,
      isPickedUp: false,
      isShipped: false,
      isDelivered: false,
      deliveryPhotoPath: '',
      delivSheetVisible: false,
      trackingNos: [],
      shippedLabel: t('shipped'),
      selectedIndex: -1,
    })
    void this.refreshBillHead()
    wx.showToast({ title: '已清空', icon: 'none' })
  },

  setTabBarHidden(hidden: boolean) {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ hidden: !!hidden })
    }
  },

  onOpenStats() {
    this.closeMore()
    wx.navigateTo({
      url: '/pages/analytics/analytics',
      fail: () => this.showTopToast('无法打开统计', 2000),
    })
  },

  onAi() {
    this.closeInputKeyboard()
    this.closeMore()
    if (!requireCloudSync('ai')) return
    this.setTabBarHidden(true)
    this.setData({ aiVisible: true, aiLoading: false })
    wx.nextTick(() => this.measureAiBox())
  },

  onAiClose() {
    if (this.data.aiLoading) return
    this.setData({ aiVisible: false })
    this.setTabBarHidden(false)
  },

  onAiClear() {
    if (this.data.aiLoading) return
    this._aiContentH = 0
    this._aiScrollH = 0
    this._aiScrollTop = 0
    this.setData({ aiText: '', aiOverflow: false, aiScrollTop: 0, aiThumbY: 0 })
  },

  measureAiBox(retry = 1) {
    wx.createSelectorQuery()
      .select('.ai-text-scroll')
      .boundingClientRect((rect: any) => {
        const h = rect && !Array.isArray(rect) ? Number(rect.height) || 0 : 0
        if (h > 0) {
          this._aiViewH = h
          this.paintAiRail()
          return
        }
        if (retry > 0) setTimeout(() => this.measureAiBox(retry - 1), 50)
      })
      .exec()
  },

  onAiLine(e: any) {
    this._aiContentH = Number(e?.detail?.height) || 0
    this.paintAiRail()
  },

  onAiScroll(e: any) {
    const d = e?.detail || {}
    this._aiScrollTop = Number(d.scrollTop) || 0
    if (d.scrollHeight) this._aiScrollH = Number(d.scrollHeight) || 0
    this.paintAiRail()
  },

  paintAiRail() {
    const view = this._aiViewH || 140
    const content = Math.max(this._aiContentH || 0, this._aiScrollH || 0)
    const overflow = content > view + 8
    const max = Math.max(content - view, 1)
    const thumb = Math.max(28, Math.round((view * view) / Math.max(content, view)))
    const room = Math.max(view - thumb, 0)
    const y = overflow ? Math.round(((this._aiScrollTop || 0) / max) * room) : 0
    if (
      this.data.aiOverflow === overflow &&
      this.data.aiThumbH === thumb &&
      this.data.aiThumbY === y
    ) {
      return
    }
    this.setData({ aiOverflow: overflow, aiThumbH: thumb, aiThumbY: y })
  },

  onAiRailStart(e: any) {
    const t = e?.touches && e.touches[0]
    if (!t) return
    this._aiDragY = t.clientY
    this._aiDragTop = this._aiScrollTop || 0
  },

  onAiRailMove(e: any) {
    const t = (e?.touches && e.touches[0]) || (e?.changedTouches && e.changedTouches[0])
    if (!t) return
    const view = this._aiViewH || 140
    const content = Math.max(this._aiContentH || 0, this._aiScrollH || 0)
    const max = Math.max(content - view, 0)
    const dy = t.clientY - (this._aiDragY || t.clientY)
    const top = Math.max(0, Math.min(max, (this._aiDragTop || 0) + (dy * content) / Math.max(view, 1)))
    this._aiScrollTop = top
    this.paintAiRail()
    if (Math.abs(top - (Number(this.data.aiScrollTop) || 0)) >= 1) {
      this.setData({ aiScrollTop: top })
    }
  },

  onAiText(e: WechatMiniprogram.Input | WechatMiniprogram.TextareaInput) {
    this.setData({ aiText: e.detail.value })
  },

  onAiAlbum() {
    if (this.data.aiLoading) return
    if (!requireCloudSync('ai')) return
    void this.pickAiImage('album')
  },

  onAiCamera() {
    if (this.data.aiLoading) return
    if (!requireCloudSync('ai')) return
    void this.pickAiImage('camera')
  },

  async pickAiImage(source: 'album' | 'camera') {
    try {
      const choose = await new Promise<WechatMiniprogram.MediaFile[]>((resolve, reject) => {
        const fail = (err: any) => reject(err)
        const okMedia = (res: WechatMiniprogram.ChooseMediaSuccessCallbackResult) => {
          resolve(res.tempFiles || [])
        }
        if (typeof wx.chooseMedia === 'function') {
          wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sourceType: [source],
            sizeType: ['original'],
            success: okMedia,
            fail: (err) => {
              // 部分机型 chooseMedia 异常时回退 chooseImage
              wx.chooseImage({
                count: 1,
                sizeType: ['original'],
                sourceType: [source],
                success: (r) =>
                  resolve((r.tempFilePaths || []).map((p) => ({ tempFilePath: p } as any))),
                fail,
              })
            },
          })
        } else {
          wx.chooseImage({
            count: 1,
            sizeType: ['original'],
            sourceType: [source],
            success: (r) =>
              resolve((r.tempFilePaths || []).map((p) => ({ tempFilePath: p } as any))),
            fail,
          })
        }
      })
      const picked = choose?.[0]
      const path = picked?.tempFilePath
      if (!path) {
        wx.showToast({ title: '未选择图片', icon: 'none' })
        return
      }
      const compressed = await compressOriginalPhoto(path, Number(picked?.size) || 0)
      const b64 = await new Promise<string>((resolve, reject) => {
        wx.getFileSystemManager().readFile({
          filePath: compressed,
          encoding: 'base64',
          success: (r) => resolve(String(r.data || '')),
          fail: reject,
        })
      })
      if (!b64) {
        wx.showToast({ title: '读取图片失败', icon: 'none' })
        return
      }
      if (!(await assertMediaCheckAsync({ imageBase64: b64, mediaType: 2 }))) return
      this.setData({ aiLoading: true, aiText: '' })
      wx.showLoading({ title: '识别图片文字', mask: true })
      const mime = /\.png$/i.test(compressed) ? 'image/png' : 'image/jpeg'
      let r: Awaited<ReturnType<typeof extractOrderImage>>
      try {
        r = await extractOrderImage(b64, [], mime)
      } finally {
        wx.hideLoading()
        this.setData({ aiLoading: false })
      }
      if (!r.ok) {
        this.showTopToast(r.error || '识图失败', 3000)
        return
      }
      this.setData({ aiText: r.ocrText || '' })
      wx.nextTick(() => this.measureAiBox())
      this.showTopToast(
        r.ocrText ? '已识别图中文字，请核对后点识别并填入' : '图中未识别到文字',
        2800,
      )
    } catch (e: any) {
      this.setData({ aiLoading: false })
      const msg = String(e?.errMsg || e?.message || '')
      if (/cancel|取消/i.test(msg)) return
      this.showTopToast(msg.slice(0, 28) || '选图失败', 2500)
    }
  },

  applyAiItems(items: AiItem[], opts?: { toast?: string }) {
    const detail = items.filter((it) => it.color || it.size || (it.hands || 0) > 0)
    const plain = items.filter((it) => !it.color && !it.size && !(it.hands && it.hands > 0))
    if (!detail.length && !plain.length) {
      this.showTopToast(opts?.toast || '未识别到货号', 2500)
      return
    }
    this.snapshotUndo()
    if (detail.length) {
      this.applyVoiceMatrix(linesFromLlmItems(detail, this._products), undefined, true)
    }
    if (!plain.length) {
      this.showTopToast(opts?.toast || `已填入 ${detail.length} 个货号，请核对`, 2500)
      return
    }
    const rows = this.data.rows.slice()
    let filled = detail.length
    for (const it of plain) {
      const code = stripSpokenMarks(String(it.code || '')).trim()
      if (!code) continue
      const exist = findSameCodeIndex(rows, code, -1)
      const p = this._products.find((x) => x.code === code)
      const qty = this.data.isReturnMode ? -Math.abs(it.quantity) : Math.abs(it.quantity)
      const catalogPrice = p ? Number(p.price) || 0 : 0
      if (exist >= 0) {
        const row = rows[exist]
        const cur = parseFloat(row.quantityText) || 0
        row.quantityText = fmtNum(cur + qty)
        rows[exist] = refreshRow(row)
        filled += 1
        continue
      }
      let idx = rows.findIndex((x) => !x.productName.trim())
      if (idx < 0) {
        rows.push(emptyRow(rows.length))
        idx = rows.length - 1
      }
      rows[idx] = refreshRow({
        ...rows[idx],
        productCode: code,
        productName: code,
        unit: p?.unit || '',
        quantityText: fmtNum(qty),
        priceText: this.resolveRowPrice(code, catalogPrice),
        countInStats: p?.countInStats !== false,
      })
      filled += 1
    }
    this.placeMore({
      rows,
      aiVisible: false,
    })
    this.setTabBarHidden(false)
    this.recomputeTotal(rows)
    const toast =
      opts?.toast != null
        ? opts.toast
        : filled > 0
          ? `已识别 ${filled} 个货号并填入`
          : '未识别到货号'
    this.showTopToast(toast, 2500)
    const missing = plain.find((it) => {
      const code = stripSpokenMarks(String(it.code || '')).trim().toLowerCase()
      if (!code) return false
      return !this._products.some((x) => String(x.code || '').trim().toLowerCase() === code)
    })
    if (missing) this.offerMissingProduct(missing.code, true)
  },

  async onAiSubmit() {
    if (this.data.aiLoading) return
    if (!requireCloudSync('ai')) return
    const text = (this.data.aiText || '').trim()
    if (!text) {
      wx.showToast({ title: '请先粘贴订货文字或拍照识图', icon: 'none' })
      return
    }
    if (!(await assertMsgSecCheck([text]))) return
    const local = parseWrittenSkuBill(text, this._products)
    if (local.length) {
      this.snapshotUndo()
      this.applyVoiceMatrix(local, undefined, true)
      this.setData({ aiVisible: false, aiLoading: false })
      this.setTabBarHidden(false)
      const codes = new Set(local.map((line) => String(line.code || '').toUpperCase()))
      this.showTopToast(`已填入 ${codes.size} 个货号的色码`, 1800)
      return
    }
    this.setData({ aiLoading: true })
    const codes = this._products.map((p) => p.code)
    const r = await extractOrderText(text, codes)
    this.setData({ aiLoading: false })
    if (!r.ok) {
      this.showTopToast(r.error || '识别失败', 3000)
      return
    }
    if (!r.items.length && !(r.ambiguous || []).length) {
      this.showTopToast('未识别到货号，请检查粘贴内容', 3000)
      return
    }
    if (this.takeAmbiguousSku(r.ambiguous, r.items, '', [])) return
    this.applyAiItems(r.items)
  },

  onVoiceFabError(e: WechatMiniprogram.CustomEvent<{ msg?: string }>) {
    this.showTopToast(String(e.detail?.msg || '语音识别失败'), 2500)
  },

  onVoiceFabTranscript(e: WechatMiniprogram.CustomEvent<{ text?: string }>) {
    void this.onVoiceTranscript(String(e.detail?.text || ''))
  },

  closeVoiceAsk() {
    this._voiceAsk = null
    if (this.data.voiceAskVisible) {
      this.setData({ voiceAskVisible: false, voiceAskMsg: '', voiceAskChoices: [] })
    }
  },

  openVoiceAsk(state: VoiceAskState) {
    this.closeInputKeyboard()
    this._voiceAsk = state
    const header = Number(this.data.headerHeight) || (Number(this.data.statusBarHeight) || 20) + (Number(this.data.navBarHeight) || 44)
    this.setData({
      voiceAskVisible: true,
      voiceAskMsg: state.msg,
      voiceAskChoices: state.choices,
      voiceAskTop: header + 8,
    })
  },

  askSpokenCustomers(
    names: string[],
    after: '' | 'prices' | 'statement' = '',
    from = '',
    to = '',
  ) {
    const choices = names.map((name) => String(name || '').trim()).filter(Boolean)
    if (choices.length < 2) return
    this.openVoiceAsk({
      kind: 'customer',
      msg: `${choices.join(' 还是 ')}？`,
      choices: choices.map((name) => ({ id: name, label: name })),
      items: [],
      customerName: '',
      actions: [],
      qty: 0,
      qtySpoken: false,
      color: '',
      size: '',
      spoken: '',
      lastOrderItems: [],
      customerAfter: after,
      from,
      to,
    })
  },

  takeAmbiguousSku(
    ambiguous: Array<{ spoken: string; codes: string[]; quantity: number; color?: string; size?: string; qtySpoken?: boolean }> | undefined,
    items: AiItem[],
    customerName: string,
    actions: VoiceDeskAction[],
  ) {
    const first = (ambiguous || []).find((row) => row.codes.length > 1)
    if (!first) return false
    if (items.length) this.applySettledLocal(items, customerName)
    this.openVoiceAsk({
      kind: 'sku',
      msg: `${first.codes.join(' 还是 ')}？`,
      choices: first.codes.map((c) => ({ id: c, label: c })),
      items: [],
      customerName,
      actions,
      qty: first.quantity,
      qtySpoken: !!first.qtySpoken,
      color: first.color || '',
      size: first.size || '',
      spoken: first.spoken,
      lastOrderItems: [],
    })
    return true
  },

  onVoiceAskCancel() {
    this.closeVoiceAsk()
    this.showTopToast('已取消', 1600)
  },

  onVoiceAskPick(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index)
    const choice = this._voiceAsk && this._voiceAsk.choices[index]
    if (!choice) return
    void this.resolveVoiceAsk(choice.id)
  },

  async resolveVoiceAsk(choiceId: string) {
    const ask = this._voiceAsk
    if (!ask) return
    this.closeVoiceAsk()
    if (!choiceId || choiceId === 'cancel') return
    if (ask.kind === 'matrix') {
      const answers = [...(ask.matrixAnswers || []), choiceId]
      const again = parseVoiceMatrix(ask.spoken, this._products, '', answers)
      const filled = Math.min(ask.matrixFilled || 0, again.lines.length)
      const fresh = again.lines.slice(filled)
      if (fresh.length) this.applyVoiceMatrix(fresh, ask.customerName, true)
      const just = new Set(again.lines.map((line) => String(line.code || '').toUpperCase()))
      let pendingDone = !!ask.pendingDone
      if (!pendingDone && ask.pendingItems && ask.pendingItems.length) {
        const extra = ask.pendingItems.filter((it) => !just.has(String(it.code || '').toUpperCase()))
        if (extra.length) this.applySettledLocal(extra, ask.customerName)
        pendingDone = true
      }
      if (again.ask) {
        if (!again.ask.choices.length) {
          this.showTopToast(again.ask.message, 2500)
          return
        }
        this.openVoiceAsk({
          ...ask,
          msg: again.ask.message,
          choices: again.ask.choices.map((id) => ({ id, label: id })),
          matrixAnswers: answers,
          matrixFilled: filled + fresh.length,
          pendingDone,
        })
        return
      }
      const nextAmbiguous = ask.pendingAmbiguous || []
      if (nextAmbiguous.length) {
        const first = nextAmbiguous[0]
        this.openVoiceAsk({
          kind: 'sku',
          msg: `${first.codes.join(' 还是 ')}？`,
          choices: first.codes.map((id) => ({ id, label: id })),
          items: [],
          customerName: ask.customerName,
          actions: ask.actions,
          qty: first.qty,
          qtySpoken: !!first.qtySpoken,
          color: first.color || '',
          size: first.size || '',
          spoken: first.spoken,
          lastOrderItems: [],
          pendingAmbiguous: nextAmbiguous.slice(1),
          pendingDone: true,
        })
        return
      }
      if (ask.customerName) this.applyVoiceCustomer(ask.customerName)
      const total = filled + fresh.length + (pendingDone && ask.pendingItems ? ask.pendingItems.length : 0)
      if (total) this.showTopToast(`已填入 ${total} 个货号，请核对`, 1800)
      if (ask.actions.length) await this.executeVoiceDeskActions(ask.actions, { confirmed: true })
      return
    }
    if (ask.kind === 'sku') {
      const code = choiceId === 'ok' ? ask.choices[0]?.id : choiceId
      if (!code) return
      rememberSpokenAlias(ask.spoken, code)
      const product = this._products.find((item) => String(item.code || '').toUpperCase() === code.toUpperCase())
      const qty = ask.qtySpoken ? ask.qty : ask.qty > 0 ? ask.qty : 1
      const line = settleSpokenSku(
        product?.code || code,
        product,
        ask.color,
        ask.size,
        qty,
        ask.qtySpoken || qty > 1,
      )
      const spec = [line.color, line.size].filter(Boolean).join('/')
      const label = spec ? `${line.code} ${spec} ${line.qty}件` : `${line.code} ${line.qty}件`
      const picked = [{ code: line.code, quantity: line.qty }]
      if (ask.customerName) this.applyVoiceCustomer(ask.customerName)
      if (line.color || line.size) this.applyVoiceMatrix([line], undefined, true)
      else this.applyAiItems(picked, { toast: '' })
      if (!ask.pendingDone && ask.pendingItems && ask.pendingItems.length) {
        const extra = ask.pendingItems.filter((it) => String(it.code || '').toUpperCase() !== code.toUpperCase())
        if (extra.length) this.applySettledLocal(extra, ask.customerName)
      }
      const nextAmbiguous = ask.pendingAmbiguous || []
      if (nextAmbiguous.length) {
        const first = nextAmbiguous[0]
        this.openVoiceAsk({
          kind: 'sku',
          msg: `${first.codes.join(' 还是 ')}？`,
          choices: first.codes.map((id) => ({ id, label: id })),
          items: [],
          customerName: ask.customerName,
          actions: ask.actions,
          qty: first.qty,
          qtySpoken: !!first.qtySpoken,
          color: first.color || '',
          size: first.size || '',
          spoken: first.spoken,
          lastOrderItems: [],
          pendingAmbiguous: nextAmbiguous.slice(1),
          pendingDone: true,
        })
        return
      }
      if (line.color || line.size) {
        if (ask.items.length) this.applyAiItems(ask.items, { toast: `已填入 ${label}` })
        else this.showTopToast(`已填入 ${label}`, 1800)
      } else {
        if (ask.items.length) this.applyAiItems(ask.items, { toast: `已填入 ${label}` })
        else this.showTopToast(`已填入 ${label}`, 1800)
        rememberVoiceFill(picked.concat(ask.items), ask.customerName || this.data.customerName)
      }
      if (ask.customerName) this.applyCustomerPricesToRows(this.data.customerName)
      if (ask.actions.length) await this.executeVoiceDeskActions(ask.actions, { confirmed: true })
      return
    }
    if (ask.kind === 'lastOrder') {
      if (ask.customerName) this.applyVoiceCustomer(ask.customerName)
      const items = ask.lastOrderItems
      if (items.length) {
        this.applyAiItems(items, { toast: `已填入上一单 ${items.length} 个货号，请核对` })
        rememberVoiceFill(items, ask.customerName || this.data.customerName)
        if (ask.customerName) this.applyCustomerPricesToRows(this.data.customerName)
      }
      if (ask.actions.length) await this.executeVoiceDeskActions(ask.actions, { confirmed: true })
      return
    }
    if (ask.kind === 'customer') {
      if (ask.customerAfter === 'prices') {
        wx.navigateTo({
          url: `/pages/customers/prices?code=${encodeURIComponent(choiceId)}`,
          fail: () => this.showTopToast('无法打开页面', 2000),
        })
        return
      }
      if (ask.customerAfter === 'statement') {
        await this.openVoiceStatement({
          intent: 'statement',
          items: [],
          customerName: choiceId,
          range: 'custom',
          from: ask.from || '',
          to: ask.to || '',
          unpaidOnly: false,
          transcript: '',
        })
        return
      }
      if (this.applyVoiceCustomer(choiceId)) this.showTopToast('已选中', 2000)
      return
    }
    if (ask.kind === 'danger') {
      if (ask.actions.length) await this.executeVoiceDeskActions(ask.actions, { confirmed: true })
    }
  },

  applySettledLocal(items: AiItem[], customerName?: string) {
    const lines: VoiceMatrixLine[] = []
    const plain: AiItem[] = []
    for (const it of items) {
      if (!it.color && !it.size) {
        plain.push(it)
        continue
      }
      const product = this._products.find(
        (row) => String(row.code || '').toUpperCase() === it.code.toUpperCase(),
      )
      const line = settleSpokenSku(it.code, product, it.color || '', it.size || '', it.quantity, true)
      if (line.color || line.size) lines.push(line)
      else plain.push({ code: line.code, quantity: line.qty })
    }
    if (customerName) this.applyVoiceCustomer(customerName)
    if (lines.length) this.applyVoiceMatrix(lines, undefined, true)
    if (plain.length) {
      this.applyAiItems(plain, {
        toast: `已填入 ${lines.length + plain.length} 个货号，请核对`,
      })
    } else if (lines.length) {
      this.showTopToast(`已填入 ${lines.length} 个货号，请核对`, 1800)
    }
  },

  applyVoiceMatrix(lines: VoiceMatrixLine[], customerName?: string, silent = false) {
    if (customerName) this.applyVoiceCustomer(customerName)
    const rows = this.data.rows.slice()
    const touched = new Set<string>()
    for (const line of lines) {
      const code = stripSpokenMarks(line.code).trim()
      if (!code || !(line.qty > 0)) continue
      const product = this._products.find(
        (item) => String(item.code || '').toUpperCase() === code.toUpperCase(),
      )
      const priced = resolveUnitPriceDetail({
        customerName: this.data.customerName,
        productCode: code,
        catalogPrice: product ? product.price : 0,
      })
      let index = findSameCodeIndex(rows, code)
      if (index < 0) index = rows.findIndex((row) => !rowHasSheetInput(row))
      if (index < 0) {
        rows.push(emptyRow(rows.length))
        index = rows.length - 1
      }
      const row = rows[index]
      const spec = skuSpec(line.color, line.size)
      const hit = (row.skuLines || []).find((item) => item.color === line.color && item.size === line.size)
      if (hit) hit.qty += line.qty
      else {
        row.skuLines = (row.skuLines || []).concat({
          key: `${line.color}-${line.size}-${(row.skuLines || []).length}`,
          color: line.color,
          size: line.size,
          spec,
          qty: line.qty,
        })
      }
      row.productCode = code
      row.productName = code
      row.unit = product?.unit || row.unit || '件'
      row.priceText = fmtNum(priced.price)
      row.priceSource = priceSourceLabel(priced.source)
      row.skuOpen = false
      row.countInStats = product ? product.countInStats !== false : row.countInStats
      rows[index] = refreshRow(decorateSkuRow(row, !!this.data.isReturnMode))
      touched.add(code)
    }
    this.setData({ rows })
    this.recomputeTotal(rows)
    const count = touched.size
    if (count && !silent) this.showTopToast(`已填入 ${count} 个货号的色码`, 1800)
    const missingLine = lines.find((line) => {
      const code = stripSpokenMarks(line.code).trim()
      if (!code) return false
      return !catalogCoversSpokenCode(
        code,
        this._products.map((item) => item.code),
      )
    })
    if (missingLine) this.offerMissingProduct(missingLine.code, true)
  },

  /** 语音说了打印：用上次成功的打印机直接出纸，模板用当前保存的那一套。 */
  async voiceDirectPrint() {
    if (this.data.saving || this.data.printing) return
    if (!(await this.ensureCustomerSelected())) return
    const items = this.buildCartItems()
    if (!items.length) {
      this.showTopToast('请先填写商品名和数量', 2000)
      return
    }
    if (!getSavedPrinter()) {
      wx.navigateTo({ url: '/pages/print-settings/print-settings' })
      this.showTopToast('请先连接打印机', 2000)
      return
    }
    this.setData({ printing: true })
    const saved = await this.saveOrder()
    if (!saved.ok) {
      this.setData({ printing: false })
      this.showTopToast(saved.error || '保存失败', 2000)
      return
    }
    const { totalQuantity, totalAmount } = this.buildTotals(items)
    const session = getSession()
    const handler =
      (session?.team?.displayName || '').trim() || (session?.phone || '').trim()
    const ticket = {
      shop: this.data.shop,
      orderNo: saved.orderNo || this._editingOrderNo || '',
      customerName: this.data.customerName,
      customerPhone: this.data.customerPhone,
      remark: this.data.remark,
      items,
      totalAmount,
      totalQuantity,
      createdAt: this.data.dateStr,
      isReturn: !!this.data.isReturnMode,
      handler,
    }
    // 便携机不吃文字指令，只会走一小段白纸。语音打印跟预览一样走位图；没画出来不清空。
    const printed = shouldUseRasterPrint()
      ? await this.printTicketRaster(ticket)
      : await tryBlePrintOrExplain(ticket)
    this.setData({ printing: false })
    if (printed.ok) {
      this.showTopToast('已打印', 1600)
      this.afterPrintClear()
      return
    }
    if (printed.needSetup) {
      wx.navigateTo({ url: '/pages/print-settings/print-settings' })
    }
    this.showTopToast(printed.error || '打印失败，单据还在', 2500)
  },

  /** 跟票据预览同一张位图。画不出来就失败，调用方不要清空开单。 */
  async printTicketRaster(opts: {
    shop?: ShopInfo | null
    orderNo: string
    customerName?: string
    customerPhone?: string
    remark?: string
    items: CartItem[]
    totalAmount: number
    totalQuantity: number
    createdAt?: string
    isReturn?: boolean
    handler?: string
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      let tpl = loadPrintTemplate()
      try {
        const pulled = await pullPrintTemplateFromCloud()
        if (pulled.ok && pulled.applied) tpl = pulled.template
        else tpl = loadPrintTemplate()
      } catch (_) {
        tpl = loadPrintTemplate()
      }
      const isReturn = !!opts.isReturn
      const qr = await extraReceiptQr(tpl, opts.orderNo, isReturn, opts.shop || null)
      const printFlags = receiptPrintFlags(opts.customerName, isReturn)
      const shopName = receiptShopTitle(
        opts.shop?.shopName,
        tpl.headerTitle,
        isGuest() || !isLoggedIn(),
      )
      const model = buildReceiptRenderModel({
        templateId: tpl.template,
        layoutTemplate: tpl,
        shopName,
        isReturn,
        orderNo: opts.orderNo,
        dateStr: String(opts.createdAt || '').slice(0, 10),
        customerName: opts.customerName || '',
        customerPhone: opts.customerPhone || '',
        handler: opts.handler || '',
        items: opts.items,
        totalQuantity: opts.totalQuantity,
        totalAmount: opts.totalAmount,
        footer: (tpl.footerText || opts.shop?.footer || '').trim(),
        shopAddress: String(opts.shop?.address || '').trim(),
        shopPhone: String(opts.shop?.phone || '').trim(),
        ...qr,
        ...printFlags,
      })
      const canvasH = Math.max(
        560,
        estimateReceiptCanvasHeight(
          model.templateId,
          opts.items.length,
          estimateQrBlockH(model),
          opts.items,
        ),
      )
      await new Promise<void>((resolve) => {
        this.setData({ expCanvasH: canvasH }, () => resolve())
      })
      await new Promise((resolve) => setTimeout(resolve, 40))
      const bytes = await buildRasterPrintBytes(this, model, canvasH)
      await writeBytes(bytes)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e || '打印失败').slice(0, 40) }
    }
  },

  applyVoiceFill(
    items: Array<{ code: string; quantity: number }>,
    customerName?: string,
    toast?: string,
  ) {
    const picked = customerName ? this.applyVoiceCustomer(customerName) : false
    if (items.length) {
      this.applyAiItems(items, {
        toast: toast || `已填入 ${items.length} 个货号，请核对`,
      })
      rememberVoiceFill(items, picked ? this.data.customerName : customerName || this.data.customerName)
      if (picked) this.applyCustomerPricesToRows(this.data.customerName)
      return
    }
    if (picked) {
      rememberVoiceCustomer(this.data.customerName)
      this.showTopToast('已选客户', 2000)
    }
  },

  async onVoiceTranscript(text: string) {
    const raw = unglueSpokenQty(String(text || '').trim(), this._products.map((p) => p.code))
    if (!raw) {
      this.showTopToast('没听清，请再说一次', 2500)
      return
    }
    if (!(await assertMsgSecCheck([raw]))) return

    const pending = this._voiceAsk
    const session0 = consumeSessionUtterance(raw.replace(/\s+/g, ''))
    if (pending) {
      if (session0.cancel) {
        this.onVoiceAskCancel()
        return
      }
      const hit = pending.choices.find((c) => raw.includes(c.id) || raw.includes(c.label))
      if (hit) {
        await this.resolveVoiceAsk(hit.id)
        return
      }
      if (session0.confirm || utteranceConfirmed(raw)) {
        await this.resolveVoiceAsk(pending.choices[0]?.id || 'ok')
        return
      }
      this.closeVoiceAsk()
    }

    const aliased = applySpokenAliases(raw)
    const session = consumeSessionUtterance(aliased)
    if (session.error) {
      this.showTopToast(session.error, 2500)
      return
    }
    if (session.confirm || session.cancel) {
      this.showTopToast('没有待确认的操作', 2000)
      return
    }
    const prepared = rewriteVoiceFromCache(session.leftover, {
      codes: this._products.map((p) => p.code),
      customers: this.data.customers || [],
      phrases: voiceFunctionPhrases(),
    })
    const routed = extractDeskActions(prepared)
    const leftover = String(routed.leftover || '').trim()
    const mayNameCustomer = utteranceNamesCustomer(raw)
    const actions = routed.actions.filter((a) => a.type !== 'setCustomer' || mayNameCustomer)
    let items = session.injectItems.slice()
    const customers = this.data.customers || []
    const codes = this._products.map((p) => p.code)
    const confirmed = utteranceConfirmed(raw)

    if (leftover) {
      const local = extractVoiceSkuItems(leftover, codes)
      rememberSpokenAliases(local.aliases || [])
      const matrix = parseVoiceMatrix(leftover, this._products)
      if (matrix && matrix.ask) {
        const cmd = buildVoiceCommand({
          transcript: leftover,
          items,
          customers,
        })
        if (mayNameCustomer && cmd.customerName) this.applyVoiceCustomer(cmd.customerName)
        if (!matrix.ask.choices.length) {
          this.showTopToast(matrix.ask.message, 2500)
          return
        }
        if (matrix.lines.length) {
          this.applyVoiceMatrix(matrix.lines, mayNameCustomer ? cmd.customerName : '', true)
        }
        const covered = new Set(matrix.lines.map((line) => String(line.code || '').toUpperCase()))
        this.openVoiceAsk({
          kind: 'matrix',
          msg: matrix.ask.message,
          choices: matrix.ask.choices.map((id) => ({ id, label: id })),
          items: [],
          customerName: mayNameCustomer ? cmd.customerName || '' : '',
          actions,
          qty: 0,
          qtySpoken: false,
          color: '',
          size: '',
          spoken: leftover,
          lastOrderItems: [],
          matrixAnswers: [],
          matrixFilled: matrix.lines.length,
          pendingItems: local.items.filter((it) => !covered.has(String(it.code || '').toUpperCase())),
          pendingAmbiguous: local.ambiguous || [],
          pendingDone: false,
        })
        return
      }
      if (matrix && matrix.used && matrix.lines.length) {
        const cmd = buildVoiceCommand({
          transcript: leftover,
          items,
          customers,
        })
        this.applyVoiceMatrix(matrix.lines, mayNameCustomer ? cmd.customerName : '')
        const covered = new Set(matrix.lines.map((line) => String(line.code || '').toUpperCase()))
        const extra = local.items.filter((it) => !covered.has(String(it.code || '').toUpperCase()))
        if (extra.length) this.applySettledLocal(extra, mayNameCustomer ? cmd.customerName : '')
        if ((local.ambiguous || []).length) {
          const first = local.ambiguous[0]
          this.openVoiceAsk({
            kind: 'sku',
            msg: `${first.codes.join(' 还是 ')}？`,
            choices: first.codes.map((c) => ({ id: c, label: c })),
            items: [],
            customerName: mayNameCustomer ? cmd.customerName || '' : '',
            actions,
            qty: first.qty,
            qtySpoken: !!first.qtySpoken,
            color: first.color || '',
            size: first.size || '',
            spoken: first.spoken,
            lastOrderItems: [],
            pendingAmbiguous: local.ambiguous.slice(1),
            pendingDone: true,
          })
          return
        }
        if (actions.length) await this.executeVoiceDeskActions(actions, { confirmed })
        return
      }
      if ((local.ambiguous || []).length) {
        const first = local.ambiguous[0]
        const customerName = mayNameCustomer
          ? (buildVoiceCommand({ transcript: leftover, items, customers }).customerName || '')
          : ''
        this.openVoiceAsk({
          kind: 'sku',
          msg: `${first.codes.join(' 还是 ')}？`,
          choices: first.codes.map((c) => ({ id: c, label: c })),
          items: [],
          customerName,
          actions,
          qty: first.qty,
          qtySpoken: !!first.qtySpoken,
          color: first.color || '',
          size: first.size || '',
          spoken: first.spoken,
          lastOrderItems: [],
          pendingItems: local.items,
          pendingAmbiguous: local.ambiguous.slice(1),
          pendingDone: false,
        })
        return
      }
      if (local.items.length) {
        items = items.concat(local.items)
        const cmd = buildVoiceCommand({
          transcript: leftover,
          items,
          customers,
        })
        if (cmd.items.length || cmd.customerName) {
          this.applySettledLocal(cmd.items, mayNameCustomer ? cmd.customerName : '')
        }
      }
      if ((local.missed || []).length && !local.items.length) {
        const heard = local.missed.find((code) => !catalogCoversSpokenCode(code, codes))
        if (heard) this.offerMissingProduct(heard, true)
        if (actions.length) await this.executeVoiceDeskActions(actions, { confirmed })
        return
      }
      if (!local.items.length) {
        const askModel = voiceShouldAskModel({
          hasItems: false,
          strong: false,
          hasActions: actions.length > 0,
          systemCommand: isSystemVoiceCommand(leftover, customers),
        })
        if (!askModel) {
          if (!actions.length) {
            this.showTopToast('请说相关的指令内容', 2500)
            return
          }
        } else {
          await this.runVoiceLlmCommands({
            leftover,
            local,
            items,
            actions,
            customers,
            codes,
            confirmed,
            alreadyFilled: false,
            direct: false,
          })
          return
        }
      }
    } else if (items.length) {
      this.applyVoiceFill(items, this.data.customerName)
    }

    if (actions.length) await this.executeVoiceDeskActions(actions, { confirmed })
    else if (!items.length && !leftover) {
      this.showTopToast('请说相关的指令内容', 2500)
    }
  },

  async runVoiceLlmCommands(opts: {
    leftover: string
    local: VoiceSkuResult
    items: AiItem[]
    actions: VoiceDeskAction[]
    customers: Array<{ name?: string | null }>
    codes: string[]
    confirmed: boolean
    alreadyFilled?: boolean
    direct?: boolean
  }) {
    wx.showLoading({ title: '理解中', mask: true })
    let r: Awaited<ReturnType<typeof extractVoiceCommand>>
    try {
      r = await extractVoiceCommand(opts.leftover)
    } finally {
      wx.hideLoading()
    }
    const allowed = new Set(opts.codes.map((code) => code.trim().toUpperCase()))
    const catalogItems = (r.ok ? r.items : []).filter((it) =>
      allowed.has(String(it.code || '').trim().toUpperCase()),
    )
    const baseItems = opts.items.length ? opts.items : opts.local.items
    const merged = r.ok ? mergeVoiceSkuItems(baseItems, catalogItems) : baseItems.slice()
    const have = new Set(baseItems.map((it) => it.code.toUpperCase()))
    const extras = opts.alreadyFilled
      ? merged.filter((it) => !have.has(it.code.toUpperCase()))
      : merged
    const llmActions = r.ok
      ? actionsFromLlmJson({
          intent: r.intent,
          actions: r.actions,
          action: r.action,
        }).filter((a) => a.type !== 'setCustomer' || utteranceNamesCustomer(opts.leftover))
      : []
    const cmd = buildVoiceCommand({
      transcript: opts.leftover,
      items: merged,
      intent: r.ok ? r.intent : undefined,
      customerName: r.ok ? r.customerName : undefined,
      from: r.ok ? r.from : undefined,
      to: r.ok ? r.to : undefined,
      range: r.ok ? r.range : undefined,
      unpaidOnly: r.ok ? r.unpaidOnly : undefined,
      customers: opts.customers,
    })
    const allActions = opts.actions.concat(llmActions)
    const namedCustomer =
      utteranceNamesCustomer(opts.leftover) && !opts.actions.some((a) => a.type === 'setCustomer')
    const spokenName = namedCustomer
      ? spokenPersonName(
          cmd.customerName ||
            (llmActions.find((a) => a.type === 'setCustomer') as { name?: string } | undefined)?.name ||
            '',
        )
      : ''
    const pickedCustomer = spokenName || (namedCustomer ? cmd.customerName : '')
    if (spokenName) this.applyVoiceCustomer(spokenName)
    const spokenDate =
      (allActions.find((a) => a.type === 'setDate') as { date?: string } | undefined)?.date ||
      (cmd.from && (cmd.to || cmd.from) === cmd.from ? spokenBillDate(cmd.from) : '')
    if (spokenDate) this.applyVoiceDate(spokenDate)
    if (cmd.intent === 'clearAll' && !allActions.some((a) => a.type === 'clearAll')) {
      allActions.unshift({ type: 'clearAll' })
    }
    if (!r.ok && !merged.length && !cmd.customerName && !allActions.length) {
      const related = isSystemVoiceCommand(opts.leftover, opts.customers)
      this.showTopToast(related ? r.error || '没听清，请再说一次' : '请说相关的指令内容', 3000)
      return
    }
    if (allActions.some((a) => a.type === 'clearAll') || cmd.intent === 'clearAll') {
      await this.executeVoiceDeskActions(allActions, { confirmed: opts.confirmed })
      return
    }
    if (r.ok && (cmd.intent === 'stats' || cmd.intent === 'statement')) {
      await this.applyVoiceCommand({ ...cmd, customerName: pickedCustomer })
      return
    }
    if (
      r.ok &&
      !opts.direct &&
      this.takeAmbiguousSku(r.ambiguous, extras, pickedCustomer, allActions)
    ) {
      return
    }
    const detailItems = catalogItems.filter((it) => it.color || it.size || (it.hands || 0) > 0)
    const detailLines = linesFromLlmItems(detailItems, this._products)
    const plainExtras = extras.filter((it) => !it.color && !it.size && !(it.hands && it.hands > 0))
    if (detailLines.length) this.applyVoiceMatrix(detailLines)
    if (plainExtras.length || (!detailLines.length && pickedCustomer && !opts.alreadyFilled)) {
      this.applyVoiceFill(plainExtras, pickedCustomer)
    } else if (!detailLines.length && pickedCustomer && opts.alreadyFilled) {
      this.applyVoiceCustomer(pickedCustomer)
    } else if (!detailLines.length && !allActions.length && !opts.alreadyFilled) {
      const related = isSystemVoiceCommand(opts.leftover, opts.customers)
      this.showTopToast(related ? '没听清，请再说一次' : '请说相关的指令内容', 3000)
      return
    }
    if (allActions.length) {
      await this.executeVoiceDeskActions(allActions, { confirmed: opts.confirmed })
    }
  },

  lastFilledRowIndex(): number {
    const rows = this.data.rows || []
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if ((rows[i].productName || '').trim() && parseFloat(rows[i].quantityText)) return i
    }
    return -1
  },

  applyVoiceSheetAction(act: {
    action: 'clearAll' | 'clearRow' | 'deleteRow' | 'print' | 'returnPrint'
    row?: number
  }) {
    void this.executeVoiceDeskActions([
      act.action === 'clearAll'
        ? { type: 'clearAll' }
        : act.action === 'print'
          ? { type: 'print' }
          : act.action === 'returnPrint'
            ? { type: 'returnPrint' }
            : act.action === 'deleteRow'
              ? { type: 'deleteRow', row: Number(act.row || 0) }
              : { type: 'clearRow', row: Number(act.row || 0) },
    ])
  },

  async executeVoiceDeskActions(
    actions: VoiceDeskAction[],
    opts?: { confirmed?: boolean },
  ) {
    const confirmed = !!opts?.confirmed
    const danger = actions.filter((a) => a.type === 'clearAll' || a.type === 'returnPrint')
    const needAsk =
      (danger.some((a) => a.type === 'clearAll') && this.contentRows().length > 0) ||
      danger.some((a) => a.type === 'returnPrint')
    if (needAsk && !confirmed) {
      const first = danger[0]
      this.openVoiceAsk({
        kind: 'danger',
        msg: first.type === 'clearAll' ? '确认清空全部？再说「确认」或点确认' : '确认退单打印？再说「确认」或点确认',
        choices: [{ id: 'ok', label: '确认' }],
        items: [],
        customerName: '',
        actions,
        qty: 0,
        qtySpoken: false,
        color: '',
        size: '',
        spoken: '',
        lastOrderItems: [],
      })
      return
    }
    for (const act of actions) {
      if (act.type === 'clearAll') {
        this.onClear()
        continue
      }
      if (act.type === 'print') {
        if (this.data.isReturnMode) await this.voiceStartReturnPrint()
        else await this.voiceDirectPrint()
        continue
      }
      if (act.type === 'returnPrint') {
        await this.voiceStartReturnPrint()
        continue
      }
      if (act.type === 'returnMode') {
        await this.voiceEnterReturnMode()
        continue
      }
      if (act.type === 'saleMode') {
        await this.voiceEnterSaleMode()
        continue
      }
      if (act.type === 'save') {
        await this.onSave()
        continue
      }
      if (act.type === 'saveAs') {
        await this.onSaveAs()
        continue
      }
      if (act.type === 'stockIn') {
        this.onStockIn()
        continue
      }
      if (act.type === 'stockOut') {
        this.onStockOut()
        continue
      }
      if (act.type === 'restore') {
        this.onRestore()
        continue
      }
      if (act.type === 'setPaid') {
        this.placeMore({ isPaid: act.on })
        this.showTopToast(act.on ? '已标收款' : '已取消收款', 1800)
        continue
      }
      if (act.type === 'setPicked') {
        this.placeMore({ isPickedUp: act.on })
        this.showTopToast(act.on ? '已标取货' : '已取消取货', 1800)
        continue
      }
      if (act.type === 'setShipped') {
        this.placeMore({
          isShipped: act.on,
          shippedLabel: act.on ? t('shipped') : t('shipped'),
        })
        this.showTopToast(act.on ? '已标发货' : '已取消发货', 1800)
        continue
      }
      if (act.type === 'openDeliver') {
        this.onToggleDelivered()
        continue
      }
      if (act.type === 'changeLastQty') {
        const i = this.lastFilledRowIndex()
        if (i < 0) {
          this.showTopToast('没有可改的行', 2000)
          continue
        }
        const rows = this.data.rows.slice()
        const qty = this.data.isReturnMode ? -Math.abs(act.qty) : Math.abs(act.qty)
        rows[i] = refreshRow({ ...rows[i], quantityText: fmtNum(qty) })
        this.setData({ rows })
        this.recomputeTotal(rows)
        this.showTopToast(`第${i + 1}行已改为 ${act.qty} 件，请核对`, 2000)
        continue
      }
      if (act.type === 'dropLast') {
        const i = this.lastFilledRowIndex()
        if (i < 0) {
          this.showTopToast('没有可删的行', 2000)
          continue
        }
        this.deleteSheetRowAt(i)
        continue
      }
      if (act.type === 'navigate') {
        if (act.tab === 'supply') {
          const block = supplyEntryBlock()
          if (block === 'pay') {
            wx.navigateTo({ url: '/pages/subscription/subscription?from=supply' })
            continue
          }
          if (block === 'agent') {
            this.showTopToast('代理不能打开供应链', 2000)
            continue
          }
          if (block === 'staff') {
            this.showTopToast('没有供应链权限', 2000)
            continue
          }
        }
        const url =
          act.tab === 'products'
            ? '/pages/products/products'
            : act.tab === 'orders'
              ? '/pages/orders/orders'
              : act.tab === 'mine'
                ? '/pages/mine/mine'
                : act.tab === 'supply'
                  ? '/pages/chain/chain'
                  : '/pages/home/home'
        wx.switchTab({ url, fail: () => this.showTopToast('无法打开页面', 2000) })
        continue
      }
      if (act.type === 'search') {
        this.voiceSearchJump(act.target, act.query)
        continue
      }
      if (act.type === 'openPage') {
        if (act.page === 'customerPrices' && act.code === '@current') {
          const name = String(this.data.customerName || '').trim()
          if (!name) {
            this.showTopToast('请先选择客户', 2500)
            continue
          }
          this.voiceOpenPage('customerPrices', name)
          continue
        }
        if (act.page === 'analytics' && act.from && act.to) {
          const qs = [
            'tab=0',
            `from=${encodeURIComponent(act.from)}`,
            `to=${encodeURIComponent(act.to)}`,
          ]
          wx.navigateTo({
            url: `/pages/analytics/analytics?${qs.join('&')}`,
            fail: () => this.showTopToast('无法打开统计', 2000),
          })
          continue
        }
        this.voiceOpenPage(act.page, act.code)
        continue
      }
      if (act.type === 'lastOrder') {
        this.askFillLastOrder(act.customer, actions.slice(actions.indexOf(act) + 1))
        return
      }
      if (act.type === 'setCustomer') {
        await this.voiceEnsureCustomer(act.name)
        continue
      }
      if (act.type === 'setDate') {
        this.applyVoiceDate(act.date)
        continue
      }
      if (act.type === 'openStatement') {
        await this.voiceOpenStatement(act.customer, act.from, act.to)
        continue
      }
      if (act.type === 'openProduct') {
        if (!canEditCatalog()) {
          this.showTopToast(catalogEditDeniedText(), 2000)
          continue
        }
        wx.navigateTo({ url: '/pages/product-edit/product-edit' })
        continue
      }
      if (act.type === 'fillProduct') {
        rememberVoiceProduct({ code: act.code, price: act.price, retail: act.retail })
        if (act.save) await this.voiceSaveProductDraft()
        else this.voiceOpenProductDraft(act.code, act.price, act.retail)
        continue
      }
      if (act.type === 'saveProduct') {
        await this.voiceSaveProductDraft()
        continue
      }
      if (act.type === 'addStock') {
        await this.voiceAddStock(act.code, act.qty)
        continue
      }
      if (act.type === 'importData' || act.type === 'exportData') {
        setVoiceJump({ page: 'products', action: act.type === 'importData' ? 'import' : 'export' })
        wx.switchTab({ url: '/pages/products/products', fail: () => this.showTopToast('无法打开商品', 2000) })
        continue
      }
      if (act.type === 'addCategory') {
        await this.voiceAddCategory(act.name)
        continue
      }
      if (act.type === 'openHelp') {
        this.voiceOpenHelp(act.lesson, act.page)
        continue
      }
      const row = Number((act as { row?: number }).row || 0)
      if (row < 1) {
        this.showTopToast('没听清是第几行', 2000)
        continue
      }
      if (act.type === 'deleteRow') this.deleteSheetRowAt(row - 1)
      else if (act.type === 'clearRow') this.clearSheetRowAt(row - 1)
    }
  },

  voiceSearchJump(target: VoiceSearchTarget, query: string) {
    const q = String(query || '').trim()
    if (!q) {
      this.showTopToast('没听清要找什么', 2000)
      return
    }
    if (target === 'products' || target === 'orders') {
      setVoiceJump({ page: target as VoiceJumpPage, keyword: q })
      const url = target === 'products' ? '/pages/products/products' : '/pages/orders/orders'
      wx.switchTab({ url, fail: () => this.showTopToast('无法打开页面', 2000) })
      return
    }
    if (target === 'customers') {
      setVoiceJump({ page: 'customers', keyword: q })
      wx.navigateTo({
        url: '/pages/customers/customers',
        fail: () => this.showTopToast('无法打开客户', 2000),
      })
      return
    }
    setVoiceJump({ page: 'returns', keyword: q })
    wx.navigateTo({
      url: '/pages/returns/returns',
      fail: () => this.showTopToast('无法打开退包', 2000),
    })
  },

  voiceOpenPage(page: VoiceOpenPage, code?: string) {
    if ((VOICE_SUPPLY_PAGES as string[]).includes(page)) {
      const block = supplyEntryBlock()
      if (block === 'pay') {
        wx.navigateTo({ url: '/pages/subscription/subscription?from=supply' })
        return
      }
      if (block === 'agent') {
        this.showTopToast('代理不能打开供应链', 2000)
        return
      }
      if (block === 'staff') {
        this.showTopToast('没有供应链权限', 2000)
        return
      }
    }
    if (page === 'customerNew') {
      setVoiceJump({ page: 'customers', action: 'add' })
      wx.navigateTo({
        url: '/pages/customers/customers',
        fail: () => this.showTopToast('无法打开新增客户', 2000),
      })
      return
    }
    if (page === 'stock') setVoiceJump({ page: 'stock' })
    let url = VOICE_OPEN_URL[page]
    if (!url) {
      this.showTopToast('无法打开页面', 2000)
      return
    }
    const sku = String(code || '').trim()
    if (page === 'customerPrices') {
      const book = (this.data.customers || []).length ? this.data.customers : peekCachedCustomers()
      const hit = matchSpokenCustomer(sku, book)
      if (!hit.name) {
        if (hit.ambiguous) this.askSpokenCustomers(hit.names, 'prices')
        else this.offerMissingCustomer(sku, 'prices')
        return
      }
      url += `${url.includes('?') ? '&' : '?'}code=${encodeURIComponent(hit.name)}`
      wx.navigateTo({
        url,
        fail: () => this.showTopToast('无法打开页面', 2000),
      })
      return
    }
    if (sku) url += `${url.includes('?') ? '&' : '?'}code=${encodeURIComponent(sku)}`
    wx.navigateTo({
      url,
      fail: () => this.showTopToast('无法打开页面', 2000),
    })
  },

  askFillLastOrder(customer: string | undefined, rest: VoiceDeskAction[]) {
    const hint = String(customer || this.data.customerName || '').trim()
    const order = pickLastOrder(peekCachedOrders(), hint)
    if (!order) {
      this.showTopToast(hint ? `没有${hint}的上一单` : '没有可复用的上一单', 2500)
      return
    }
    const items = cartToVoiceItems(order.items)
    if (!items.length) {
      this.showTopToast('上一单没有明细，请先打开账单页同步', 2800)
      return
    }
    const name = String(order.customerName || hint || '').trim()
    const codes = items.map((it) => `${it.code}×${it.quantity}`).join(' ')
    this.openVoiceAsk({
      kind: 'lastOrder',
      msg: `填入${name || '上一单'} ${codes}？`,
      choices: [{ id: 'ok', label: '填入' }],
      items: [],
      customerName: name,
      actions: rest,
      qty: 0,
      qtySpoken: false,
      color: '',
      size: '',
      spoken: '',
      lastOrderItems: items,
    })
  },

  /** 语音「开销售单」：回到销售单。没说退单时本来就是销售单。 */
  async voiceEnterSaleMode() {
    if (!this.data.isReturnMode) {
      this.showTopToast('已是销售单', 1800)
      return
    }
    await this.onExitReturn()
  },

  /** 语音「退单 / 开退单 / 打印退单」：只进入退单模式，不出纸。 */
  async voiceEnterReturnMode() {
    if (this.data.saving || this.data.printing) return
    if (this.data.isReturnMode) {
      this.showTopToast('已在退单模式', 1800)
      return
    }
    await new Promise<void>((resolve) => {
      this.setData({ dateStr: todayStr() }, () => resolve())
    })
    await this.enterReturnMode(t('reasonOther') || '其他')
    this.showTopToast(t('enteredReturnVoice'), 2800)
  },

  /** 语音退单打印：日期用当天，原因默认「其他」，不再弹出选择。 */
  async voiceStartReturnPrint() {
    if (this.data.saving || this.data.printing) return
    if (!this.data.isReturnMode) {
      await new Promise<void>((resolve) => {
        this.setData({ dateStr: todayStr() }, () => resolve())
      })
      await this.enterReturnMode(t('reasonOther') || '其他')
    }
    if (!(await this.ensureCustomerSelected())) return
    if (!this.buildCartItems().length) {
      this.showTopToast(t('enteredReturnVoice'), 2800)
      return
    }
    void this.doPrint(true)
  },

  applyVoiceDate(raw: string) {
    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : spokenBillDate(raw)
    if (!ymd) return
    this.setData({ dateStr: ymd })
  },

  offerMissingProduct(code: string, force = false) {
    const sku = stripSpokenMarks(String(code || '')).trim()
    if (!sku || !canEditCatalog()) return
    if (this._addAskKind === 'customer') {
      if (!this._nextProductCode) this._nextProductCode = sku
      return
    }
    if (this._addAskKind === 'product') return
    if (!force && this._askedProduct === sku) return
    this._askedProduct = sku
    this._addAskKind = 'product'
    wx.showModal({
      title: '添加新商品',
      content: `货号 ${sku} 本地没有，是否添加？`,
      confirmText: '确认',
      cancelText: '否',
      success: (res) => {
        this._addAskKind = ''
        if (!res.confirm) return
        this._askedProduct = ''
        this._nextProductCode = ''
        wx.navigateTo({
          url: `/pages/product-edit/product-edit?voiceCode=${encodeURIComponent(sku)}`,
        })
      },
      fail: () => {
        this._addAskKind = ''
      },
    })
  },

  offerMissingCustomer(name: string, after: '' | 'prices' = '') {
    const n = stripSpokenMarks(String(name || '')).trim()
    if (!n) return
    if (!this.data.custCanManage) {
      this.showTopToast('仅商家可新增客户', 2500)
      return
    }
    if (this._addAskKind) return
    this._addAskKind = 'customer'
    this._afterCustomerAdd = after
    wx.showModal({
      title: '添加客户',
      content: `客户「${n}」本地没有，是否添加？`,
      confirmText: '确认',
      cancelText: '否',
      success: (res) => {
        if (!res.confirm) {
          this._addAskKind = ''
          this._afterCustomerAdd = ''
          this._nextProductCode = ''
          return
        }
        this.setData({
          custFormVisible: true,
          custFormTitle: t('newCustomer'),
          custFormName: n,
          custFormPhone: '',
          custFormEditId: '',
          custFormNameFocus: true,
          custFormPhoneFocus: false,
        })
      },
      fail: () => {
        this._addAskKind = ''
        this._afterCustomerAdd = ''
        this._nextProductCode = ''
      },
    })
  },

  finishMissingCustomer(savedName: string) {
    if (this._addAskKind !== 'customer' && !this._afterCustomerAdd && !this._nextProductCode) return
    const after = this._afterCustomerAdd
    const code = this._nextProductCode
    this._addAskKind = ''
    this._afterCustomerAdd = ''
    this._nextProductCode = ''
    if (savedName && after === 'prices') {
      wx.navigateTo({
        url: `/pages/customers/prices?code=${encodeURIComponent(savedName)}`,
      })
      return
    }
    if (code) this.offerMissingProduct(code, true)
  },

  applyVoiceCustomer(name: string) {
    const n = spokenPersonName(name) || String(name || '').trim()
    if (!n) return false
    const list = this.data.customers || []
    let row = list.find((c) => c.name === n)
    if (!row) {
      const heard = matchSpokenCustomer(n, list)
      if (heard.ambiguous) {
        this.askSpokenCustomers(heard.names)
        return false
      }
      if (heard.name) row = list.find((c) => c.name === heard.name)
    }
    if (!row) {
      row = list.find((c) => c.name && n.length >= 2 && n.length <= c.name.length && c.name.includes(n))
    }
    if (!row) {
      const now = Date.now()
      if (now - (this._missingCustAt || 0) > 1200) {
        this._missingCustAt = now
        this.offerMissingCustomer(n)
      }
      return false
    }
    saveRecentCustomer(row)
    this.exitReturnIfCustomerChanged(row.name)
    this.setData({
      customerName: row.name,
      customerPhone: row.phone || '',
      customerId: row.id,
    })
    this.applyCustomerPricesToRows(row.name)
    void this.refreshBillHead()
    return true
  },

  async voiceEnsureCustomer(name: string) {
    const n = spokenPersonName(name)
    if (!n) {
      this.showTopToast('没听清客户', 2500)
      return
    }
    if (!this.applyVoiceCustomer(n)) return
    rememberVoiceCustomer(this.data.customerName || n)
    this.showTopToast('已选中', 2000)
  },

  voiceCustomerName(spoken: string, from = '', to = '') {
    const n = spoken.trim()
    const list = this.data.customers || []
    const heard = matchSpokenCustomer(n, list)
    if (heard.ambiguous) {
      this.askSpokenCustomers(heard.names, 'statement', from, to)
      return ''
    }
    if (heard.name) return heard.name
    const existed =
      list.find((c) => c.name === n) ||
      list.find((c) => c.name && (c.name.includes(n) || n.includes(c.name)))
    return existed?.name || n
  },

  async voiceOpenStatement(customer: string, from: string, to: string) {
    const name = this.voiceCustomerName(customer, from, to)
    if (!name) {
      if (!this.data.voiceAskVisible) this.showTopToast('没听清客户', 2000)
      return
    }
    await this.openVoiceStatement({
      intent: 'statement',
      items: [],
      customerName: name,
      range: 'custom',
      from,
      to,
      unpaidOnly: false,
      transcript: '',
    })
  },

  voiceOpenProductDraft(code: string, price?: number, retail?: number) {
    if (!canEditCatalog()) {
      this.showTopToast(catalogEditDeniedText(), 2000)
      return
    }
    const q = [`voiceCode=${encodeURIComponent(code)}`]
    if (price != null) q.push(`voicePrice=${encodeURIComponent(String(price))}`)
    if (retail != null) q.push(`voiceRetail=${encodeURIComponent(String(retail))}`)
    wx.navigateTo({
      url: `/pages/product-edit/product-edit?${q.join('&')}`,
      fail: () => this.showTopToast('无法打开商品', 2000),
    })
    this.showTopToast(price != null ? '已填好货号和批发价' : '已填好货号，请补批发价', 2000)
  },

  async voiceSaveProductDraft() {
    if (!canEditCatalog()) {
      this.showTopToast(catalogEditDeniedText(), 2000)
      return
    }
    const draft = peekVoiceProduct()
    if (!draft?.code) {
      this.showTopToast('先说货号和批发价', 2000)
      return
    }
    if (draft.price == null) {
      this.voiceOpenProductDraft(draft.code, draft.price, draft.retail)
      return
    }
    if (!(await assertMsgSecCheck([draft.code]))) return
    const code = draft.code
    const existing = peekCachedCatalog().find((p) => String(p.code || '').toUpperCase() === code.toUpperCase())
    const product: Product = existing
      ? {
          ...existing,
          price: draft.price,
          suggestedRetailPrice: draft.retail != null ? draft.retail : existing.suggestedRetailPrice,
        }
      : {
          code,
          name: code,
          price: draft.price,
          unit: '件',
          suggestedRetailPrice: draft.retail != null ? draft.retail : null,
          stock: null,
        }
    const r = await patchCatalog([product])
    if (!r.ok) {
      this.showTopToast(r.error || '保存失败', 2000)
      return
    }
    clearVoiceProduct()
    this.showTopToast(`已保存商品 ${code}`, 2000)
  },

  async voiceAddStock(code: string, qty: number) {
    if (!canEditCatalog()) {
      this.showTopToast(catalogEditDeniedText(), 2000)
      return
    }
    const key = code.toUpperCase()
    const found = peekCachedCatalog().find((p) => String(p.code || '').toUpperCase() === key)
    if (!found) {
      this.showTopToast('没有这个货号', 2000)
      return
    }
    if (isSkuProduct(found)) {
      wx.navigateTo({
        url: `/pages/product-edit/product-edit?code=${encodeURIComponent(found.code)}`,
      })
      this.showTopToast('这个货号按颜色尺码记库存', 2200)
      return
    }
    const current = found.stock == null ? 0 : Number(found.stock)
    const next = (Number.isFinite(current) ? current : 0) + qty
    const updated: Product = { ...found, stock: next }
    const r = await patchCatalog([updated])
    this.showTopToast(r.ok ? `${found.code} 库存已加到 ${next}` : r.error || '库存调整失败', 2000)
  },

  async voiceAddCategory(name: string) {
    if (!canEditCatalog()) {
      this.showTopToast(catalogEditDeniedText(), 2000)
      return
    }
    const spoken = name.trim()
    if (!spoken) {
      wx.navigateTo({ url: '/pages/category-manage/category-manage' })
      return
    }
    if (!(await assertMsgSecCheck([spoken]))) return
    const loaded = await fetchCategories()
    const list = (loaded.categories || peekCachedCategories()).slice()
    if (list.some((c) => String(c.name || '').trim() === spoken)) {
      this.showTopToast('分类已存在', 2000)
      return
    }
    list.push({ name: spoken, sortOrder: list.length })
    const r = await uploadCategories(list)
    this.showTopToast(r.ok ? `已添加分类 ${spoken}` : r.error || '添加分类失败', 2000)
  },

  voiceOpenHelp(lesson?: string, page?: string) {
    if (lesson) {
      wx.navigateTo({
        url: `/pages/tutorials/play?id=${encodeURIComponent(lesson)}`,
        fail: () => this.showTopToast('无法打开帮助', 2000),
      })
      return
    }
    if (page === 'products' || page === 'orders' || page === 'supply' || page === 'mine') {
      void this.executeVoiceDeskActions([{ type: 'navigate', tab: page }])
      return
    }
    if (page === 'openProduct') {
      if (!canEditCatalog()) {
        this.showTopToast(catalogEditDeniedText(), 2000)
        return
      }
      wx.navigateTo({ url: '/pages/product-edit/product-edit' })
      return
    }
    if (page === 'category') {
      wx.navigateTo({ url: '/pages/category-manage/category-manage' })
      return
    }
    if (page && Object.prototype.hasOwnProperty.call(VOICE_OPEN_URL, page)) {
      this.voiceOpenPage(page as VoiceOpenPage)
      return
    }
    wx.navigateTo({
      url: '/pages/tutorials/tutorials',
      fail: () => this.showTopToast('无法打开帮助', 2000),
    })
  },

  async applyVoiceCommand(cmd: VoiceCommand) {
    if (cmd.intent === 'clearAll') {
      await this.executeVoiceDeskActions([{ type: 'clearAll' }])
      return
    }
    if (cmd.intent === 'stats') {
      if (!cmd.customerName) {
        const qs = ['tab=0']
        if (cmd.from && cmd.to) {
          qs.push(`from=${encodeURIComponent(cmd.from)}`, `to=${encodeURIComponent(cmd.to)}`)
        } else if (cmd.range && cmd.range !== '7d') {
          qs.push(`range=${encodeURIComponent(cmd.range)}`)
        }
        wx.navigateTo({
          url: `/pages/analytics/analytics?${qs.join('&')}`,
          fail: () => this.showTopToast('无法打开统计', 2500),
        })
        return
      }
      const qs = [
        'intent=stats',
        `customer=${encodeURIComponent(cmd.customerName)}`,
      ]
      if (cmd.from && cmd.to) {
        qs.push(`from=${encodeURIComponent(cmd.from)}`, `to=${encodeURIComponent(cmd.to)}`)
      } else if (cmd.range) {
        qs.push(`range=${encodeURIComponent(cmd.range)}`)
      }
      wx.navigateTo({
        url: `/pages/analytics/analytics?${qs.join('&')}`,
        fail: () => this.showTopToast('无法打开统计', 2500),
      })
      return
    }
    if (cmd.intent === 'statement') {
      if (!cmd.customerName) {
        this.showTopToast('没听清客户', 2500)
        return
      }
      await this.openVoiceStatement(cmd)
      return
    }
    if (cmd.customerName) this.applyVoiceCustomer(cmd.customerName)
    if (cmd.items.length) {
      this.applyAiItems(cmd.items, {
        toast: `已填入 ${cmd.items.length} 个货号，请核对`,
      })
      if (cmd.customerName) this.applyCustomerPricesToRows(this.data.customerName)
      return
    }
    if (cmd.customerName) {
      this.showTopToast('已选客户', 2000)
      return
    }
    this.showTopToast(cmd.transcript ? '请说相关的指令内容' : '没听清，请再说一次', 2500)
  },

  async openVoiceStatement(cmd: VoiceCommand) {
    const name = cmd.customerName
    const range = (cmd.from && cmd.to ? 'custom' : cmd.range || '7d') as RangeKey
    wx.showLoading({ title: t('loading'), mask: true })
    const r = await fetchStmtOrders({
      customer: name,
      range,
      from: range === 'custom' ? cmd.from : undefined,
      to: range === 'custom' ? cmd.to : undefined,
    })
    wx.hideLoading()
    let orders = r.ok ? r.orders : []
    const bounds = rangeBounds(range, { from: cmd.from || '', to: cmd.to || '' })
    if (orders.length) {
      const filtered = orders.filter((o) => {
        const d = orderCreatedAt(o.createdAt)
        if (!d) return false
        return d >= bounds.from && d <= bounds.to
      })
      if (filtered.length) orders = filtered
    }
    if (!orders.length) {
      this.showTopToast(r.ok ? '该时段没有账单' : r.error || '对账加载失败', 2800)
      return
    }
    const payload = buildStmtPreview(
      this.data.shop?.shopName || '图可',
      name,
      orders,
      bounds.label,
      cmd.unpaidOnly,
    )
    holdStmtPreview(payload)
    wx.navigateTo({
      url: '/pages/statement-preview/statement-preview',
      fail: (err) => {
        const msg = String((err && (err as any).errMsg) || '')
        console.error('[home] open statement-preview fail', msg)
        this.showTopToast(
          /timeout|download/i.test(msg) ? '分包加载超时，请重试' : t('openPreviewFail'),
          2500,
        )
      },
    })
  },

  buildCartItems(): CartItem[] {
    const items: CartItem[] = []
    for (const r of this.contentRows()) {
      const price = parseFloat(r.priceText) || 0
      const sign = this.data.isReturnMode ? -1 : 1
      const lines = r.skuLines || []
      if (lines.length) {
        for (const line of lines) {
          const qty = sign * Math.abs(Number(line.qty) || 0)
          if (!qty) continue
          items.push({
            productCode: r.productCode || r.productName.trim(),
            productName: r.productName.trim(),
            spec: line.spec || skuSpec(line.color, line.size),
            color: line.color || '',
            size: line.size || '',
            unit: r.unit || '件',
            price,
            quantity: qty,
            subtotal: qty * price,
            countInStats: r.countInStats !== false,
          })
        }
        continue
      }
      const qty = parseFloat(r.quantityText) || 0
      items.push({
        productCode: r.productCode || r.productName.trim(),
        productName: r.productName.trim(),
        spec: r.spec || skuSpec(r.color, r.size),
        color: r.color || '',
        size: r.size || '',
        unit: r.unit || '件',
        price,
        quantity: qty,
        subtotal: qty * price,
        countInStats: r.countInStats !== false,
      })
    }
    return items
  },

  buildTotals(items: CartItem[]) {
    let totalQuantity = 0
    let totalAmount = 0
    for (const it of items) {
      totalQuantity += Math.ceil(Math.abs(it.quantity)) * (it.quantity < 0 ? -1 : 1)
      // App uses ceil of quantity for piece count; keep amount as sum of subtotals
      totalAmount += it.subtotal
    }
    // Prefer App-like: totalQuantity = sum of ceil(qty)
    totalQuantity = items.reduce((s, it) => s + Math.ceil(it.quantity), 0)
    return { totalQuantity, totalAmount }
  },

  collectBillingTexts(): string[] {
    const rows = this.data.rows || []
    return [
      this.data.customerName,
      this.data.customerPhone,
      this.data.remark,
      this.data.aiText,
      ...(this.data.trackingNos || []),
      ...rows.map((r) => r.productName),
      ...rows.map((r) => r.productCode),
      ...rows.map((r) => r.unit),
      ...rows.flatMap((r) => (r.skuLines || []).map((x) => x.spec)),
    ]
  },

  async assertBillingInputsSafe(): Promise<boolean> {
    return assertMsgSecCheck(this.collectBillingTexts())
  },

  /** 对齐 App：从销售单进退单会清绑定；修改已有订单（含退单）原地更新。更换客户则另存。 */
  shouldSaveAsNew(opts?: { saveAsNew?: boolean }): boolean {
    if (opts?.saveAsNew) return true
    if (!this._editingOrderNo) return true
    return (
      customerKey(this.data.customerName, this.data.customerPhone) !==
      this._loadedCustomerKey
    )
  },

  resolveCreatedAt(saveAsNew: boolean): string {
    if (!saveAsNew) {
      const existing = findCachedOrder(this._editingOrderNo)
      const prev = String(existing?.createdAt || this._editingCreatedAt || '').trim()
      if (prev) return prev
    }
    return combineDateStrWithNow(this.data.dateStr)
  },

  bindEditingAfterSave(orderNo: string, createdAt: string) {
    this._editingOrderNo = orderNo
    this._editingCreatedAt = createdAt
    this._loadedCustomerKey = customerKey(
      this.data.customerName,
      this.data.customerPhone,
    )
    void this.refreshBillHead()
  },

  clearEditingBind() {
    this._editingOrderNo = ''
    this._editingCreatedAt = ''
    this._loadedCustomerKey = ''
  },

  async saveOrder(opts?: { saveAsNew?: boolean; asReturn?: boolean }): Promise<{
    ok: boolean
    orderNo?: string
    error?: string
    items?: CartItem[]
    totalAmount?: number
    totalQuantity?: number
  }> {
    const items = this.buildCartItems()
    if (!items.length) {
      return { ok: false, error: this.data.isReturnMode || opts?.asReturn ? '请先填写退货商品和数量' : '请先填写商品名和数量' }
    }
    if (!this.ensureCustomer()) return { ok: false, error: '请先选择客户' }
    if (!(await this.assertBillingInputsSafe())) {
      return { ok: false, error: '内容含违规信息，请修改后再试' }
    }

    const { totalQuantity, totalAmount } = this.buildTotals(items)
    const isReturn = !!(opts?.asReturn || this.data.isReturnMode)
    const saveAsNew = this.shouldSaveAsNew(opts)
    const existing =
      !saveAsNew && this._editingOrderNo
        ? findCachedOrder(this._editingOrderNo)
        : undefined
    if (!saveAsNew && existing && !canEditOrder(existing)) {
      return { ok: false, error: t('orderEditOwnOnly') }
    }
    const orderNo = saveAsNew ? genOrderNo() : this._editingOrderNo

    let remark = this.data.remark || ''
    if (isReturn && !remark.includes('退单')) {
      remark = `【${this.data.dateStr}退单】${remark}`.trim()
    }
    remark = remarkForSave(remark, isReturn)

    const createdAt = this.resolveCreatedAt(saveAsNew)

    const photoB64 = this.data.deliveryPhotoPath
      ? readLocalFileBase64(this.data.deliveryPhotoPath)
      : ''
    const r = await uploadOrder({
      orderNo,
      customerName: this.data.customerName,
      customerPhone: this.data.customerPhone,
      customerId: this.data.customerId || undefined,
      remark,
      totalAmount,
      totalQuantity,
      items,
      isReturn,
      returnReason: isReturn ? this._returnReason || '其他' : undefined,
      returnForDate: isReturn ? this.data.dateStr : undefined,
      isPaid: this.data.isPaid,
      isPickedUp: this.data.isPickedUp,
      isShipped: this.data.isShipped,
      isDelivered: this.data.isDelivered,
      trackingNos: this.data.trackingNos || [],
      createdAt,
      deliveryPhotoBase64: photoB64 || undefined,
      deliveryPhotoPath: this.data.deliveryPhotoPath || undefined,
    })

    if (!r.ok) return { ok: false, error: r.error }
    const stock = await applyAutoStockForOrder({
      orderNo: r.orderNo || orderNo,
      items,
      isReturn,
      replaceExisting: !saveAsNew,
      previousItems: existing?.items,
      previousIsReturn: existing?.isReturn,
    })
    if (stock.products.length) this._products = stock.products
    this.bindEditingAfterSave(r.orderNo || orderNo, createdAt)
    return {
      ok: true,
      orderNo: this._editingOrderNo,
      items,
      totalAmount,
      totalQuantity,
    }
  },

  async onSave() {
    if (this.data.saving) return
    if (!(await this.ensureCustomerSelected())) return
    this.setData({ saving: true })
    const r = await this.saveOrder()
    this.setData({ saving: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '保存失败', icon: 'none' })
      return
    }
    wx.showToast({
      title: '已保存',
      icon: 'success',
    })
  },

  async onSaveAs() {
    this.closeMore()
    if (this.data.saving) return
    if (!(await this.ensureCustomerSelected())) return
    this.setData({ saving: true })
    const r = await this.saveOrder({ saveAsNew: true })
    this.setData({ saving: false })
    if (!r.ok) {
      wx.showToast({ title: r.error || '另存失败', icon: 'none' })
      return
    }
    wx.showToast({
      title: '已另存',
      icon: 'success',
    })
  },

  async doPrint(_asReturn: boolean) {
    if (this.data.saving || this.data.printing) return
    if (!(await this.ensureCustomerSelected())) return
    // 以当前模式为准：选「销售单」会退出退单，选「退单」已先进入退单
    await this.openReceiptPreview({ asReturn: !!this.data.isReturnMode })
  },

  /** 打开票据预览。 */
  async openReceiptPreview(opts: { asReturn?: boolean }) {
    if (this.data.saving || this.data.printing) return
    const asReturn = !!opts.asReturn
    const items = this.buildCartItems()
    if (!items.length) {
      wx.showToast({
        title: asReturn || this.data.isReturnMode ? '请先填写退货商品和数量' : '请先填写商品名和数量',
        icon: 'none',
      })
      return
    }
    if (!(await this.ensureCustomerSelected())) return
    if (!(await this.assertBillingInputsSafe())) return

    const { totalQuantity, totalAmount } = this.buildTotals(items)
    const isReturn = !!(asReturn || this.data.isReturnMode)
    const saveAsNew = this.shouldSaveAsNew()
    const orderNo = saveAsNew ? genOrderNo() : this._editingOrderNo
    const createdAt = this.resolveCreatedAt(saveAsNew)

    let remark = this.data.remark || ''
    if (isReturn && !remark.includes('退单')) {
      remark = `【${this.data.dateStr}退单】${remark}`.trim()
    }
    remark = remarkForSave(remark, isReturn)

    const draft = {
      asReturn: isReturn,
      orderNo,
      createdAt,
      customerName: this.data.customerName,
      customerPhone: this.data.customerPhone,
      customerId: this.data.customerId || undefined,
      remark,
      dateStr: this.data.dateStr,
      items,
      totalAmount,
      totalQuantity,
      isPaid: this.data.isPaid,
      isPickedUp: this.data.isPickedUp,
      isShipped: this.data.isShipped,
      isDelivered: this.data.isDelivered,
      trackingNos: this.data.trackingNos || [],
      returnReason: isReturn ? this._returnReason || '其他' : undefined,
      returnForDate: isReturn ? this.data.dateStr : undefined,
      deliveryPhotoPath: this.data.deliveryPhotoPath || undefined,
      shop: this.data.shop,
    }

    wx.navigateTo({
      url: '/pages/receipt-preview/receipt-preview',
      events: {
        done: (data: { saved?: boolean; orderNo?: string }) => {
          if (!data?.saved) return
          this._editingOrderNo = data.orderNo || orderNo
          this.afterPrintClear()
        },
      },
      success: (res) => {
        res.eventChannel.emit('init', {
          draft,
        })
      },
      fail: () => {
        wx.showToast({ title: '打开票据预览失败', icon: 'none' })
      },
    })
  },

  afterPrintClear() {
    // 对齐 App：打印完成后清空本子
    this.clearEditingBind()
    this._returnReason = ''
    this._remarkBeforeReturn = ''
    this._undoSnapshot = null
    this.resetRows()
    this.setData({
      isReturnMode: false,
      isPaid: false,
      isPickedUp: false,
      isShipped: false,
      isDelivered: false,
      deliveryPhotoPath: '',
      delivSheetVisible: false,
      trackingNos: [],
      shippedLabel: t('shipped'),
      remark: '',
      dateStr: todayStr(),
      // 保留客户（App clearAll keepCustomer）
    })
    void this.refreshBillHead()
  },

  onPrint() {
    this.closeInputKeyboard()
    if (this.data.saving || this.data.printing) return
    // 蓝牙未连接也可点：进入票据预览后再连打印机
    // 退单模式下打退单，否则打销售单
    void this.doPrint(!!this.data.isReturnMode)
  },

  onReturnPrint() {
    this.closeInputKeyboard()
    if (this.data.saving || this.data.printing) return
    void this.startReturnPrint()
  },

  async startReturnPrint() {
    if (this.data.saving || this.data.printing) return
    if (!this.data.isReturnMode) {
      await this.beginReturnEntry()
      return
    }
    if (!(await this.ensureCustomerSelected())) return
    void this.doPrint(true)
  },
})
