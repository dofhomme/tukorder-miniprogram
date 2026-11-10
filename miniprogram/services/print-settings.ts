import { t } from './i18n'
import { getOrCreateClientId, request } from './api'
import { isGuest, isLoggedIn } from './session'
import { isCloudSyncAllowed } from './subscription'
import { ensurePrintPolicy } from './print-runtime-policy'

/** 打印设置本地存储（对齐 App PrintOptions + AdvancedSettings） */

const KEY = 'tuk_print_settings_v1'
const DIRTY_KEY = 'tuk_print_prefs_dirty_v1'
const MODE_CMD_MIGRATE_KEY = 'tuk_mp_print_mode_cmd_v1'
const ASK_REASON_OFF_KEY = 'tuk_ask_return_reason_off_v1'

let _mem: PrintSettings | null = null

export type PrintModeId = 'default' | 'compat' | 'dense' | 'raster'
export type FontScaleId = 'small' | 'standard' | 'large' | 'xlarge'
export type FontFaceId = 'hei' | 'song' | 'kai' | 'fang'

export interface PrintSettings {
  printLineNumber: boolean
  printArrears: boolean
  printAddress: boolean
  autoSaveOrderAfterPrint: boolean
  printMissingCorrection: number
  printMode: PrintModeId
  printFontScale: FontScaleId
  /** 小票字体。位图打印和预览生效 */
  printFontFace: FontFaceId
  showCostOnInput: boolean
  autoStockOutOnSave: boolean
  printTime: boolean
  printBarcode: boolean
  productNameSuggestions: boolean
  /** 首页退单最后一步是否弹出原因选择。 */
  askReturnReason: boolean
}

export const PRINT_MODE_OPTIONS: { id: PrintModeId; label: string }[] = [
  { id: 'default', label: '默认（位图）' },
  { id: 'compat', label: '兼容模式' },
  { id: 'dense', label: '压缩模式' },
  { id: 'raster', label: '位图模式' },
]

export const FONT_SCALE_OPTIONS: { id: FontScaleId; label: string }[] = [
  { id: 'small', label: '偏小' },
  { id: 'standard', label: '标准' },
  { id: 'large', label: '偏大' },
  { id: 'xlarge', label: '大号' },
]

export const defaultPrintSettings = (): PrintSettings => ({
  printLineNumber: true,
  printArrears: false,
  printAddress: true,
  autoSaveOrderAfterPrint: true,
  printMissingCorrection: 0,
  printMode: 'default',
  printFontScale: 'standard',
  printFontFace: 'hei',
  showCostOnInput: false,
  autoStockOutOnSave: true,
  printTime: false,
  printBarcode: false,
  productNameSuggestions: true,
  askReturnReason: false,
})

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 1 || v === '1' || v === 'true') return true
  if (v === 0 || v === '0' || v === 'false') return false
  return fallback
}

function normalizePrintSettings(input: Partial<PrintSettings> | null | undefined): PrintSettings {
  const d = defaultPrintSettings()
  const s = { ...d, ...(input && typeof input === 'object' ? input : {}) }
  s.printLineNumber = asBool(s.printLineNumber, d.printLineNumber)
  s.printArrears = asBool(s.printArrears, d.printArrears)
  s.printAddress = asBool(s.printAddress, d.printAddress)
  s.autoSaveOrderAfterPrint = asBool(s.autoSaveOrderAfterPrint, d.autoSaveOrderAfterPrint)
  s.showCostOnInput = asBool(s.showCostOnInput, d.showCostOnInput)
  s.autoStockOutOnSave = asBool(s.autoStockOutOnSave, d.autoStockOutOnSave)
  s.printTime = asBool(s.printTime, d.printTime)
  s.printBarcode = asBool(s.printBarcode, d.printBarcode)
  s.productNameSuggestions = asBool(s.productNameSuggestions, d.productNameSuggestions)
  s.askReturnReason = asBool(s.askReturnReason, d.askReturnReason)
  const n = Number(s.printMissingCorrection)
  s.printMissingCorrection = Number.isFinite(n) ? Math.max(0, Math.min(99, Math.floor(n))) : 0
  const mode = String(s.printMode || '')
  s.printMode =
    mode === 'default' || mode === 'compat' || mode === 'dense' || mode === 'raster'
      ? mode
      : d.printMode
  const font = String(s.printFontScale || '')
  s.printFontScale =
    font === 'small' || font === 'standard' || font === 'large' || font === 'xlarge'
      ? font
      : d.printFontScale
  const face = String(s.printFontFace || '')
  s.printFontFace =
    face === 'hei' || face === 'song' || face === 'kai' || face === 'fang' ? face : d.printFontFace
  return s
}

