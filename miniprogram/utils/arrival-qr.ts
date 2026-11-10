/** 按商家主页 URL 动态生成「最新款发布」二维码图（缓存到本地） */

type QrDraw = {
  addData: (text: string) => void
  make: () => void
  isDark: (row: number, col: number) => boolean
  getModuleCount: () => number
  createDataURL: (cellSize: number, margin: number) => string
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const qrcode = require('./qrcode-generator.js') as ((
  typeNumber: number,
  errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H',
) => QrDraw) & {
  stringToBytes?: (text: string) => number[]
  stringToBytesFuncs?: Record<string, (text: string) => number[]>
}

const QR_CACHE_DIR = `${wx.env.USER_DATA_PATH}/tuk_arrival_qr`

function fileExists(path: string): boolean {
  if (!path) return false
  try {
    const st = wx.getFileSystemManager().statSync(path) as { size?: number }
    return Number(st.size || 0) > 64
  } catch (_) {
    return false
  }
}

function ensureDir() {
  try {
    wx.getFileSystemManager().mkdirSync(QR_CACHE_DIR, true)
  } catch (_) {
    /* ignore */
  }
}

function cachePath(url: string): string {
  let h = 2166136261
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `${QR_CACHE_DIR}/qrp3_${(h >>> 0).toString(16)}.png`
}

function drawQr(text: string): QrDraw {
  if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']
  }
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr
}

/** 把已录入的码内容画成模块。空内容返回空数组，不另造一份码。 */
export function qrModuleGrid(text: string): boolean[][] {
  const payload = String(text || '').trim()
  if (!payload) return []
  const qr = drawQr(payload)
  const count = qr.getModuleCount()
  const grid: boolean[][] = []
  for (let row = 0; row < count; row++) {
    const line: boolean[] = []
    for (let col = 0; col < count; col++) line.push(!!qr.isDark(row, col))
    grid.push(line)
  }
  return grid
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let n = 0
  for (const part of parts) n += part.length
  const out = new Uint8Array(n)
  let o = 0
  for (const part of parts) {
    out.set(part, o)
    o += part.length
  }
  return out
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out[4] = type.charCodeAt(0)
  out[5] = type.charCodeAt(1)
  out[6] = type.charCodeAt(2)
  out[7] = type.charCodeAt(3)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** 不依赖画布。离屏画布有时吐出空白图或 GIF，首页左侧码就会是一块白。 */
function encodeMonoPng(grid: boolean[][], scale: number, margin: number): Uint8Array {
  const count = grid.length
  const size = count * scale + margin * 2
  const stride = size + 1
  const raw = new Uint8Array(stride * size)
  for (let y = 0; y < size; y++) {
    const row = y * stride
    raw[row] = 0
    const gy = y - margin
    for (let x = 0; x < size; x++) {
      const gx = x - margin
      const dark =
        gy >= 0 &&
        gx >= 0 &&
        gy < count * scale &&
        gx < count * scale &&
        !!grid[Math.floor(gy / scale)][Math.floor(gx / scale)]
      raw[row + 1 + x] = dark ? 0 : 255
    }
  }
  let a = 1
  let b = 0
  const stored: Uint8Array[] = [new Uint8Array([0x78, 0x01])]
  const block = 65535
  for (let i = 0; i < raw.length; i += block) {
    const end = Math.min(i + block, raw.length)
    const len = end - i
    const last = end === raw.length ? 1 : 0
    const hdr = new Uint8Array(5)
    hdr[0] = last
    hdr[1] = len & 255
    hdr[2] = (len >> 8) & 255
    const nlen = (~len) & 0xffff
    hdr[3] = nlen & 255
    hdr[4] = (nlen >> 8) & 255
    stored.push(hdr, raw.subarray(i, end))
    for (let j = i; j < end; j++) {
      a = (a + raw[j]) % 65521
      b = (b + a) % 65521
    }
  }
  const adler = ((b << 16) | a) >>> 0
  const tail = new Uint8Array(4)
  tail[0] = (adler >>> 24) & 255
  tail[1] = (adler >>> 16) & 255
  tail[2] = (adler >>> 8) & 255
  tail[3] = adler & 255
  stored.push(tail)
  const ihdr = new Uint8Array(13)
  const ih = new DataView(ihdr.buffer)
  ih.setUint32(0, size)
  ih.setUint32(4, size)
  ihdr[8] = 8
  ihdr[9] = 0
  const png = concatBytes([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', concatBytes(stored)),
    pngChunk('IEND', new Uint8Array(0)),
  ])
  return png
}

function bytesToBase64(bytes: Uint8Array): string {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return wx.arrayBufferToBase64(copy)
}

/** 按文本画出真正的 PNG 二维码（无 data: 前缀）。 */
export function renderQrPngBase64(text: string): string {
  const grid = qrModuleGrid(text)
  if (!grid.length) return ''
  try {
    return bytesToBase64(encodeMonoPng(grid, 4, 16))
  } catch (_) {
    return ''
  }
}

/** 同步写出已录入码内容的二维码图。空内容返回空路径。 */
export function ensureQrImageSync(text: string): string {
  const payload = String(text || '').trim()
  if (!payload) return ''
  ensureDir()
  const path = cachePath(payload)
  if (fileExists(path)) return path
  const base64 = renderQrPngBase64(payload)
  if (!base64) return ''
  try {
    wx.getFileSystemManager().writeFileSync(path, base64, 'base64')
    return path
  } catch (_) {
    return ''
  }
}

/** 生成或读取缓存的二维码 PNG 本地路径 */
export async function ensureArrivalQrImage(url: string): Promise<string> {
  const text = String(url || '').trim()
  if (!text) return ''
  ensureDir()
  const path = cachePath(text)
  if (fileExists(path)) return path

  const base64 = renderQrPngBase64(text)
  if (!base64) throw new Error('二维码生成失败')
  wx.getFileSystemManager().writeFileSync(path, base64, 'base64')
  return path
}
