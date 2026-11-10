/** 微信 2d canvas 单边像素上限，超了会裁图或 getImageData 失败 */
export const MP_CANVAS_MAX_PX = 4096

/** 按目标分辨率取 scale；账单很长时自动降 scale，保证整张画进上限 */
export function fitMpCanvasScale(cssW: number, cssH: number, want: number): number {
  const w = Math.max(1, cssW)
  const h = Math.max(1, cssH)
  let scale = Math.max(0.25, want)
  if (w * scale > MP_CANVAS_MAX_PX) scale = MP_CANVAS_MAX_PX / w
  if (h * scale > MP_CANVAS_MAX_PX) scale = Math.min(scale, MP_CANVAS_MAX_PX / h)
  return Math.max(0.25, scale)
}

export function resizeMpCanvas(
  canvas: { width: number; height: number },
  ctx: { setTransform: Function; scale: Function },
  cssW: number,
  cssH: number,
  scale: number,
) {
  canvas.width = Math.max(1, Math.round(cssW * scale))
  canvas.height = Math.max(1, Math.round(cssH * scale))
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(scale, scale)
}