export function markPrintPrefsDirty() {
  try {
    wx.setStorageSync(DIRTY_KEY, Date.now())
  } catch (_) {}
}

export function clearPrintPrefsDirty() {
  try {
    wx.removeStorageSync(DIRTY_KEY)
  } catch (_) {}
}

/** 本机刚改过、云端尚未确认时，禁止用旧 prefs 覆盖 */
export function isPrintPrefsDirty(): boolean {
  try {
    return !!wx.getStorageSync(DIRTY_KEY)
  } catch (_) {
    return false
  }
}

/** 旧版本默认要选退单原因。只关一次，之后用户自己打开的保留。 */
function finishAskReasonDefault(s: PrintSettings): PrintSettings {
  try {
    if (wx.getStorageSync(ASK_REASON_OFF_KEY)) return { ...s }
    wx.setStorageSync(ASK_REASON_OFF_KEY, 1)
  } catch (_) {
    return { ...s }
  }
  s.askReturnReason = false
  persistLocal(s)
  markPrintPrefsDirty()
  schedulePushPrintSettings()
  return { ...(_mem || s) }
}

export function loadPrintSettings(): PrintSettings {
  if (_mem) return { ..._mem }
  try {
    let raw: unknown = wx.getStorageSync(KEY)
    if (typeof raw === 'string' && raw) {
      try {
        raw = JSON.parse(raw)
      } catch (_) {
        raw = null
      }
    }
    if (raw && typeof raw === 'object') {
      _mem = normalizePrintSettings(raw as Partial<PrintSettings>)
      try {
        if (!wx.getStorageSync(MODE_CMD_MIGRATE_KEY)) {
          wx.setStorageSync(MODE_CMD_MIGRATE_KEY, 1)
          if (_mem.printMode === 'raster') {
            _mem.printMode = 'default'
            persistLocal(_mem)
          }
        }
      } catch (_) {}
      return finishAskReasonDefault(_mem)
    }
  } catch (e) {
    /* ignore */
  }
  _mem = defaultPrintSettings()
  return finishAskReasonDefault(_mem)
}

function printOptionsBlock(s: PrintSettings) {
  return {
    'print_opt.line_no': s.printLineNumber,
    'print_opt.arrears': s.printArrears,
    'print_opt.address': s.printAddress,
    'print_opt.auto_save': s.autoSaveOrderAfterPrint,
    'print_opt.correction': s.printMissingCorrection,
    'print_opt.mode': s.printMode,
    'print_opt.font_scale': s.printFontScale,
    'print_opt.font_face': s.printFontFace,
  }
}

function advancedSettingsBlock(s: PrintSettings) {
  return {
    'adv.show_cost': s.showCostOnInput,
    'adv.auto_stock_out': s.autoStockOutOnSave,
    'adv.print_time': s.printTime,
    'adv.print_barcode': s.printBarcode,
    'adv.suggestions': s.productNameSuggestions,
    'adv.ask_return_reason': s.askReturnReason,
  }
}

function persistLocal(s: PrintSettings): PrintSettings {
  const normalized = normalizePrintSettings(s)
  wx.setStorageSync(KEY, JSON.parse(JSON.stringify(normalized)))
  _mem = normalized
  return normalized
}

let _pushTimer = 0 as number
let _pushing = false
let _pushAgain = false

