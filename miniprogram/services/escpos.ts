/**
 * ESC/POS 文本小票字节流（对齐 App EscPosCompat：ESC@ + FS& + ESC t 16 + GBK + LF）
 */
import { loadPrintTemplate, resolvePrintLayout } from './print-template'
import { loadPrintSettings, printFontZoom } from './print-settings'
import {
  getReceiptTemplateDef,
  groupReceiptStyles,
  mapReceiptItems,
  shopContactParts,
  presentReceiptItems,
  receiptPrintFlags,
  signReturnItems,
  signedReceiptAmount,
} from './receipt-layout'
import {
  dotsPerLine,
  gbkDashCount,
  normalizePaperWidthMm,
  type PaperWidthMm,
} from './thermal-paper'
import { chineseAmountUpper } from '../utils/chinese-amount'
import type { PrintTemplateTypeId } from './print-template'
import { ensureGbk } from './pack-lazy'

type GbkEncode = { encode: (s: string) => number[] }
let gbk: GbkEncode | null = null

export function prepareGbk(): Promise<void> {
  if (gbk) return Promise.resolve()
  return ensureGbk().then((mod) => {
    gbk = mod
  })
}

export function encodeGbk(text: string): number[] {
  const GBK = gbk
  try {
    if (!GBK) throw new Error('gbk')
    return GBK.encode(String(text || ''))
  } catch (_) {
    const out: number[] = []
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c < 0x80) out.push(c)
      else {
        try {
          if (!GBK) throw new Error('gbk')
          out.push(...GBK.encode(text[i]))
        } catch {
          out.push(0x3f)
        }
      }
    }
    return out
  }
}

export class EscPosBuilder {
  private buf: number[] = []
  extraLineFeeds = 0

  constructor(
    initialize = true,
    mode: 'default' | 'compat' | 'dense' | 'raster' = 'default',
  ) {
    if (!initialize) return
    if (mode === 'compat') this.writeCompatibleInit()
    else this.writeStandardInit()
  }

  writeStandardInit() {
    // ESC @ → FS & → ESC t 16 (GBK) → ESC M 0 选 Font A（避免便携机默认 Font B 字特别小）
    this.buf.push(0x1b, 0x40, 0x1c, 0x26, 0x1b, 0x74, 0x10, 0x1b, 0x4d, 0x00)
  }

  /** 中文模式下列 ASCII 横线常打不出来，用 GBK 制表符 */
  dash() {
    const paper = (() => {
      try {
        const raw = wx.getStorageSync('tuk_ble_printer') as { paperWidthMm?: number }
        return normalizePaperWidthMm(raw?.paperWidthMm)
      } catch {
        return 80
      }
    })()
    const n = gbkDashCount(paper)
    const ch = encodeGbk('─').length >= 2 ? '─' : '－'
    this.text(ch.repeat(n))
  }

  writeCompatibleInit() {
    this.writeStandardInit()
    this.buf.push(0x1b, 0x52, 0x0f)
  }

  align(a: 0 | 1 | 2) {
    this.buf.push(0x1b, 0x61, a)
  }

  bold(on: boolean) {
    this.buf.push(0x1b, 0x45, on ? 1 : 0)
  }

  size(zoom: number) {
    const z = Math.max(1, Math.min(4, zoom | 0))
    const n = ((z - 1) << 4) | (z - 1)
    this.buf.push(0x1d, 0x21, n)
  }

  raw(bytes: number[]) {
    this.buf.push(...bytes)
  }

  linefeed(n = 1) {
    for (let i = 0; i < n; i++) this.buf.push(0x0a)
  }

  text(
    content: string,
    opts?: { align?: 0 | 1 | 2; bold?: boolean; zoom?: number },
  ) {
    const align = opts?.align ?? 0
    const bold = !!opts?.bold
    const zoom = opts?.zoom ?? 1
    this.align(align)
    if (bold) this.bold(true)
    if (zoom !== 1) this.size(zoom)
    const cleaned = String(content || '').replace(/[\r\n]+/g, ' ')
    this.buf.push(...encodeGbk(cleaned))
    if (zoom !== 1) this.size(1)
    if (bold) this.bold(false)
    this.buf.push(0x0a)
    if (this.extraLineFeeds > 0) this.linefeed(this.extraLineFeeds)
  }

