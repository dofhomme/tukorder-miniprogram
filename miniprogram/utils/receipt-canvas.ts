import { getPaperWidthMm } from '../services/bluetooth'
import { qrModuleGrid } from './arrival-qr'
import { printFontCanvasScale, receiptFontStack } from '../services/print-settings'
import type { ReceiptColumnDef, ReceiptRenderModel } from '../services/receipt-layout'
import { dotsPerLine } from '../services/thermal-paper'
import { shopLogoDataUrl } from './logo-file'
import {
  RECEIPT_QR_BLOCK_H_LOOKUP,
  RECEIPT_QR_BLOCK_H_PAY,
  RECEIPT_QR_CANVAS_SIZE,
  receiptHeaderQrCssSize,
} from '../utils/return-receipt'

export type CanvasDrawOpts = {
  forPrint?: boolean
  skipImages?: boolean
}

/** 超出列宽时截断，避免画出纸边 */
function fitText(ctx: any, text: string, maxWidth: number): string {
  const s = String(text || '')
  if (!s || maxWidth <= 0) return s
  if (ctx.measureText(s).width <= maxWidth) return s
  let t = s
  const ell = '…'
  while (t.length > 1 && ctx.measureText(t + ell).width > maxWidth) {
    t = t.slice(0, -1)
  }
  return t + ell
}

function colX(
  columns: ReceiptColumnDef[],
  pad: number,
  innerW: number,
  idx: number,
  lineSlot = 0,
): number {
  let x = pad + 2
  const totalFlex = columns.reduce((s, c) => s + c.flex, 0) || 1
  const slot = lineSlot > 0 && columns.some((c) => c.field === 'code') ? lineSlot : 0
  const flexW = Math.max(1, innerW - slot)
  for (let i = 0; i < idx; i++) {
    if (slot && columns[i].field === 'code') x += slot
    x += (flexW * columns[i].flex) / totalFlex
  }
  if (slot && columns[idx] && columns[idx].field === 'code') x += slot
  return x
}

/** 数量列：第一个数字的中心落在列中间，后面的位数往右排 */
function drawQtyLead(
  ctx: any,
  text: string,
  x: number,
  colW: number,
  y: number,
): void {
  const fitted = fitText(ctx, text, Math.max(8, colW))
  const first = fitted.slice(0, 1)
  const firstW = first ? ctx.measureText(first).width : 0
  ctx.textAlign = 'left'
  ctx.fillText(fitted, x + colW / 2 - firstW / 2, y)
}