/** 规范化后落盘，返回实际写入值。已登录且开通云同步时后台合并上传，避免再进页被旧云端覆盖。 */
export function savePrintSettings(s: PrintSettings): PrintSettings {
  const normalized = persistLocal(s)
  markPrintPrefsDirty()
  schedulePushPrintSettings()
  return normalized
}

export function schedulePushPrintSettings() {
  if (_pushTimer) clearTimeout(_pushTimer)
  _pushTimer = setTimeout(() => {
    _pushTimer = 0
    void pushPrintSettingsToCloud()
  }, 480) as unknown as number
}

export async function flushPushPrintSettings() {
  if (_pushTimer) {
    clearTimeout(_pushTimer)
    _pushTimer = 0
  }
  await pushPrintSettingsToCloud()
}

function attachLocalPrintTemplate(prefs: Record<string, unknown>) {
  try {
    const mod = require('./print-template') as {
      printTemplateCloudBlock?: () => Record<string, unknown> | null
    }
    const block = mod.printTemplateCloudBlock?.()
    if (block) prefs.printTemplate = block
  } catch (_) {}
}

export async function pushPrintSettingsToCloud(s?: PrintSettings) {
  if (isGuest() || !isLoggedIn() || !isCloudSyncAllowed()) return
  if (_pushing) {
    _pushAgain = true
    return
  }
  _pushing = true
  try {
    do {
      _pushAgain = false
      const local = s || loadPrintSettings()
      s = undefined
      const clientId = encodeURIComponent(getOrCreateClientId())
      const got = await request<{ hasPrefs?: boolean; prefs?: Record<string, unknown> }>({
        path: `/api/v1/team/prefs?clientId=${clientId}`,
        method: 'GET',
        needAuth: true,
      })
      if (!got.ok) return
      const prefs: Record<string, unknown> =
        got.data?.hasPrefs && got.data.prefs && typeof got.data.prefs === 'object'
          ? { ...got.data.prefs }
          : { version: 3 }
      prefs.printOptions = printOptionsBlock(local)
      prefs.advancedSettings = advancedSettingsBlock(local)
      attachLocalPrintTemplate(prefs)
      const posted = await request({
        path: '/api/v1/team/prefs',
        method: 'POST',
        needAuth: true,
        data: { clientId: getOrCreateClientId(), prefs },
      })
      if (posted.ok) clearPrintPrefsDirty()
    } while (_pushAgain)
  } catch (_) {
    /* 本机已保存，云端失败不回滚 */
  } finally {
    _pushing = false
  }
}

/** 从云端 team prefs.printOptions（print_opt.*）写入本地，对齐 App */
export function applyPrintOptionsFromPrefs(prefs: Record<string, unknown> | null | undefined) {
  if (!prefs || typeof prefs !== 'object') return
  const block = (prefs as any).printOptions
  if (!block || typeof block !== 'object') return
  const s = loadPrintSettings()
  const boolKeys: Array<[string, keyof PrintSettings]> = [
    ['print_opt.line_no', 'printLineNumber'],
    ['print_opt.arrears', 'printArrears'],
    ['print_opt.address', 'printAddress'],
    ['print_opt.auto_save', 'autoSaveOrderAfterPrint'],
  ]
  for (const [k, field] of boolKeys) {
    if (typeof block[k] === 'boolean') (s as any)[field] = block[k]
  }
  if (typeof block['print_opt.correction'] === 'number') {
    s.printMissingCorrection = Math.max(0, Math.min(99, block['print_opt.correction']))
  }
  const mode = String(block['print_opt.mode'] || '')
  // 默认=位图。云端位图/空值落到「默认」；仅兼容/压缩保留指令。
  if (mode === 'compat' || mode === 'dense') {
    s.printMode = mode
  } else {
    s.printMode = 'default'
  }
  const font = String(block['print_opt.font_scale'] || '')
  if (font === 'small' || font === 'standard' || font === 'large' || font === 'xlarge') {
    s.printFontScale = font
  }
  const face = String(block['print_opt.font_face'] || '')
  if (face === 'hei' || face === 'song' || face === 'kai' || face === 'fang') {
    s.printFontFace = face
  }
  const adv = (prefs as any).advancedSettings
  if (adv && typeof adv === 'object') {
    if (typeof adv['adv.show_cost'] === 'boolean') s.showCostOnInput = adv['adv.show_cost']
    if (typeof adv['adv.auto_stock_out'] === 'boolean') s.autoStockOutOnSave = adv['adv.auto_stock_out']
    if (typeof adv['adv.print_time'] === 'boolean') s.printTime = adv['adv.print_time']
    if (typeof adv['adv.print_barcode'] === 'boolean') s.printBarcode = adv['adv.print_barcode']
    if (typeof adv['adv.suggestions'] === 'boolean') s.productNameSuggestions = adv['adv.suggestions']
    if (typeof adv['adv.ask_return_reason'] === 'boolean' && !isPrintPrefsDirty()) {
      s.askReturnReason = adv['adv.ask_return_reason']
    }
  }
  persistLocal(s)
}

