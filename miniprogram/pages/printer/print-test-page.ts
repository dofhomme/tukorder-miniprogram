import { getPaperWidthMm, getSavedPrinter } from '../../services/bluetooth'
import { isLanPrinterId } from '../../services/lan-printer'
import {
  buildRasterEscPosFromRgba,
  countDarkRgba,
  EscPosBuilder,
} from '../../services/escpos'
import { shouldUseRasterPrint } from '../../services/print-settings'
import { dotsPerLine, normalizePaperWidthMm } from '../../services/thermal-paper'

const CSS_W = 360
const CSS_H = 220

function drawTestPage(
  ctx: CanvasRenderingContext2D,
  width: number,
  paperMm: number,
): void {
  const pad = 20
  let y = 36
  const center = (text: string, size: number, bold = false, color = '#111') => {
    ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.fillText(text, width / 2, y)
    y += size + 14
  }
  const left = (text: string, size = 14, color = '#333') => {
    ctx.font = `${size}px sans-serif`
    ctx.fillStyle = color
    ctx.textAlign = 'left'
    ctx.fillText(text, pad, y)
    y += size + 10
  }

  center('图可开单打印', 22, true, '#163a6b')
  center(isLanPrinterId(getSavedPrinter()?.deviceId) ? '网口打印测试' : '蓝牙打印测试', 16, true)
  y += 6
  ctx.strokeStyle = '#bdbdbd'
  ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(pad, y)
  ctx.lineTo(width - pad, y)
  ctx.stroke()
  ctx.setLineDash([])
  y += 18
  left(`纸宽: ${paperMm}mm`)
  left(new Date().toLocaleString())
  left('打印正常', 14, '#07c160')
}

export function buildTestPageTextBytes(): Uint8Array {
  const b = new EscPosBuilder(true)
  b.text('图可开单打印', { align: 1, bold: true, zoom: 2 })
  b.text(isLanPrinterId(getSavedPrinter()?.deviceId) ? '网口打印测试' : '蓝牙打印测试', { align: 1 })
  b.dash()
  b.text(`纸宽: ${getPaperWidthMm()}mm`)
  b.text(new Date().toLocaleString())
  b.finish(3)
  return b.build()
}

export function renderTestPageRasterBytes(
  page: WechatMiniprogram.Page.Instance<any, any>,
): Promise<Uint8Array> {
  const paperW = dotsPerLine(getPaperWidthMm())
  const paper = normalizePaperWidthMm(getPaperWidthMm())
  const W = CSS_W
  const H = CSS_H

  return new Promise((resolve, reject) => {
    wx.createSelectorQuery()
      .in(page)
      .select('#testCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvas = res?.[0]?.node as WechatMiniprogram.Canvas
        if (!canvas) {
          reject(new Error('画布未就绪'))
          return
        }
        try {
          const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
          const scale = paperW / W
          canvas.width = Math.round(W * scale)
          canvas.height = Math.round(H * scale)
          ctx.scale(scale, scale)
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, W, H)
          drawTestPage(ctx, W, paper)

          setTimeout(() => {
            try {
              ctx.setTransform(1, 0, 0, 1, 0, 0)
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
              const dark = countDarkRgba(img.data, 2)
              if (dark < 40) {
                reject(new Error('测试页是空白'))
                return
              }
              resolve(
                buildRasterEscPosFromRgba(img.data, img.width, img.height, paper),
              )
            } catch (e) {
              reject(e)
            }
          }, 30)
        } catch (e) {
          reject(e)
        }
      })
  })
}

export async function printTestPageBytes(
  page: WechatMiniprogram.Page.Instance<any, any>,
): Promise<Uint8Array> {
  if (shouldUseRasterPrint()) {
    try {
      return await renderTestPageRasterBytes(page)
    } catch (_) {
      /* 位图失败回退文本 */
    }
  }
  return buildTestPageTextBytes()
}