/** 按宽度自动换行；preserveBreaks 时先按后台设置的换行符分行 */
function wrapTextLines(
  ctx: any,
  text: string,
  maxWidth: number,
  preserveBreaks = false,
): string[] {
  const raw = String(text || '')
  if (!raw.trim()) return []
  const paragraphs = preserveBreaks
    ? raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    : [raw.trim()]
  const lines: string[] = []
  for (const para of paragraphs) {
    if (!para) {
      if (preserveBreaks) lines.push('')
      continue
    }
    let line = ''
    for (const ch of para) {
      const next = line + ch
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line)
        line = ch
      } else {
        line = next
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

/** 居中多行文字，返回绘制后 y */
function drawCenterWrapped(
  ctx: any,
  text: string,
  centerX: number,
  startY: number,
  maxWidth: number,
  lineStep: number,
  font: string,
  color: string,
  preserveBreaks = false,
): number {
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  let y = startY
  for (const ln of wrapTextLines(ctx, text, maxWidth, preserveBreaks)) {
    if (ln) ctx.fillText(ln, centerX, y)
    y += lineStep
  }
  return y
}

function drawCornerQr(
  ctx: any,
  img: any | null,
  qx: number,
  qy: number,
  qrSize: number,
  hint: string,
  fs: (n: number) => number,
  embed = false,
  forPrint = false,
  text = '',
): number {
  const label = (hint || '').trim()
  const painted = forPrint && text ? drawSolidQr(ctx, text, qx, qy, qrSize) : false
  if (!painted && img) {
    drawQrImage(ctx, img, qx, qy, qrSize, forPrint)
  } else if (!painted && text) {
    drawSolidQr(ctx, text, qx, qy, qrSize)
  } else if (!painted) {
    ctx.strokeStyle = embed ? '#1e4d8c' : '#bdbdbd'
    ctx.strokeRect(qx, qy, qrSize, qrSize)
    if (embed && label) {
      ctx.fillStyle = '#1e4d8c'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const maxW = Math.max(8, qrSize - 8)
      let size = fs(12)
      ctx.font = `bold ${size}px ${receiptFontStack()}`
      while (size > fs(8) && ctx.measureText(label).width > maxW) {
        size -= 1
        ctx.font = `bold ${size}px ${receiptFontStack()}`
      }
      ctx.fillText(label, qx + qrSize / 2, qy + qrSize / 2)
      ctx.textBaseline = 'alphabetic'
      return qy + qrSize
    }
  }
  if (!label) return qy + qrSize
  ctx.font = `${fs(10)}px ${receiptFontStack()}`
  ctx.fillStyle = forPrint ? '#111111' : '#546e7a'
  ctx.textAlign = 'center'
  ctx.fillText(fitText(ctx, label, qrSize + 8), qx + qrSize / 2, qy + qrSize + fs(12))
  return qy + qrSize + fs(14)
}

function drawShopTitleBlock(
  ctx: any,
  shopTitle: string,
  isReturn: boolean,
  centerX: number,
  startY: number,
  maxW: number,
  lineStep: number,
  titleFont: string,
  fs: (n: number) => number,
  subtitle?: string,
): number {
  let y = startY
  const mark = ' 【退单】'
  const titleText = isReturn ? `${shopTitle}${mark}` : shopTitle
  if (!shopTitle && !isReturn) {
    y += 0
  } else if (isReturn) {
    ctx.font = titleFont
    const titleW = Math.min(ctx.measureText(shopTitle).width, maxW)
    const markW = ctx.measureText(mark).width
    const totalW = Math.min(titleW + markW, maxW)
    let x = centerX - totalW / 2
    ctx.textAlign = 'left'
    ctx.fillStyle = '#163a6b'
    ctx.fillText(fitText(ctx, shopTitle, Math.max(24, totalW - markW)), x, y)
    x += Math.min(titleW, Math.max(24, totalW - markW))
    ctx.fillStyle = '#e53935'
    ctx.fillText(mark, x, y)
    ctx.textAlign = 'center'
    y += lineStep
  } else {
    y = drawCenterWrapped(
      ctx,
      titleText,
      centerX,
      y,
      maxW,
      lineStep,
      titleFont,
      '#111',
      false,
    )
  }
  const sub = String(subtitle || '').trim()
  if (sub) {
    y += fs(4)
    y = drawCenterWrapped(
      ctx,
      sub,
      centerX,
      y,
      maxW,
      fs(14),
      `${fs(11)}px ${receiptFontStack()}`,
      '#37474f',
      true,
    )
  }
  return y
}

function isGarmentKind(kind: string): boolean {
  return kind === 'pickup' || kind === 'colorsize'
}

function drawGarment(
  ctx: any,
  model: ReceiptRenderModel,
  y: number,
  pad: number,
  W: number,
  fs: (n: number) => number,
  forPrint: boolean,
): number {
  const innerW = W - pad * 2
  const kind = model.layoutKind
  const ink = forPrint ? '#111111' : '#111111'
  const mute = forPrint ? '#333333' : '#455a64'
  ctx.textAlign = 'left'
  ctx.fillStyle = ink

  if (kind === 'pickup') {
    for (const group of model.styleGroups || []) {
      ctx.font = `bold ${fs(15)}px ${receiptFontStack()}`
      ctx.fillStyle = ink
      ctx.fillText(fitText(ctx, group.code, innerW), pad, y + fs(14))
      y += fs(22)
      for (const row of group.rows) {
        const spec = [row.color, row.size].filter(Boolean).join(' / ') || '—'
        ctx.font = `${fs(12)}px ${receiptFontStack()}`
        ctx.fillStyle = mute
        ctx.fillText(fitText(ctx, spec, innerW * 0.46), pad + fs(8), y + fs(12))
        ctx.textAlign = 'right'
        ctx.fillText(`${row.qtyPlain} × ${row.priceLabel}`, pad + innerW * 0.78, y + fs(12))
        ctx.fillStyle = ink
        ctx.font = `bold ${fs(12)}px ${receiptFontStack()}`
        ctx.fillText(row.subLabel, W - pad, y + fs(12))
        ctx.textAlign = 'left'
        y += fs(20)
      }
    }
    return y
  }

  if (kind === 'colorsize') {
    const flex = [1.2, 0.8, 0.7, 0.8]
    const labels = ['颜色', '尺码', '件数', '单价']
    const total = flex.reduce((s, n) => s + n, 0)
    for (const group of model.styleGroups || []) {
      ctx.font = `bold ${fs(15)}px ${receiptFontStack()}`
      ctx.fillStyle = ink
      ctx.fillText(fitText(ctx, group.code, innerW), pad, y + fs(14))
      y += fs(20)
      ctx.font = `bold ${fs(11)}px ${receiptFontStack()}`
      ctx.fillStyle = mute
      labels.forEach((label, i) => {
        const x = colX(flex.map((f) => ({ flex: f, label, field: 'code' as const })), pad, innerW, i)
        ctx.fillText(label, x, y + fs(11))
      })
      y += fs(16)
      for (const row of group.rows) {
        const cells = [row.color || '—', row.size || '—', row.qtyPlain, row.priceLabel]
        ctx.font = `${fs(12)}px ${receiptFontStack()}`
        ctx.fillStyle = ink
        cells.forEach((cell, i) => {
          const colW = (innerW * flex[i]) / total - 4
          const x = colX(flex.map((f) => ({ flex: f, label: '', field: 'code' as const })), pad, innerW, i)
          ctx.fillText(fitText(ctx, cell, colW), x, y + fs(12))
        })
        y += fs(18)
      }
      ctx.textAlign = 'right'
      ctx.fillStyle = mute
      ctx.font = `${fs(11)}px ${receiptFontStack()}`
      ctx.fillText(`小计 ${group.qtyLabel}件 ¥${group.amountLabel}`, W - pad, y + fs(11))
      ctx.textAlign = 'left'
      y += fs(20)
    }
    return y
  }

  if (kind === 'piece') {
    for (const row of model.items || []) {
      ctx.font = `bold ${fs(20)}px ${receiptFontStack()}`
      ctx.fillStyle = ink
      ctx.fillText(row.qtyPlain, pad, y + fs(18))
      ctx.font = `bold ${fs(13)}px ${receiptFontStack()}`
      ctx.fillText(fitText(ctx, row.styleCode, innerW * 0.5), pad + fs(36), y + fs(12))
      ctx.font = `${fs(11)}px ${receiptFontStack()}`
      ctx.fillStyle = mute
      ctx.fillText(fitText(ctx, `${row.color} ${row.size}`.trim(), innerW * 0.45), pad + fs(36), y + fs(26))
      ctx.textAlign = 'right'
      ctx.fillStyle = ink
      ctx.font = `bold ${fs(13)}px ${receiptFontStack()}`
      ctx.fillText(row.subLabel, W - pad, y + fs(18))
      ctx.textAlign = 'left'
      y += fs(34)
    }
    return y
  }

  if (kind === 'settle') {
    const heads = ['款号', '件数', '金额']
    ctx.font = `bold ${fs(12)}px ${receiptFontStack()}`
    ctx.fillStyle = mute
    ctx.fillText(heads[0], pad, y + fs(12))
    ctx.textAlign = 'center'
    ctx.fillText(heads[1], pad + innerW * 0.62, y + fs(12))
    ctx.textAlign = 'right'
    ctx.fillText(heads[2], W - pad, y + fs(12))
    ctx.textAlign = 'left'
    y += fs(18)
    for (const group of model.styleGroups || []) {
      ctx.font = `${fs(13)}px ${receiptFontStack()}`
      ctx.fillStyle = ink
      ctx.fillText(fitText(ctx, group.code, innerW * 0.5), pad, y + fs(13))
      ctx.textAlign = 'center'
      ctx.fillText(group.qtyLabel, pad + innerW * 0.62, y + fs(13))
      ctx.textAlign = 'right'
      ctx.fillText(group.amountLabel, W - pad, y + fs(13))
      ctx.textAlign = 'left'
      y += fs(20)
    }
    return y
  }

  const heads = ['款号', '颜色', '尺码', '件数', '单价', '金额']
  const flex = [1, 1, 1.4, 0.6, 0.7, 0.8]
  const cols = flex.map((f, i) => ({ flex: f, label: heads[i], field: 'code' as const }))
  ctx.font = `bold ${fs(10)}px ${receiptFontStack()}`
  ctx.fillStyle = mute
  heads.forEach((label, i) => {
    ctx.fillText(label, colX(cols, pad, innerW, i), y + fs(10))
  })
  y += fs(16)
  for (const row of model.items || []) {
    const cells = [row.styleCode, row.color || '—', row.size || '—', row.qtyPlain, row.priceLabel, row.subLabel]
    ctx.font = `${fs(11)}px ${receiptFontStack()}`
    ctx.fillStyle = ink
    cells.forEach((cell, i) => {
      const colW = (innerW * flex[i]) / (flex.reduce((s, n) => s + n, 0) || 1) - 2
      ctx.fillText(fitText(ctx, cell, colW), colX(cols, pad, innerW, i), y + fs(11))
    })
    y += fs(18)
  }
  return y
}

function drawTable(
  ctx: any,
  model: ReceiptRenderModel,
  y: number,
  pad: number,
  W: number,
  fs: (n: number) => number,
  forPrint: boolean,
): number {
  const cols = model.columns
  if (!cols.length) return y
  const innerW = W - pad * 2
  const headH = fs(22)
  const rowH = fs(model.layoutKind === 'compact' || model.layoutKind === 'minimal' ? 22 : 26)
  const specLineH = fs(12)
  const specUnder = model.specUnderField || ''
  const bordered = !model.plainTable
  const cellFs = fs(12)
  const headFs = fs(12)
  const specFs = fs(11)
  const lineSlot = model.showLineNumber && cols.some((c) => c.field === 'code') ? fs(28) : 0
  const paint = (text: string, field: string, i: number, baseline: number, header: boolean) => {
    const total = cols.reduce((s, c) => s + c.flex, 0) || 1
    const flexW = Math.max(1, innerW - lineSlot)
    const colW = Math.max(8, (flexW * cols[i].flex) / total - 4)
    const x = colX(cols, pad, innerW, i, lineSlot)
    if (field === 'unit' || (header && field === 'qtyLabel')) {
      ctx.textAlign = 'center'
      ctx.fillText(fitText(ctx, text, colW), x + colW / 2, baseline)
      ctx.textAlign = 'left'
      return
    }
    if (!header && field === 'qtyLabel') {
      drawQtyLead(ctx, text, x, colW, baseline)
      return
    }
    ctx.textAlign = 'left'
    ctx.fillText(fitText(ctx, text, colW), x, baseline)
  }

  if (bordered) {
    ctx.strokeStyle = forPrint ? '#333333' : '#d0d7de'
    ctx.strokeRect(pad, y, innerW, headH)
    ctx.fillStyle = forPrint ? '#eeeeee' : '#e8eef4'
    ctx.fillRect(pad, y, innerW, headH)
  } else {
    ctx.strokeStyle = forPrint ? '#222222' : '#9e9e9e'
    ctx.setLineDash(forPrint ? [6, 4] : [4, 3])
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(W - pad, y)
    ctx.stroke()
    ctx.setLineDash([])
    y += 6
  }

  ctx.fillStyle = '#333'
  ctx.font = `bold ${headFs}px ${receiptFontStack()}`
  ctx.textAlign = 'left'
  cols.forEach((col, i) => {
    paint(col.label, col.field, i, y + headFs + 2, true)
  })
  y += bordered ? headH : fs(18)

  for (const row of model.items || []) {
    const showSpec = !!(specUnder && row.hasSpec && row.spec)
    const thisH = rowH + (showSpec ? specLineH : 0)
    if (bordered) {
      ctx.strokeStyle = forPrint ? '#444444' : '#e5e7eb'
      ctx.strokeRect(pad, y, innerW, thisH)
    }
    ctx.fillStyle = '#111'
    ctx.font = `${cellFs}px ${receiptFontStack()}`
    ctx.textAlign = 'left'
    cols.forEach((col, i) => {
      if (lineSlot && col.field === 'code' && row.lineNo) {
        const x = colX(cols, pad, innerW, i, lineSlot)
        ctx.textAlign = 'right'
        ctx.fillStyle = forPrint ? '#333333' : '#607d8b'
        ctx.fillText(String(row.lineNo), x - 3, y + cellFs + 4)
        ctx.textAlign = 'left'
        ctx.fillStyle = '#111'
      }
      const val = String((row as any)[col.field] || '')
      paint(val, col.field, i, y + cellFs + 4, false)
    })
    if (showSpec) {
      const idx = cols.findIndex((c) => c.field === specUnder)
      if (idx >= 0) {
        const total = cols.reduce((s, c) => s + c.flex, 0) || 1
        const flexW = Math.max(1, innerW - lineSlot)
        const colW = Math.max(8, (flexW * cols[idx].flex) / total - 4)
        ctx.fillStyle = forPrint ? '#444444' : '#5b7390'
        ctx.font = `${specFs}px ${receiptFontStack()}`
        ctx.textAlign = 'left'
        ctx.fillText(
          fitText(ctx, row.spec, colW),
          colX(cols, pad, innerW, idx, lineSlot),
          y + cellFs + specLineH + 2,
        )
      }
    }
    y += thisH
  }

  if (!bordered) {
    ctx.strokeStyle = forPrint ? '#222222' : '#9e9e9e'
    ctx.setLineDash(forPrint ? [6, 4] : [4, 3])
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(W - pad, y)
    ctx.stroke()
    ctx.setLineDash([])
    y += 8
  }
  return y
}

function slotKind(
  value: unknown,
  fallback: '' | 'lookup' | 'arrival' | 'friend',
): '' | 'lookup' | 'arrival' | 'friend' {
  if (value === 'lookup' || value === 'arrival' || value === 'friend' || value === '') return value
  return fallback
}

function arrivalPayload(model: ReceiptRenderModel): string {
  return String(model.headerNewArrivalUrl || model.returnQrUrl || '').trim()
}

function canvasScaleOf(ctx: any): { scale: number; ox: number; oy: number } | null {
  try {
    const tr = ctx.getTransform()
    return { scale: Number(tr.a) || 1, ox: Number(tr.e) || 0, oy: Number(tr.f) || 0 }
  } catch (_) {
    return null
  }
}

/** 按模块数留出能扫的抬头码。每块至少 3 个打印点，纸宽够时用 4 个点。 */
function headerQrCssForPrint(texts: string[], cssW: number, paperDots: number): number {
  const floorCss = receiptHeaderQrCssSize(cssW, paperDots)
  let modules = 0
  for (const text of texts) {
    const n = qrModuleGrid(text).length
    if (n > modules) modules = n
  }
  if (!modules) return floorCss
  const scale = paperDots / Math.max(1, cssW)
  const titleMinDots = paperDots >= 700 ? 420 : paperDots >= 500 ? 280 : 130
  const chrome = (2 * 2 + 4 * 2) * scale
  const budget = Math.floor((paperDots - chrome - titleMinDots) / 2)
  const span4 = modules + 8
  const span2 = modules + 4
  let dots = span4 * 4
  if (budget < span4 * 3 && budget >= span2 * 3) dots = Math.min(budget, span2 * 4)
  else dots = Math.min(Math.max(budget, span2 * 3), dots)
  dots = Math.max(Math.round(floorCss * scale), Math.min(budget, dots))
  return Math.max(floorCss, Math.round(dots / scale))
}

/** 热敏纸不吃浅灰。按打印点取整铺黑块，避免半个点被放大成模糊边。 */
function drawSolidQr(ctx: any, text: string, x: number, y: number, size: number): boolean {
  const grid = qrModuleGrid(text)
  const n = grid.length
  if (!n || size <= 0) return false
  const tr = canvasScaleOf(ctx)
  const scale = tr ? tr.scale : 1
  const ox = tr ? tr.ox : 0
  const oy = tr ? tr.oy : 0
  const px0 = Math.round(ox + x * scale)
  const py0 = Math.round(oy + y * scale)
  const side = Math.max(n + 4, Math.round(size * scale))
  let quiet = 4
  let span = n + quiet * 2
  let cell = Math.floor(side / span)
  if (cell < 3) {
    quiet = 2
    span = n + quiet * 2
    cell = Math.floor(side / span)
  }
  if (cell < 1) cell = 1
  const drawn = span * cell
  const dx = px0 + Math.floor((side - drawn) / 2)
  const dy = py0 + Math.floor((side - drawn) / 2)
  if (tr) ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(px0, py0, side, side)
  ctx.fillStyle = '#000000'
  for (let row = 0; row < n; row++) {
    const line = grid[row]
    for (let col = 0; col < n; col++) {
      if (!line[col]) continue
      ctx.fillRect(dx + (col + quiet) * cell, dy + (row + quiet) * cell, cell, cell)
    }
  }
  if (tr) ctx.setTransform(scale, 0, 0, scale, ox, oy)
  return true
}

function drawQrImage(ctx: any, img: any, x: number, y: number, size: number, forPrint: boolean) {
  if (!img) return
  if (forPrint) {
    const prev = ctx.imageSmoothingEnabled
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, x, y, size, size)
    ctx.imageSmoothingEnabled = prev
    stampLogoForPrint(ctx, x, y, size)
    return
  }
  ctx.drawImage(img, x, y, size, size)
}

function footerQrCols(
  model: ReceiptRenderModel,
  images: { arrivalImg: any; lookupImg: any; friendImg: any },
): Array<{ img: any; hint: string; text: string }> {
  const hideUnset = !!model.guestBindPrompt
  const kinds = model.isReturn
    ? [
        slotKind(model.slotLeft, model.showLookupQr ? 'lookup' : ''),
        slotKind(model.slotRight, ''),
        slotKind(model.slotFoot, model.showReturnQr ? 'arrival' : ''),
      ]
    : [slotKind(model.slotFoot, '')]
  const cols: Array<{ img: any; hint: string; text: string }> = []
  for (const kind of kinds) {
    if (hideUnset && (kind === 'lookup' || kind === 'arrival')) continue
    if (kind === 'lookup') cols.push({ img: images.lookupImg, hint: model.lookupQrHint || '扫码查账', text: '' })
    else if (kind === 'friend') cols.push({ img: images.friendImg, hint: '添加微信', text: '' })
    else if (kind === 'arrival') {
      cols.push({
        img: images.arrivalImg,
        hint: model.headerNewArrivalHint || model.returnQrHint || '查看新款',
        text: arrivalPayload(model),
      })
    }
  }
  return cols
}

function drawFooterQrCols(
  ctx: any,
  cols: Array<{ img: any; hint: string; text: string }>,
  y: number,
  W: number,
  fs: (n: number) => number,
  labFont: string,
  forPrint: boolean,
): number {
  if (!cols.length) return y
  const qrSize = RECEIPT_QR_CANVAS_SIZE
  const gap = 16
  const totalW = cols.length * qrSize + Math.max(0, cols.length - 1) * gap
  let qx = (W - totalW) / 2
  let bottom = y
  for (const col of cols) {
    const painted = forPrint && col.text ? drawSolidQr(ctx, col.text, qx, y, qrSize) : false
    if (!painted && col.img) {
      drawQrImage(ctx, col.img, qx, y, qrSize, forPrint)
    } else if (!painted && col.text) {
      drawSolidQr(ctx, col.text, qx, y, qrSize)
    } else if (!painted) {
      ctx.strokeStyle = '#222222'
      ctx.strokeRect(qx, y, qrSize, qrSize)
    }
    ctx.font = labFont
    ctx.fillStyle = '#111111'
    ctx.textAlign = 'center'
    ctx.fillText(fitText(ctx, col.hint, qrSize + 12), qx + qrSize / 2, y + qrSize + fs(16))
    bottom = y + qrSize + fs(16) + fs(12)
    qx += qrSize + gap
  }
  return bottom + 8
}

function drawQrFooter(
  ctx: any,
  model: ReceiptRenderModel,
  y: number,
  W: number,
  pad: number,
  fs: (n: number) => number,
  images: { wxImg: any; aliImg: any; arrivalImg: any; lookupImg: any; friendImg: any },
  forPrint = false,
): number {
  const innerW = W - pad * 2
  const hintFont = `${fs(13)}px ${receiptFontStack()}`
  const labFont = `${fs(12)}px ${receiptFontStack()}`
  const footFont = `${fs(12)}px ${receiptFontStack()}`

  const footCols = footerQrCols(model, {
    arrivalImg: images.arrivalImg,
    lookupImg: images.lookupImg,
    friendImg: images.friendImg,
  })
  const drewReturnQrs = !!model.isReturn && footCols.length > 0
  if (footCols.length) y = drawFooterQrCols(ctx, footCols, y, W, fs, labFont, forPrint)
  if (!drewReturnQrs && model.showPayQr && (model.wechatQr || model.alipayQr)) {
    const tiles: Array<{ img: any; label: string }> = []
    if (model.wechatQr) tiles.push({ img: images.wxImg, label: '微信支付' })
    if (model.alipayQr) tiles.push({ img: images.aliImg, label: '支付宝支付' })
    if (model.qrHint) {
      y = drawCenterWrapped(
        ctx,
        model.qrHint,
        W / 2,
        y + fs(12),
        innerW,
        fs(20),
        hintFont,
        '#1a2b3c',
      )
      y += fs(8)
    }
    const qrSize = RECEIPT_QR_CANVAS_SIZE
    const gap = 28
    const totalW = tiles.length * qrSize + Math.max(0, tiles.length - 1) * gap
    let x = (W - totalW) / 2
    for (const tile of tiles) {
      if (tile.img) drawQrImage(ctx, tile.img, x, y, qrSize, forPrint)
      else {
        ctx.strokeStyle = '#bdbdbd'
        ctx.strokeRect(x, y, qrSize, qrSize)
      }
      ctx.fillStyle = '#37474f'
      ctx.font = labFont
      ctx.textAlign = 'center'
      ctx.fillText(tile.label, x + qrSize / 2, y + qrSize + fs(16))
      x += qrSize + gap
    }
    y += qrSize + fs(16) + fs(20)
  }

  if (model.footerLines?.length) {
    let started = false
    for (const line of model.footerLines) {
      const t = String(line || '').trim()
      if (!t) continue
      y = drawCenterWrapped(
        ctx,
        t,
        W / 2,
        started ? y : y + fs(12),
        innerW,
        fs(16),
        footFont,
        '#37474f',
        false,
      )
      started = true
    }
    if (started) y += fs(10)
  } else if (model.footer) {
    y = drawCenterWrapped(
      ctx,
      model.footer,
      W / 2,
      y + fs(12),
      innerW,
      fs(16),
      footFont,
      '#37474f',
      true,
    )
    y += fs(10)
  }
  return y
}

/** 热敏纸只吃深色。浅色 Logo 先压成黑白，否则出纸是空白。 */
function stampLogoForPrint(ctx: any, x: number, y: number, size: number) {
  let scale = 1
  let ox = 0
  let oy = 0
  try {
    const tr = ctx.getTransform()
    scale = Number(tr.a) || 1
    ox = Number(tr.e) || 0
    oy = Number(tr.f) || 0
  } catch (_) {
    return
  }
  const px = Math.max(0, Math.round(ox + x * scale))
  const py = Math.max(0, Math.round(oy + y * scale))
  const pw = Math.max(1, Math.round(size * scale))
  const ph = Math.max(1, Math.round(size * scale))
  let image: any
  try {
    image = ctx.getImageData(px, py, pw, ph)
  } catch (_) {
    return
  }
  const d = image.data as Uint8ClampedArray
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]
    const lum =
      a < 24
        ? 255
        : (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * (a / 255) + 255 * (1 - a / 255)
    const v = lum < 200 ? 0 : 255
    d[i] = v
    d[i + 1] = v
    d[i + 2] = v
    d[i + 3] = 255
  }
  try {
    ctx.putImageData(image, px, py)
  } catch (_) {}
}

