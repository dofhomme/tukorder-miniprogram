/** 把预览收成一页 A4 的 PCL5 光栅。激光机认这个页面语言，整份只有一次走纸。 */

const DPI = 300
const PAGE_W = Math.round((210 / 25.4) * DPI)
const PAGE_H = Math.round((297 / 25.4) * DPI)
const MARGIN = 72

function pushText(out: number[], text: string) {
  for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i) & 255)
}

function fitMono(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): { bits: Uint8Array; rowBytes: number; rows: number } {
  const maxW = PAGE_W - MARGIN * 2
  const maxH = PAGE_H - MARGIN * 2
  const scale = Math.min(maxW / width, maxH / height)
  const w = Math.max(8, Math.floor(width * scale))
  const h = Math.max(8, Math.floor(height * scale))
  const rowBytes = Math.ceil(w / 8)
  const bits = new Uint8Array(rowBytes * h)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale))
    const row = y * rowBytes
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(x / scale))
      const i = (sy * width + sx) * 4
      const alpha = (rgba[i + 3] || 0) / 255
      const r = (rgba[i] || 0) * alpha + 255 * (1 - alpha)
      const g = (rgba[i + 1] || 0) * alpha + 255 * (1 - alpha)
      const b = (rgba[i + 2] || 0) * alpha + 255 * (1 - alpha)
      const lum = r * 0.299 + g * 0.587 + b * 0.114
      if (lum < 170) bits[row + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return { bits, rowBytes, rows: h }
}

/** 一页 PCL。末尾只有一个走纸，光栅数据按长度传送，不会再被当成空白页。 */
export function pclFromRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const page = fitMono(rgba, width, height)
  const out: number[] = []
  pushText(out, '\x1b%-12345X@PJL JOB NAME="tukorder"\r\n@PJL ENTER LANGUAGE=PCL\r\n')
  pushText(out, '\x1bE')
  pushText(out, '\x1b&l26A')
  pushText(out, '\x1b&l0O')
  pushText(out, '\x1b&l0E')
  pushText(out, '\x1b&l1X')
  pushText(out, `\x1b*t${DPI}R`)
  pushText(out, `\x1b*p${MARGIN}x${MARGIN}Y`)
  pushText(out, '\x1b*r0F')
  pushText(out, '\x1b*r1A')
  pushText(out, '\x1b*b0M')
  for (let y = 0; y < page.rows; y++) {
    pushText(out, `\x1b*b${page.rowBytes}W`)
    const start = y * page.rowBytes
    for (let i = 0; i < page.rowBytes; i++) out.push(page.bits[start + i])
  }
  pushText(out, '\x1b*rB')
  out.push(0x0c)
  pushText(out, '\x1bE')
  pushText(out, '\x1b%-12345X@PJL EOJ\r\n\x1b%-12345X')
  return new Uint8Array(out)
}