export function printModeLabel(id: PrintModeId): string {
  if (id === 'compat') return t('modeCompat')
  if (id === 'dense') return t('modeDense')
  if (id === 'raster') return t('modeRaster')
  return t('modeDefault')
}

/**
 * 微信 BLE 默认必须走位图。
 * 改策略后曾按后台 defaultOutput=text 改发 GBK 指令，便携机只会走一点空白纸就停。
 * 与 2026-09-13 已打通版本一致：默认 true；仅「兼容/压缩」才走指令。
 */
export function shouldUseRasterPrint(): boolean {
  try {
    const s = loadPrintSettings()
    if (s.printMode === 'compat' || s.printMode === 'dense') return false
  } catch (_) {}
  return true
}

void ensurePrintPolicy()

export function fontScaleLabel(id: FontScaleId): string {
  if (id === 'small') return t('fontSmall')
  if (id === 'large') return t('fontLarge')
  if (id === 'xlarge') return t('fontXLarge')
  return t('fontStd')
}

/** 指令/画布字号倍率：默认标准 */
export function printFontZoom(id?: FontScaleId): number {
  const s = id || loadPrintSettings().printFontScale
  if (s === 'xlarge') return 3
  if (s === 'large') return 2
  return 1
}

export const FONT_FACE_OPTIONS: Array<{ id: FontFaceId; label: string; stack: string }> = [
  { id: 'hei', label: '黑体', stack: "'PingFang SC','Heiti SC','Microsoft YaHei',sans-serif" },
  { id: 'song', label: '宋体', stack: "'Songti SC','STSong','SimSun',serif" },
  { id: 'kai', label: '楷体', stack: "'Kaiti SC','STKaiti','KaiTi',serif" },
  { id: 'fang', label: '仿宋', stack: "'FangSong','STFangsong',serif" },
]

export function fontIdOf(stack: string): FontFaceId {
  const text = String(stack || '')
  if (text.indexOf('Songti') >= 0 || text.indexOf('SimSun') >= 0 || text.indexOf('STSong') >= 0) return 'song'
  if (text.indexOf('Kaiti') >= 0 || text.indexOf('KaiTi') >= 0 || text.indexOf('STKaiti') >= 0) return 'kai'
  if (text.indexOf('FangSong') >= 0 || text.indexOf('STFangsong') >= 0) return 'fang'
  if (!text) return loadPrintSettings().printFontFace
  return 'hei'
}

export function receiptFaceClass(id?: FontFaceId): string {
  const face = id || loadPrintSettings().printFontFace
  if (face === 'song') return 'face-song'
  if (face === 'kai') return 'face-kai'
  if (face === 'fang') return 'face-fang'
  return 'face-hei'
}

export function receiptFontStack(id?: FontFaceId): string {
  const face = id || loadPrintSettings().printFontFace
  return FONT_FACE_OPTIONS.find((item) => item.id === face)?.stack || FONT_FACE_OPTIONS[0].stack
}

export function printFontCanvasScale(id?: FontScaleId): number {
  const s = id || loadPrintSettings().printFontScale
  if (s === 'small') return 0.83
  if (s === 'large') return 1.17
  if (s === 'xlarge') return 1.42
  return 1
}