function drawItemBarcodes(
  ctx: any,
  model: ReceiptRenderModel,
  y: number,
  W: number,
  pad: number,
  fs: (n: number) => number,
): number {
  if (model.showBarcode === false) return y
  const maxW = W - pad * 2
  let drew = false
  for (const item of model.items || []) {
    const text = String(item.barcodeText || '').trim()
    const cap = Math.min(maxW, fs(132))
    const x0 = (W - cap) / 2
    if (!drawSolidQr(ctx, text, x0, y, cap)) continue
    y += cap + fs(4)
    const spec = item.hasSpec ? String(item.spec || '').trim() : ''
    ctx.font = `${fs(11)}px ${receiptFontStack()}`
    ctx.fillStyle = '#111111'
    ctx.textAlign = 'center'
    ctx.fillText(fitText(ctx, spec ? `${text} ${spec}` : text, maxW), W / 2, y + fs(11))
    y += fs(18)
    drew = true
  }
  return drew ? y + fs(4) : y
}

function drawMetaLines(
  line: (label: string, value: string) => void,
  model: ReceiptRenderModel,
  customerLabel = '客户',
) {
  if ((model.arrearsOn || model.showArrears) && model.customerArrearsLabel) {
    line('欠款', `¥${model.customerArrearsLabel}`)
  }
  if (model.showCustomer !== false) line(customerLabel, model.customerName)
  if (model.showPhone !== false) line('电话', model.customerPhone)
  if (model.showDate !== false) line('日期', model.dateStr)
  if (model.showPrintedAt !== false && model.printTimeLabel) line('打印时间', model.printTimeLabel)
}