  textBlock(block: string, opts?: { align?: 0 | 1 | 2; bold?: boolean; zoom?: number }) {
    for (const raw of String(block || '').split('\n')) {
      const line = raw.replace(/\r/g, '')
      if (!line) this.linefeed()
      else this.text(line, opts)
    }
  }

  /** 文本小票收尾：ESC d n + LF×4（便携机无切刀，对齐 App writeTextFinish） */
  finish(feedLines = 4) {
    const n = Math.max(1, Math.min(10, feedLines))
    this.buf.push(0x1b, 0x64, n)
    for (let i = 0; i < 4; i++) this.buf.push(0x0a)
  }

  /**
   * 位图小票收尾，对齐 App 光栅：
   * 末带 LF + linefeed() + linefeed(2)，再 ESC d 4、LF×4、部分切纸。
   */
  finishRasterLikeApp() {
    this.linefeed(4)
    this.buf.push(0x1b, 0x64, 4)
    for (let i = 0; i < 4; i++) this.buf.push(0x0a)
    this.buf.push(0x1d, 0x56, 0x42, 0x00)
  }

  build(): Uint8Array {
    return new Uint8Array(this.buf)
  }
}

export function buildReceiptEscPos(opts: {
  template?: PrintTemplateTypeId
  shopName?: string
  footer?: string
  address?: string
  phone?: string
  orderNo: string
  customerName?: string
  customerPhone?: string
  handler?: string
  remark?: string
  items: Array<{
    productCode: string
    productName: string
    spec?: string
    unit?: string
    price: number
    quantity: number
    subtotal: number
  }>
  totalAmount: number
  totalQuantity: number
  createdAt?: string
  isReturn?: boolean
  showLineNumber?: boolean
}): Uint8Array {
  const settings = loadPrintSettings()
  const flags = receiptPrintFlags(opts.customerName, !!opts.isReturn)
  const b = new EscPosBuilder(true, settings.printMode)
  b.extraLineFeeds = settings.printMissingCorrection
  const bodyZoom = printFontZoom(settings.printFontScale)
  const titleZoom = Math.min(4, bodyZoom + 1)
  const stored = loadPrintTemplate()
  const layout = resolvePrintLayout({ ...stored, template: opts.template || stored.template }, !!opts.isReturn)
  const def = getReceiptTemplateDef(layout.templateId)
  const columns = layout.columns || def.columns
  const shop = layout.blocks.title ? (opts.shopName || '图可').trim() || '图可' : ''
  const footer = layout.blocks.footer ? opts.footer : ''
  const printedAt = layout.blocks.printedAt ? nowPrintLabel() : ''
  const rows = signReturnItems(
    presentReceiptItems(
      def.id,
      mapReceiptItems(opts.items || [], {
        showBarcode: flags.showBarcode,
        showLineNumber:
          typeof opts.showLineNumber === 'boolean' ? opts.showLineNumber : flags.showLineNumber,
      }),
    ),
    !!opts.isReturn,
  )
  const payAmount = signedReceiptAmount(opts.totalAmount, !!opts.isReturn)
  const arrearsLine =
    flags.showArrears && flags.customerArrears != null
      ? `欠款:¥${Number(flags.customerArrears).toFixed(2)}`
      : ''
  const contactParts = shopContactParts(opts.address, opts.phone)
  const contact = {
    addressLine: flags.showAddress ? contactParts.addressLine : '',
    phoneLine: flags.showShopTel ? contactParts.phoneLine : '',
  }
  const writeContact = () => {
    if (contact.addressLine) b.text(contact.addressLine, { align: 1, zoom: bodyZoom })
    if (contact.phoneLine) b.text(contact.phoneLine, { align: 1, zoom: bodyZoom })
  }

  if (def.kind === 'payment') {
    if (opts.isReturn) {
      b.text('【退单】', { align: 1, bold: true, zoom: titleZoom })
      b.text(shop, { align: 1, bold: true, zoom: titleZoom })
    } else {
      b.text('收款收据', { align: 1, bold: true, zoom: titleZoom })
    }
    writeContact()
    b.dash()
    if (opts.customerName) b.text(`客户:${opts.customerName}`, { zoom: bodyZoom })
    if (arrearsLine) b.text(arrearsLine, { zoom: bodyZoom })
    if (opts.customerPhone) b.text(`电话:${opts.customerPhone}`, { zoom: bodyZoom })
    if (opts.createdAt) b.text(`日期:${opts.createdAt}`, { zoom: bodyZoom })
    if (printedAt) b.text(`打印时间:${printedAt}`, { zoom: bodyZoom })
    b.dash()
    b.text(`今收到 ${opts.customerName || '客户'} 货款`, { zoom: bodyZoom })
    b.text(chineseAmountUpper(payAmount), { align: 1, bold: true, zoom: bodyZoom })
    b.text(`¥${fmtMoney(payAmount)}`, { align: 1, bold: true, zoom: bodyZoom })
    if (footer) b.textBlock(footer, { align: 1, zoom: bodyZoom })
    b.linefeed(2)
    b.finish(4)
    return b.build()
  }

  if (opts.isReturn) {
    b.text('【退单】', { align: 1, bold: true, zoom: titleZoom })
    if (shop) b.text(shop, { align: 1, bold: true, zoom: titleZoom })
  } else if (shop) {
    b.text(shop, { align: 1, bold: true, zoom: titleZoom })
  }
  writeContact()
  b.dash()
  if (opts.isReturn) b.text(`单号:${opts.orderNo}`, { zoom: bodyZoom })
  if (opts.customerName) b.text(`客户:${opts.customerName}`, { zoom: bodyZoom })
  if (arrearsLine) b.text(arrearsLine, { zoom: bodyZoom })
  if (opts.customerPhone) b.text(`电话:${opts.customerPhone}`, { zoom: bodyZoom })
  if (opts.createdAt) b.text(`日期:${opts.createdAt}`, { zoom: bodyZoom })
  if (printedAt) b.text(`打印时间:${printedAt}`, { zoom: bodyZoom })
  if (opts.isReturn && opts.handler) b.text(`经办:${opts.handler}`, { zoom: bodyZoom })
  b.dash()

  const garment = def.kind === 'pickup' || def.kind === 'colorsize'
  if (garment) {
    const groups = groupReceiptStyles(rows, !!opts.isReturn)
    if (def.kind === 'pickup') {
      for (const g of groups) {
        b.text(g.code, { bold: true, zoom: bodyZoom })
        for (const row of g.rows) {
          const spec = [row.color, row.size].filter(Boolean).join(' / ') || '—'
          b.text(`  ${spec}  ${row.qtyPlain}x${row.priceLabel}  ${row.subLabel}`, { zoom: bodyZoom })
        }
      }
    } else if (def.kind === 'colorsize') {
      for (const g of groups) {
        b.text(g.code, { bold: true, zoom: bodyZoom })
        b.text('颜色  尺码  件数  单价', { zoom: bodyZoom })
        for (const row of g.rows) {
          b.text(`${row.color || '—'}  ${row.size || '—'}  ${row.qtyPlain}  ${row.priceLabel}`, { zoom: bodyZoom })
        }
        b.text(`小计 ${g.qtyLabel}件 ¥${g.amountLabel}`, { align: 2, zoom: bodyZoom })
      }
    } else if (def.kind === 'piece') {
      for (const row of rows) {
        b.text(`${row.qtyPlain}  ${row.styleCode}  ${row.color} ${row.size}  ${row.subLabel}`, {
          bold: true,
          zoom: bodyZoom,
        })
      }
    } else if (def.kind === 'settle') {
      b.text('款号  件数  金额', { zoom: bodyZoom })
      for (const g of groups) b.text(`${g.code}  ${g.qtyLabel}  ${g.amountLabel}`, { zoom: bodyZoom })
    } else {
      b.text('款号  颜色  尺码  件数  单价  金额', { zoom: bodyZoom })
      for (const row of rows) {
        b.text(
          `${row.styleCode}  ${row.color || '—'}  ${row.size || '—'}  ${row.qtyPlain}  ${row.priceLabel}  ${row.subLabel}`,
          { zoom: bodyZoom },
        )
      }
    }
  } else {
  const header = columns.map((c) => c.label).join('  ')
  if (header) b.text(header, { zoom: bodyZoom })
  b.dash()
  for (const it of rows) {
    const cells = columns.map((col) => {
      switch (col.field) {
        case 'code':
          return it.lineNo ? `${it.lineNo} ${it.code || ''}` : it.code || ''
        case 'name':
          return it.name || it.code || ''
        case 'spec':
          return (it.spec || '').trim() || '—'
        case 'color':
          return it.color || '—'
        case 'size':
          return it.size || '—'
        case 'unit':
          return it.unit || '件'
        case 'qtyLabel':
          return it.qtyLabel
        case 'priceLabel':
          return it.priceLabel
        case 'subLabel':
          return it.subLabel
        default:
          return ''
      }
    })
    b.text(cells.join('  '), { zoom: bodyZoom })
  }
  }
  b.dash()
  const pieceTotal = opts.isReturn ? Math.abs(Number(opts.totalQuantity) || 0) : opts.totalQuantity
  const qtyWord =
    garment || def.kind === 'piece' || def.kind === 'settle' || def.kind === 'across' ? '件数' : '数量'
  b.text(`${qtyWord}: ${fmt(pieceTotal)}    合计: ¥${fmtMoney(payAmount)}`, {
    zoom: bodyZoom,
  })
  if (def.kind === 'delivery') {
    b.text('签收人：____________', { zoom: bodyZoom })
    b.text('签收时间：____________', { zoom: bodyZoom })
  }
  if (opts.remark) b.text(`备注:${opts.remark}`, { zoom: bodyZoom })
  if (footer) b.textBlock(footer, { align: 1, zoom: bodyZoom })
  b.linefeed(2)
  b.finish(4)
  return b.build()
}

