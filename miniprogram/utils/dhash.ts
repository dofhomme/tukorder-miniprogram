/** 封面 dHash：9×8 灰度邻域比较，输出 16 位 hex，与服务端 PIL 对齐。 */

export function normalizeDhash(raw?: string | null): string {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '')
  return s.length === 16 ? s : ''
}

function dhashFromPixels(data: Uint8ClampedArray, width: number): string {
  let bits = 0
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const i = (y * width + x) * 4
      const j = (y * width + x + 1) * 4
      const left = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      const right = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]
      bits = (bits << 1) | (left > right ? 1 : 0)
    }
  }
  return ('0000000000000000' + bits.toString(16)).slice(-16)
}

export function dhashOfImage(filePath: string): Promise<string> {
  const src = String(filePath || '').trim()
  if (!src) return Promise.resolve('')
  return new Promise((resolve) => {
    try {
      const canvas = (wx.createOffscreenCanvas as (opts: {
        type: string
        width: number
        height: number
      }) => any)({ type: '2d', width: 9, height: 8 })
      const img = canvas.createImage()
      img.onload = () => {
        try {
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, 9, 8)
          const pixels = ctx.getImageData(0, 0, 9, 8)
          resolve(dhashFromPixels(pixels.data, 9))
        } catch (_) {
          resolve('')
        }
      }
      img.onerror = () => resolve('')
      img.src = src
    } catch (_) {
      resolve('')
    }
  })
}
