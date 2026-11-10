import { getPaperWidthMm } from '../services/bluetooth'
import { buildRasterEscPosFromRgba, countDarkRgba } from '../services/escpos'
import { printFontCanvasScale } from '../services/print-settings'
import type { ReceiptRenderModel } from '../services/receipt-layout'
import { dotsPerLine, normalizePaperWidthMm } from '../services/thermal-paper'
import { drawReceiptCanvas } from './receipt-canvas'
import { fitMpCanvasScale, resizeMpCanvas } from './mp-canvas-fit'

export type ReceiptCanvasResult = {
  path: string
  rgba: Uint8ClampedArray | Uint8Array
  width: number
  height: number
  dark: number
}

export type RenderReceiptCanvasOpts = {
  skipImages?: boolean
  forPrint?: boolean
  canvasH?: number
  /** 默认 #expCanvas */
  canvasSelector?: string
  /** 转发配图：白底 5:4 顶裁，避免截到页面灰罩 */
  shareCover?: boolean
  /** 激光机要 JPEG 页面，不转热敏指令 */
  exportJpeg?: boolean
}

/** 微信转发卡片是 5:4。直接把整张长小票 dest 成 500×400 会被上下压扁。 */
const SHARE_COVER_W = 500
const SHARE_COVER_H = 400

export function canvasToShareCover(canvas: WechatMiniprogram.Canvas): Promise<string> {
  const srcW = Math.max(1, Number((canvas as { width?: number }).width || 1))
  const srcH = Math.max(1, Number((canvas as { height?: number }).height || 1))
  const cropH = Math.max(1, Math.min(srcH, Math.round((srcW * SHARE_COVER_H) / SHARE_COVER_W)))
  let off: WechatMiniprogram.Canvas | null = null
  try {
    off = wx.createOffscreenCanvas({
      type: '2d',
      width: SHARE_COVER_W,
      height: SHARE_COVER_H,
    }) as unknown as WechatMiniprogram.Canvas
  } catch (_) {
    off = null
  }
  if (off) {
    const ctx = off.getContext('2d') as CanvasRenderingContext2D | null
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, SHARE_COVER_W, SHARE_COVER_H)
      const drawH = Math.round((cropH * SHARE_COVER_W) / srcW)
      const dy = Math.max(0, Math.floor((SHARE_COVER_H - drawH) / 2))
      ctx.drawImage(
        canvas as unknown as CanvasImageSource,
        0,
        0,
        srcW,
        cropH,
        0,
        dy,
        SHARE_COVER_W,
        Math.min(SHARE_COVER_H, drawH),
      )
      return exportCanvasFile(off, SHARE_COVER_W, SHARE_COVER_H)
    }
  }
  return exportCanvasFile(canvas, srcW, cropH)
}

function exportCanvasFile(
  canvas: WechatMiniprogram.Canvas,
  width: number,
  height: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width,
      height,
      destWidth: width,
      destHeight: height,
      fileType: 'jpg',
      quality: 0.82,
      success: (r) => resolve(r.tempFilePath || ''),
      fail: (e) => reject(e),
    })
  })
}

const CSS_W = 360

type PageLike =
  | WechatMiniprogram.Page.Instance<any, any>
  | WechatMiniprogram.Component.Instance<any, any, any>

/** 屏幕预览字号倍率（与画布 printFontCanvasScale 一致） */
export function receiptFontScale(): number {
  return printFontCanvasScale()
}