function nowPrintLabel(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '0'
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v))
  return Number(v).toFixed(2)
}

function fmtMoney(v: number): string {
  if (!Number.isFinite(v)) return '0.00'
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v))
  return Number(v).toFixed(2)
}

/** 对齐 App EscPosBitmap.luminanceThreshold */
const RASTER_LUM = 185

export function countDarkRgba(rgba: ArrayLike<number>, step = 1): number {
  let n = 0
  const stride = Math.max(1, step) * 4
  for (let i = 0; i + 2 < rgba.length; i += stride) {
    if (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2] < RASTER_LUM) n++
  }
  return n
}

/** 位图模式：RGBA → GS v 0 光栅（对齐 App EscPosBuilder.image） */
export function buildRasterEscPosFromRgba(
  rgba: ArrayLike<number>,
  srcW: number,
  srcH: number,
  paperWidthMm: PaperWidthMm | number,
): Uint8Array {
  const targetW = dotsPerLine(paperWidthMm)
  const sameW = srcW === targetW
  const targetH = Math.max(1, sameW ? srcH : Math.round(srcH * (targetW / Math.max(1, srcW))))
  const widthBytes = (targetW + 7) >> 3
  const b = new EscPosBuilder(true, 'default')
  const BAND = 160
  // 切刀在打印头上方大约 10 毫米。只留 2 毫米的话，会切进收款码和注意事项
  const tailDots = Math.max(120, Math.round(targetW * 0.18))
  const darkAt = (ty: number) => {
    const sy = sameW ? Math.min(srcH - 1, ty) : Math.min(srcH - 1, Math.round((ty * srcH) / targetH))
    const row = sy * srcW
    for (let x = 0; x < targetW; x++) {
      const sx = sameW ? x : Math.min(srcW - 1, Math.round((x * srcW) / targetW))
      const p = (row + sx) * 4
      if (rgba[p] + rgba[p + 1] + rgba[p + 2] < 555) return true
    }
    return false
  }
  let lastDark = -1
  for (let y = 0; y < targetH; y++) {
    if (darkAt(y)) lastDark = y
  }
  if (lastDark < 0) {
    throw new Error('预览图是空白，位图没有字')
  }
  const endH = Math.min(targetH, lastDark + 1 + tailDots)
  let darkDots = 0
  for (let y0 = 0; y0 < endH; y0 += BAND) {
    const bh = Math.min(BAND, endH - y0)
    const raster = new Uint8Array(widthBytes * bh)
    let bandDark = 0
    for (let y = 0; y < bh; y++) {
      const sy = sameW
        ? Math.min(srcH - 1, y0 + y)
        : Math.min(srcH - 1, Math.round(((y0 + y) * srcH) / targetH))
      const row = sy * srcW
      for (let x = 0; x < targetW; x++) {
        const sx = sameW ? x : Math.min(srcW - 1, Math.round((x * srcW) / targetW))
        const p = (row + sx) * 4
        if (rgba[p] + rgba[p + 1] + rgba[p + 2] >= 555) continue
        raster[y * widthBytes + (x >> 3)] |= 1 << (7 - (x & 7))
        bandDark++
      }
    }
    darkDots += bandDark
    // 中间全白条跳过；最后一行下面的页边距必须留下
    if (!bandDark && y0 + bh <= lastDark + 1) continue
    b.align(1)
    b.raw([
      0x1d, 0x76, 0x30, 0x00,
      widthBytes & 0xff, (widthBytes >> 8) & 0xff,
      bh & 0xff, (bh >> 8) & 0xff,
    ])
    b.raw(Array.from(raster))
  }
  if (darkDots < 40) {
    throw new Error('预览图是空白，位图没有字')
  }
  b.finishRasterLikeApp()
  return b.build()
}