export async function drawReceiptCanvas(
  ctx: any,
  canvas: any,
  model: ReceiptRenderModel,
  W: number,
  H: number,
  opts?: CanvasDrawOpts,
): Promise<number> {
  const forPrint = !!opts?.forPrint
  const skipImages = !!opts?.skipImages && !forPrint
  const pad = 16
  const fs = (px: number) => Math.round(px * printFontCanvasScale())

  const loadImg = (src: string): Promise<any | null> =>
    new Promise((resolve) => {
      if (!src) {
        resolve(null)
        return
      }
      const img = canvas.createImage()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = src
    })

  const loadLogo = (src: string): Promise<any | null> => {
    const dataUrl = src && src.indexOf('tuk_shop_logo_') >= 0 ? shopLogoDataUrl(src) : ''
    return loadImg(dataUrl || src)
  }

  const hideUnset = !!model.guestBindPrompt
  const printSlot = (kind: '' | 'lookup' | 'arrival' | 'friend') =>
    hideUnset && (kind === 'lookup' || kind === 'arrival') ? '' : kind
  const leftKind = printSlot(
    !model.isReturn ? slotKind(model.slotLeft, model.showLookupQr ? 'lookup' : '') : '',
  )
  const rightKind = printSlot(
    !model.isReturn ? slotKind(model.slotRight, model.showHeaderNewArrivalQr ? 'arrival' : '') : '',
  )
  const footKinds = (
    model.isReturn
      ? [
          slotKind(model.slotLeft, model.showLookupQr ? 'lookup' : ''),
          slotKind(model.slotRight, ''),
          slotKind(model.slotFoot, model.showReturnQr ? 'arrival' : ''),
        ]
      : [slotKind(model.slotFoot, '')]
  ).map(printSlot)
  const needLookup = leftKind === 'lookup' || rightKind === 'lookup' || footKinds.indexOf('lookup') >= 0
  const needArrival = leftKind === 'arrival' || rightKind === 'arrival' || footKinds.indexOf('arrival') >= 0
  const needFriend = leftKind === 'friend' || rightKind === 'friend' || footKinds.indexOf('friend') >= 0
  const arrivalSrc = needArrival ? model.headerNewArrivalQr || model.returnQr || '' : ''
  const [wxImg, aliImg, arrivalImg, lookupImg, friendImg, logoImg] = skipImages
    ? [null, null, null, null, null, null]
    : await Promise.all([
        loadImg(model.wechatQr || ''),
        loadImg(model.alipayQr || ''),
        loadImg(arrivalSrc),
        loadImg(needLookup ? model.lookupQr || '' : ''),
        loadImg(needFriend ? model.friendQr || '' : ''),
        loadLogo(model.shopLogo || ''),
      ])

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  const innerW = W - pad * 2
  let y = 12
  if (logoImg) {
    const logoSize = Math.min(fs(72), Math.round(W * 0.22))
    const logoX = (W - logoSize) / 2
    ctx.drawImage(logoImg, logoX, y, logoSize, logoSize)
    if (forPrint) stampLogoForPrint(ctx, logoX, y, logoSize)
    y += logoSize + fs(8) + fs(22)
  }
  const title =
    model.layoutKind === 'payment'
      ? model.paymentTitle
      : model.showShopTitle === false
        ? ''
        : model.shopName || '图可开单'
  const titleFont = `bold ${fs(18)}px ${receiptFontStack()}`

  let titleCenterX = model.rightAlignHeader ? W - pad : W / 2
  let titleMaxW = innerW

  // 票头：左、右两个位置各自可以是查账码或新款码
  const leftOn = !!leftKind
  const rightOn = !!rightKind
  const cornerOf = (kind: '' | 'lookup' | 'arrival' | 'friend') => {
    if (kind === 'lookup') {
      return {
        img: lookupImg,
        hint: model.guestBindPrompt ? '登录设置' : model.lookupQrHint || '扫码查账',
        text: String(model.lookupQrUrl || '').trim(),
      }
    }
    if (kind === 'friend') return { img: friendImg, hint: '添加微信', text: '' }
    return {
      img: arrivalImg,
      hint: model.guestBindPrompt
        ? '登录设置'
        : model.headerNewArrivalHint || model.returnQrHint || '查看新款',
      text: arrivalPayload(model),
    }
  }
  const paperDots = dotsPerLine(getPaperWidthMm())
  const headerTexts: string[] = []
  if (leftOn) headerTexts.push(cornerOf(leftKind).text)
  if (rightOn) headerTexts.push(cornerOf(rightKind).text)
  const qrSize =
    forPrint && (leftOn || rightOn)
      ? headerQrCssForPrint(headerTexts, W, paperDots)
      : receiptHeaderQrCssSize(W, paperDots)
  const contactLines = [model.shopAddress, model.shopPhoneLine].filter((line) => String(line || '').trim())
  const shownContact = contactLines
  if (leftOn || rightOn) {
    const qy = y
    let qrBottom = qy
    const edge = 2
    if (leftOn) {
      const corner = cornerOf(leftKind)
      qrBottom = Math.max(
        qrBottom,
        drawCornerQr(ctx, corner.img, edge, qy, qrSize, corner.hint, fs, !!model.guestBindPrompt, forPrint, corner.text),
      )
    }
    if (rightOn) {
      const corner = cornerOf(rightKind)
      qrBottom = Math.max(
        qrBottom,
        drawCornerQr(
          ctx,
          corner.img,
          W - edge - qrSize,
          qy,
          qrSize,
          corner.hint,
          fs,
          !!model.guestBindPrompt,
          forPrint,
          corner.text,
        ),
      )
    }
    const gap = 4
    titleMaxW = Math.max(40, W - edge * 2 - (qrSize + gap) * 2)
    titleCenterX = W / 2
    const sub = String(model.shopSubtitle || '').trim()
    const titleText = title && model.isReturn ? `${title} 【退单】` : title
    ctx.font = titleFont
    const titleN = title ? Math.max(1, wrapTextLines(ctx, titleText, titleMaxW, false).length) : 0
    let blockH = titleN * fs(22)
    if (sub) {
      ctx.font = `${fs(11)}px ${receiptFontStack()}`
      blockH += fs(4) + Math.max(1, wrapTextLines(ctx, sub, titleMaxW, true).length) * fs(14)
    }
    if (shownContact.length) {
      blockH += fs(6)
      ctx.font = `${fs(12)}px ${receiptFontStack()}`
      for (const line of shownContact) {
        blockH += Math.max(1, wrapTextLines(ctx, line, titleMaxW, false).length) * fs(15)
      }
    }
    const top = qy + Math.max(0, (qrSize - blockH) / 2)
    ctx.textBaseline = 'top'
    let textBottom = top
    if (title || sub) {
      textBottom = drawShopTitleBlock(
        ctx,
        title,
        !!model.isReturn,
        titleCenterX,
        top,
        titleMaxW,
        fs(22),
        titleFont,
        fs,
        model.shopSubtitle,
      )
    }
    if (shownContact.length) {
      let cy = textBottom + (title || sub ? fs(6) : 0)
      for (const line of shownContact) {
        cy = drawCenterWrapped(
          ctx,
          line,
          titleCenterX,
          cy,
          titleMaxW,
          fs(15),
          `${fs(12)}px ${receiptFontStack()}`,
          '#333333',
          false,
        )
      }
      textBottom = cy
    }
    ctx.textBaseline = 'alphabetic'
    y = Math.max(qrBottom, textBottom) + fs(4)
  } else {
    y = drawShopTitleBlock(
      ctx,
      title,
      !!model.isReturn,
      titleCenterX,
      y + fs(16),
      titleMaxW,
      fs(22),
      titleFont,
      fs,
      model.shopSubtitle,
    )
    y += fs(6)
  }

  if (!(leftOn || rightOn) && shownContact.length) {
    y += fs(4)
    const right = !!model.rightAlignHeader
    ctx.font = `${fs(13)}px ${receiptFontStack()}`
    ctx.fillStyle = '#333'
    ctx.textAlign = right ? 'right' : 'center'
    const ax = right ? W - pad : W / 2
    for (const line of contactLines) {
      for (const ln of wrapTextLines(ctx, line, W - pad * 2, false)) {
        if (ln) ctx.fillText(ln, ax, y)
        y += fs(16)
      }
    }
    y += fs(4)
  }

  ctx.strokeStyle = forPrint ? '#333333' : '#d0d7de'
  ctx.lineWidth = forPrint ? 1.2 : 1
  ctx.beginPath()
  ctx.moveTo(pad, y)
  ctx.lineTo(W - pad, y)
  ctx.stroke()
  y += 12

  const line = (label: string, value: string) => {
    if (!value) return
    ctx.textAlign = model.rightAlignHeader ? 'right' : 'left'
    ctx.font = `${fs(13)}px ${receiptFontStack()}`
    ctx.fillStyle = '#666'
    const lx = model.rightAlignHeader ? W - pad - 120 : pad
    ctx.fillText(label, lx, y + fs(11))
    ctx.fillStyle = '#111'
    const valX = lx + 44
    const valMax = model.rightAlignHeader ? 116 : W - pad - valX
    ctx.fillText(fitText(ctx, value, valMax), valX, y + fs(11))
    y += fs(20)
  }

  if (model.layoutKind === 'payment') {
    drawMetaLines(line, model)
    y += 8
    ctx.strokeStyle = forPrint ? '#444444' : '#cfd8dc'
    ctx.strokeRect(pad, y, innerW, fs(100))
    let boxY = y + fs(18)
    boxY = drawCenterWrapped(
      ctx,
      `今收到 ${model.customerName || '客户'} 货款`,
      W / 2,
      boxY,
      innerW - 16,
      fs(18),
      `${fs(15)}px ${receiptFontStack()}`,
      '#111',
    )
    boxY = drawCenterWrapped(
      ctx,
      model.amountCn,
      W / 2,
      boxY + fs(6),
      innerW - 16,
      fs(20),
      `bold ${fs(16)}px ${receiptFontStack()}`,
      '#111',
    )
    boxY = drawCenterWrapped(
      ctx,
      `¥${model.amountLabel}`,
      W / 2,
      boxY + fs(4),
      innerW - 16,
      fs(22),
      `bold ${fs(18)}px ${receiptFontStack()}`,
      '#e53935',
    )
    y = Math.max(y + fs(100), boxY) + 16
  } else if (model.layoutKind === 'delivery') {
    if (model.isReturn) line('单号', model.orderNo)
    drawMetaLines(line, model, '收货人')
    if (model.isReturn) line('经办', model.handler)
    y += 6
    ctx.strokeStyle = forPrint ? '#222222' : '#9e9e9e'
    ctx.setLineDash(forPrint ? [6, 4] : [4, 3])
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(W - pad, y)
    ctx.stroke()
    ctx.setLineDash([])
    y += 14
    y = drawTable(ctx, model, y, pad, W, fs, forPrint)
    y += fs(12)
    ctx.font = `bold ${fs(14)}px ${receiptFontStack()}`
    ctx.fillStyle = '#111'
    ctx.textAlign = 'left'
    ctx.fillText(`数量: ${model.qtyLabel}`, pad, y + fs(14))
    ctx.textAlign = 'right'
    ctx.fillStyle = '#ff5252'
    ctx.font = `bold ${fs(16)}px ${receiptFontStack()}`
    ctx.fillText(`合计: ¥${model.amountLabel}`, W - pad, y + fs(14))
    y += fs(26)
    ctx.fillStyle = '#37474f'
    ctx.font = `${fs(12)}px ${receiptFontStack()}`
    ctx.fillText('签收人：____________', pad, y + fs(11))
    y += fs(20)
    ctx.fillText('签收时间：____________', pad, y + fs(11))
    y += fs(24)
  } else {
    if (model.isReturn) line('单号', model.orderNo)
    drawMetaLines(line, model)
    if (model.isReturn) line('经办', model.handler)
    y += 4
    if (isGarmentKind(model.layoutKind)) y = drawGarment(ctx, model, y, pad, W, fs, forPrint)
    else y = drawTable(ctx, model, y, pad, W, fs, forPrint)

    y += fs(12)
    ctx.font = `bold ${fs(14)}px ${receiptFontStack()}`
    ctx.fillStyle = '#111'
    ctx.textAlign = 'left'
    const qtyWord =
      isGarmentKind(model.layoutKind) ||
      model.layoutKind === 'piece' ||
      model.layoutKind === 'settle' ||
      model.layoutKind === 'across'
        ? '件数'
        : '数量'
    ctx.fillText(`${qtyWord}: ${model.qtyLabel}`, pad, y + fs(14))
    ctx.textAlign = 'right'
    ctx.fillStyle = '#ff5252'
    ctx.font = `bold ${fs(16)}px ${receiptFontStack()}`
    ctx.fillText(`合计: ¥${model.amountLabel}`, W - pad, y + fs(14))
    y += fs(26)

  }

  y = drawItemBarcodes(ctx, model, y, W, pad, fs)

  ctx.strokeStyle = forPrint ? '#222222' : '#9e9e9e'
  ctx.setLineDash(forPrint ? [6, 4] : [4, 3])
  ctx.beginPath()
  ctx.moveTo(pad, y)
  ctx.lineTo(W - pad, y)
  ctx.stroke()
  ctx.setLineDash([])
  y += 18

  if (!skipImages) {
    y = drawQrFooter(ctx, model, y, W, pad, fs, { wxImg, aliImg, arrivalImg, lookupImg, friendImg }, forPrint)
  }

  // 票尾多留白，避免撕纸挡住最后一行。不要用 min(H)：超出时把真实高度交回，由渲染层加高重画
  return Math.max(160, y + 40)
}

