import { printFontCanvasScale } from '../../services/print-settings'
import { RECEIPT_QR_CANVAS_SIZE } from '../../utils/return-receipt'
import type { StatementRenderModel } from './statement-layout'

export type StmtCanvasOpts = {
  forPrint?: boolean
  wxImg?: any
  aliImg?: any
}

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

/** 热敏位图下 setLineDash 易丢，打印用手动画虚线 */
function drawDashH(
  ctx: any,
  x1: number,
  x2: number,
  y: number,
  forPrint: boolean,
) {
  const color = forPrint ? '#333333' : '#bdbdbd'
  if (forPrint) {
    const dash = 10
    const gap = 7
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    let x = x1
    while (x < x2) {
      const xe = Math.min(x + dash, x2)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(xe, y)
      ctx.stroke()
      x += dash + gap
    }
    return
  }
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawSolidH(ctx: any, x1: number, x2: number, y: number, forPrint: boolean) {
  ctx.strokeStyle = forPrint ? '#444444' : '#eeeeee'
  ctx.lineWidth = forPrint ? 1.5 : 1
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
}

export function drawStatementCanvas(
  ctx: any,
  model: StatementRenderModel,
  W: number,
  _H: number,
  opts?: StmtCanvasOpts,
): number {
  const forPrint = !!opts?.forPrint
  const pad = 18
  const fs = (px: number) => Math.round(px * printFontCanvasScale())
  const innerW = W - pad * 2
  const cx = model.rightAlignHeader ? W - pad : W / 2
  const align = model.rightAlignHeader ? 'right' : 'center'

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, _H)

  let y = fs(20)

  ctx.font = `bold ${fs(22)}px sans-serif`
  ctx.fillStyle = '#222222'
  ctx.textAlign = align as CanvasTextAlign
  ctx.fillText(model.shopName, cx, y + fs(20))
  y += fs(36)

  ctx.font = `bold ${fs(17)}px sans-serif`
  ctx.fillStyle = model.unpaidOnly ? '#e53935' : '#1e4d8c'
  ctx.fillText(model.subtitle, cx, y + fs(14))
  y += fs(30)

  const infos: Array<[string, string]> = [
    ['客户', model.customerName],
    ...(model.customerPhone ? [['电话', model.customerPhone] as const] : []),
    ['时段', model.rangeLabel],
    ...(model.printTime ? [['打印时间', model.printTime] as const] : []),
  ]
  for (const [label, value] of infos) {
    if (!value) continue
    ctx.textAlign = model.rightAlignHeader ? 'right' : 'left'
    ctx.font = `${fs(15)}px sans-serif`
    ctx.fillStyle = '#888888'
    const lx = model.rightAlignHeader ? W - pad - fs(120) : pad
    ctx.fillText(label, lx, y + fs(12))
    ctx.fillStyle = '#333333'
    ctx.fillText(value, lx + fs(56), y + fs(12))
    y += fs(24)
  }
  y += fs(6)

  drawDashH(ctx, pad, W - pad, y, forPrint)
  y += fs(18)

  ctx.font = `bold ${fs(16)}px sans-serif`
  ctx.fillStyle = '#333333'
  ctx.textAlign = 'left'
  ctx.fillText(`账单明细（${model.totals.orderCount} 单）`, pad, y + fs(12))
  y += fs(28)

  for (const o of model.orders) {
    ctx.font = `${fs(15)}px sans-serif`
    ctx.fillStyle = '#333333'
    ctx.textAlign = 'left'
    ctx.fillText(o.createdAt || '', pad, y + fs(12))
    ctx.font = `bold ${fs(16)}px sans-serif`
    ctx.fillStyle = o.statusClass === 'unpaid' ? '#e53935' : '#333333'
    ctx.textAlign = 'right'
    ctx.fillText(`¥${o.amountLabel}`, W - pad, y + fs(12))
    y += fs(22)

    ctx.font = `${fs(13)}px sans-serif`
    ctx.fillStyle = '#999999'
    ctx.textAlign = 'left'
    ctx.fillText(o.orderNoLabel || o.orderNo || '', pad, y + fs(10))
    ctx.textAlign = 'right'
    ctx.fillText(`${o.qtyLabel} [${o.statusLabel}]`, W - pad, y + fs(10))
    y += fs(26)
  }

  drawSolidH(ctx, pad, W - pad, y, forPrint)
  y += fs(22)

  const sumRow = (label: string, value: string, color = '#333333') => {
    ctx.font = `${fs(15)}px sans-serif`
    ctx.fillStyle = '#888888'
    ctx.textAlign = 'left'
    ctx.fillText(label, pad, y + fs(12))
    ctx.font = `bold ${fs(16)}px sans-serif`
    ctx.fillStyle = color
    ctx.textAlign = 'right'
    ctx.fillText(value, W - pad, y + fs(12))
    y += fs(26)
  }

  sumRow(
    `合计（${model.totals.orderCount} 单 / ${model.totals.qty} 件）`,
    `¥${model.totals.totalLabel}`,
  )
  if (model.totals.paidCount > 0) {
    sumRow(
      `已付（${model.totals.paidCount} 单）`,
      `¥${model.totals.paidLabel}`,
      '#07c160',
    )
  }
  if (model.totals.unpaidCount > 0) {
    sumRow(
      `未付（${model.totals.unpaidCount} 单）`,
      `¥${model.totals.unpaidLabel}`,
      '#e53935',
    )
  }
  y += fs(4)
  ctx.font = `bold ${fs(18)}px sans-serif`
  ctx.fillStyle = '#333333'
  ctx.textAlign = 'left'
  ctx.fillText('应收款', pad, y + fs(14))
  ctx.fillStyle = '#e53935'
  ctx.textAlign = 'right'
  ctx.fillText(
    `¥${model.totals.receivableLabel || model.totals.unpaidLabel}`,
    W - pad,
    y + fs(14),
  )
  y += fs(32)

  if (model.showPayQr && (model.wechatQr || model.alipayQr)) {
    if (model.qrHint) {
      y = drawCenterWrapped(
        ctx,
        model.qrHint,
        W / 2,
        y + fs(8),
        innerW,
        fs(16),
        `${fs(13)}px sans-serif`,
        '#37474f',
      )
      y += fs(6)
    }
    const qrSize = RECEIPT_QR_CANVAS_SIZE
    const gap = 28
    const tiles: Array<{ img: any; label: string }> = []
    if (model.wechatQr) tiles.push({ img: opts?.wxImg || null, label: '微信支付' })
    if (model.alipayQr) tiles.push({ img: opts?.aliImg || null, label: '支付宝支付' })
    const totalW = tiles.length * qrSize + Math.max(0, tiles.length - 1) * gap
    let x = (W - totalW) / 2
    ctx.font = `${fs(12)}px sans-serif`
    ctx.fillStyle = '#37474f'
    ctx.textAlign = 'center'
    for (const tile of tiles) {
      if (tile.img) ctx.drawImage(tile.img, x, y, qrSize, qrSize)
      else {
        ctx.strokeStyle = forPrint ? '#333333' : '#bdbdbd'
        ctx.lineWidth = 1
        ctx.strokeRect(x, y, qrSize, qrSize)
      }
      ctx.fillText(tile.label, x + qrSize / 2, y + qrSize + fs(14))
      x += qrSize + gap
    }
    y += qrSize + fs(28)
  }

  if (model.footer) {
    y = drawCenterWrapped(
      ctx,
      model.footer,
      W / 2,
      y + fs(8),
      innerW,
      fs(16),
      `${fs(12)}px sans-serif`,
      '#37474f',
      true,
    )
    y += fs(8)
  }

  return Math.max(160, y + 40)
}