export function isRasterEscPos(data: Uint8Array): boolean {
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0x1d && data[i + 1] === 0x76 && data[i + 2] === 0x30) return true
  }
  return false
}

export function chunkRaw(data: Uint8Array, chunkSize: number): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let i = 0; i < data.length; i += chunkSize) {
    out.push(data.subarray(i, Math.min(i + chunkSize, data.length)))
  }
  return out
}

/** 安全分包（避免切断 GBK 双字节 / ESC 指令） */
export function chunkEscPos(data: Uint8Array, chunkSize = 180): Uint8Array[] {
  const out: Uint8Array[] = []
  let i = 0
  while (i < data.length) {
    let end = Math.min(i + chunkSize, data.length)
    if (end < data.length) {
      // 回退：不切在可能的 GBK 第二字节或 ESC 序列中间
      let guard = 0
      while (end > i + 1 && guard < 8) {
        const prev = data[end - 1]
        if (prev === 0x1b || prev === 0x1d || prev === 0x1c) {
          end -= 1
          guard++
          continue
        }
        // GBK lead byte often >= 0x81
        if (prev >= 0x81 && end - i >= 2) {
          // 粗略：若奇数长度从非 ASCII 起可能切错，再退一字节
          const slice = data.subarray(i, end)
          let odd = false
          for (let k = 0; k < slice.length; k++) {
            if (slice[k] < 0x80) continue
            if (k + 1 >= slice.length) {
              odd = true
              break
            }
            k++
          }
          if (odd) {
            end -= 1
            guard++
            continue
          }
        }
        break
      }
    }
    out.push(data.subarray(i, end))
    i = end
  }
  return out
}