/** 在页面/组件离屏 canvas 上绘制小票，供导出 PNG 或蓝牙位图打印 */
export function renderReceiptCanvas(
  page: PageLike,
  model: ReceiptRenderModel,
  opts?: RenderReceiptCanvasOpts,
): Promise<ReceiptCanvasResult> {
  const forPrint = !!opts?.forPrint
  const skipImages = !!opts?.skipImages && !forPrint
  const paperW = dotsPerLine(getPaperWidthMm())
  const W = CSS_W
  const selector = opts?.canvasSelector || '#expCanvas'
  const wantScale = forPrint ? paperW / W : wx.getSystemInfoSync().pixelRatio || 2

  return new Promise((resolve, reject) => {
    wx.createSelectorQuery()
      .in(page as any)
      .select(selector)
      .fields({ node: true, size: true })
      .exec(async (res) => {
        try {
          const canvas = res?.[0]?.node as any
          if (!canvas) {
            reject(new Error('画布未就绪'))
            return
          }
          const ctx = canvas.getContext('2d') as any
          let H = Math.max(160, opts?.canvasH || 600)
          let scale = fitMpCanvasScale(W, H, wantScale)
          resizeMpCanvas(canvas, ctx, W, H, scale)
          let needed = await drawReceiptCanvas(ctx, canvas, model, W, H, {
            forPrint,
            skipImages,
          })
          for (let i = 0; i < 3 && needed > H + 1; i++) {
            H = Math.ceil(needed + 16)
            scale = fitMpCanvasScale(W, H, wantScale)
            resizeMpCanvas(canvas, ctx, W, H, scale)
            needed = await drawReceiptCanvas(ctx, canvas, model, W, H, {
              forPrint,
              skipImages,
            })
          }
          // 预估画布常常比票面高，下载图会留一大截空白。只缩短多出来的部分。
          // 内容超出时上面已经加高重画，这里不再把高度压到实画以下，避免打印缺行。
          const tight = Math.ceil(Math.max(160, needed))
          if (tight + 1 < H) {
            H = tight
            scale = fitMpCanvasScale(W, H, wantScale)
            resizeMpCanvas(canvas, ctx, W, H, scale)
            needed = await drawReceiptCanvas(ctx, canvas, model, W, H, {
              forPrint,
              skipImages,
            })
            if (needed > H + 1) {
              H = Math.ceil(needed + 16)
              scale = fitMpCanvasScale(W, H, wantScale)
              resizeMpCanvas(canvas, ctx, W, H, scale)
              needed = await drawReceiptCanvas(ctx, canvas, model, W, H, {
                forPrint,
                skipImages,
              })
            }
          }
          const cropCssH = Math.min(needed, H)

          setTimeout(() => {
            try {
              ctx.setTransform(1, 0, 0, 1, 0, 0)
              const pw = canvas.width || 1
              const ph = Math.max(1, Math.min(canvas.height || 1, Math.round(cropCssH * scale)))
              const img = ctx.getImageData(0, 0, pw, ph)
              const dark = countDarkRgba(img.data, forPrint ? 2 : 1)
              const payload: ReceiptCanvasResult = {
                path: '',
                rgba: img.data,
                width: img.width,
                height: img.height,
                dark,
              }
              if (forPrint && !opts?.exportJpeg) {
                resolve(payload)
                return
              }
              if (forPrint && opts?.exportJpeg) {
                wx.canvasToTempFilePath({
                  canvas,
                  fileType: 'jpg',
                  quality: 0.9,
                  success: (r) => resolve({ ...payload, path: r.tempFilePath }),
                  fail: (e) => reject(new Error(e.errMsg || '导出图片失败')),
                })
                return
              }
              const finish = (path: string) => resolve({ ...payload, path })
              if (opts?.shareCover) {
                canvasToShareCover(canvas)
                  .then(finish)
                  .catch(() => {
                    wx.canvasToTempFilePath({
                      canvas,
                      success: (r) => finish(r.tempFilePath),
                      fail: reject,
                    })
                  })
                return
              }
              wx.canvasToTempFilePath({
                canvas,
                success: (r) => resolve({ ...payload, path: r.tempFilePath }),
                fail: reject,
              })
            } catch (e) {
              reject(e)
            }
          }, forPrint ? 30 : 80)
        } catch (e) {
          reject(e)
        }
      })
  })
}

/** 按预览生成 ESC/POS 位图打印数据 */
export async function buildRasterPrintBytes(
  page: PageLike,
  model: ReceiptRenderModel,
  canvasH: number,
  opts?: { canvasSelector?: string },
): Promise<Uint8Array> {
  const painted = await renderReceiptCanvas(page, model, {
    forPrint: true,
    canvasH,
    canvasSelector: opts?.canvasSelector,
  })
  if (painted.dark < 40) {
    throw new Error('预览图是空白，位图没有字')
  }
  const paper = normalizePaperWidthMm(getPaperWidthMm())
  return buildRasterEscPosFromRgba(painted.rgba, painted.width, painted.height, paper)
}