function estimateWrappedExtraH(
  text: string | undefined,
  charsPerLine = 20,
  lineH = 18,
  singleLineH = 32,
): number {
  const raw = String(text || '')
  if (!raw.trim()) return 0
  const paras = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  let lines = 0
  for (const p of paras) {
    if (!p) {
      lines += 1
      continue
    }
    lines += Math.max(1, Math.ceil(p.length / charsPerLine))
  }
  const multiLineH = lines * lineH + 12
  return Math.max(0, multiLineH - singleLineH)
}

export function estimateQrBlockH(model: ReceiptRenderModel): number {
  let h = 0
  const headQr =
    !model.isReturn &&
    (model.showLookupQr ||
      model.showHeaderNewArrivalQr ||
      model.slotLeft === 'friend' ||
      model.slotRight === 'friend')
  if (headQr) {
    const paperDots = dotsPerLine(getPaperWidthMm())
    const headerCss = headerQrCssForPrint(
      [model.lookupQrUrl, model.headerNewArrivalUrl, model.returnQrUrl].filter((item) => !!item),
      360,
      paperDots,
    )
    h += Math.max(RECEIPT_QR_BLOCK_H_LOOKUP, headerCss + 36)
  }
  if (model.shopSubtitle) {
    h += Math.max(16, estimateWrappedExtraH(model.shopSubtitle, 12, 16, 0))
  }
  if (model.shopAddress) h += Math.max(18, estimateWrappedExtraH(model.shopAddress, 16, 16, 0))
  if (model.shopPhoneLine) h += Math.max(18, estimateWrappedExtraH(model.shopPhoneLine, 16, 16, 0))
  const footKind = slotKind(model.slotFoot, model.showReturnQr ? 'arrival' : '')
  if (model.isReturn && (model.showLookupQr || model.showReturnQr || footKind)) {
    h += RECEIPT_QR_BLOCK_H_PAY
  } else if (!model.isReturn && footKind) {
    h += RECEIPT_QR_BLOCK_H_PAY
  }
  if (!model.isReturn && model.showPayQr && (model.wechatQr || model.alipayQr)) {
    h += RECEIPT_QR_BLOCK_H_PAY
    if (model.qrHint) h += estimateWrappedExtraH(model.qrHint, 18, 20, 26)
  }
  if (model.showBarcode !== false) {
    const coded = (model.items || []).filter((item) => String(item.barcodeText || '').trim()).length
    h += coded * Math.round(150 * Math.max(1, printFontCanvasScale()))
  }
  if (model.footerLines?.length) {
    let started = false
    for (const line of model.footerLines) {
      const t = String(line || '').trim()
      if (!t) continue
      // 每行都要占位；原先只加「超出一行的增量」，多行注意事项会被估成 0
      h += Math.max(20, estimateWrappedExtraH(t, 18, 18, 0))
      started = true
    }
    if (started) h += 16
  } else if (model.footer) {
    h += Math.max(20, estimateWrappedExtraH(model.footer, 18, 18, 0))
    h += 16
  }
  return h
}
