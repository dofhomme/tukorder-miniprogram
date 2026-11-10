/** 把预览像素打成一张 JPEG。激光机能画图片，画不了热敏指令。只发这一张。 */

const ZIG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55,
  62, 63,
]

const QY = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87,
  80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92,
  95, 98, 112, 100, 103, 99,
]

const QC = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99,
]

const DC_LUMA_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
const DC_CHROMA_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const AC_LUMA_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125]
const AC_CHROMA_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 119]
const AC_LUMA_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
  0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16,
  0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
  0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
  0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8,
  0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]
const AC_CHROMA_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81,
  0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34,
  0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44,
  0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92,
  0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
  0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6,
  0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]

type Huff = { code: number; len: number }

function buildHuff(counts: number[], vals: number[]): Huff[] {
  const table: Huff[] = []
  let code = 0
  let k = 0
  for (let len = 1; len <= 16; len++) {
    const n = counts[len - 1]
    for (let j = 0; j < n; j++) {
      table[vals[k]] = { code, len }
      code += 1
      k += 1
    }
    code <<= 1
  }
  return table
}

const HUFF_DC_Y = buildHuff(DC_LUMA_BITS, DC_VALS)
const HUFF_DC_C = buildHuff(DC_CHROMA_BITS, DC_VALS)
const HUFF_AC_Y = buildHuff(AC_LUMA_BITS, AC_LUMA_VALS)
const HUFF_AC_C = buildHuff(AC_CHROMA_BITS, AC_CHROMA_VALS)

function scaleQuant(src: number[]): number[] {
  const quality = 82
  const scale = quality < 50 ? Math.floor(5000 / quality) : 200 - quality * 2
  return src.map((v) => {
    const q = Math.floor((v * scale + 50) / 100)
    return Math.max(1, Math.min(255, q))
  })
}

const QY_S = scaleQuant(QY)
const QC_S = scaleQuant(QC)

class Bits {
  out: number[] = []
  acc = 0
  n = 0
  put(code: number, len: number) {
    this.acc = (this.acc << len) | (code & ((1 << len) - 1))
    this.n += len
    while (this.n >= 8) {
      this.n -= 8
      const b = (this.acc >> this.n) & 255
      this.out.push(b)
      if (b === 0xff) this.out.push(0)
    }
  }
  flush() {
    if (!this.n) return
    const pad = (1 << (8 - this.n)) - 1
    const b = ((this.acc << (8 - this.n)) | pad) & 255
    this.out.push(b)
    if (b === 0xff) this.out.push(0)
    this.n = 0
    this.acc = 0
  }
}

function catBits(value: number): { n: number; bits: number } {
  if (!value) return { n: 0, bits: 0 }
  const abs = Math.abs(value)
  let n = 0
  let probe = abs
  while (probe) {
    n += 1
    probe >>= 1
  }
  const bits = value > 0 ? value : value + (1 << n) - 1
  return { n, bits }
}

function dctNatural(src: Float64Array): Float64Array {
  const freq = new Float64Array(64)
  for (let v = 0; v < 8; v++) {
    const cv = v === 0 ? 0.7071067811865476 : 1
    for (let u = 0; u < 8; u++) {
      const cu = u === 0 ? 0.7071067811865476 : 1
      let sum = 0
      for (let y = 0; y < 8; y++) {
        const cy = Math.cos(((2 * y + 1) * v * Math.PI) / 16)
        for (let x = 0; x < 8; x++) {
          sum += src[y * 8 + x] * Math.cos(((2 * x + 1) * u * Math.PI) / 16) * cy
        }
      }
      freq[v * 8 + u] = 0.25 * cu * cv * sum
    }
  }
  return freq
}

function encodeBlock(bits: Bits, samples: Float64Array, quant: number[], dcHuff: Huff[], acHuff: Huff[], prevDc: number): number {
  const level = new Float64Array(64)
  for (let i = 0; i < 64; i++) level[i] = samples[i] - 128
  const freq = dctNatural(level)
  const zz = new Int16Array(64)
  for (let i = 0; i < 64; i++) zz[ZIG[i]] = Math.round(freq[i] / quant[i])
  const dc = zz[0]
  const diff = catBits(dc - prevDc)
  const dcCode = dcHuff[diff.n]
  bits.put(dcCode.code, dcCode.len)
  if (diff.n) bits.put(diff.bits, diff.n)
  let run = 0
  for (let i = 1; i < 64; i++) {
    const v = zz[i]
    if (!v) {
      run += 1
      continue
    }
    while (run > 15) {
      const zrl = acHuff[0xf0]
      bits.put(zrl.code, zrl.len)
      run -= 16
    }
    const ac = catBits(v)
    const symbol = (run << 4) | ac.n
    const code = acHuff[symbol]
    bits.put(code.code, code.len)
    bits.put(ac.bits, ac.n)
    run = 0
  }
  if (run) {
    const eob = acHuff[0]
    bits.put(eob.code, eob.len)
  }
  return dc
}

function marker(bytes: number[], markerByte: number, payload: number[]) {
  bytes.push(0xff, markerByte, (payload.length + 2) >> 8, (payload.length + 2) & 255)
  for (let i = 0; i < payload.length; i++) bytes.push(payload[i])
}

function dqt(id: number, table: number[]): number[] {
  const out = [id]
  for (let i = 0; i < 64; i++) out.push(table[ZIG[i]])
  return out
}

function dht(classId: number, counts: number[], vals: number[]): number[] {
  return [classId, ...counts, ...vals]
}

function fitRgb(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number) {
  const maxW = 480
  const w = width > maxW ? maxW : width
  const h = width > maxW ? Math.max(1, Math.round((height * maxW) / width)) : height
  const rgb = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / h))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / w))
      const i = (sy * width + sx) * 4
      const o = (y * w + x) * 3
      const alpha = (rgba[i + 3] ?? 255) / 255
      rgb[o] = Math.round(rgba[i] * alpha + 255 * (1 - alpha))
      rgb[o + 1] = Math.round(rgba[i + 1] * alpha + 255 * (1 - alpha))
      rgb[o + 2] = Math.round(rgba[i + 2] * alpha + 255 * (1 - alpha))
    }
  }
  return { rgb, w, h }
}

export function jpegFromRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const fitted = fitRgb(rgba, width, height)
  const w = fitted.w
  const h = fitted.h
  const bw = Math.ceil(w / 8) * 8
  const bh = Math.ceil(h / 8) * 8
  const yPlane = new Uint8Array(bw * bh)
  const cbPlane = new Uint8Array(bw * bh)
  const crPlane = new Uint8Array(bw * bh)
  yPlane.fill(255)
  cbPlane.fill(128)
  crPlane.fill(128)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const r = fitted.rgb[i]
      const g = fitted.rgb[i + 1]
      const b = fitted.rgb[i + 2]
      const o = y * bw + x
      yPlane[o] = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)))
      cbPlane[o] = Math.max(0, Math.min(255, Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b)))
      crPlane[o] = Math.max(0, Math.min(255, Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b)))
    }
  }
  const sample = (plane: Uint8Array, bx: number, by: number) => {
    const block = new Float64Array(64)
    const x0 = bx * 8
    const y0 = by * 8
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) block[y * 8 + x] = plane[(y0 + y) * bw + (x0 + x)]
    }
    return block
  }
  const bits = new Bits()
  let dcY = 0
  let dcCb = 0
  let dcCr = 0
  const blocksX = bw / 8
  const blocksY = bh / 8
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      dcY = encodeBlock(bits, sample(yPlane, bx, by), QY_S, HUFF_DC_Y, HUFF_AC_Y, dcY)
      dcCb = encodeBlock(bits, sample(cbPlane, bx, by), QC_S, HUFF_DC_C, HUFF_AC_C, dcCb)
      dcCr = encodeBlock(bits, sample(crPlane, bx, by), QC_S, HUFF_DC_C, HUFF_AC_C, dcCr)
    }
  }
  bits.flush()
  const head: number[] = [0xff, 0xd8]
  marker(head, 0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])
  marker(head, 0xdb, dqt(0, QY_S).concat(dqt(1, QC_S)))
  marker(head, 0xc0, [
    8,
    bh >> 8,
    bh & 255,
    bw >> 8,
    bw & 255,
    3,
    1,
    0x11,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ])
  marker(
    head,
    0xc4,
    dht(0x00, DC_LUMA_BITS, DC_VALS)
      .concat(dht(0x10, AC_LUMA_BITS, AC_LUMA_VALS))
      .concat(dht(0x01, DC_CHROMA_BITS, DC_VALS))
      .concat(dht(0x11, AC_CHROMA_BITS, AC_CHROMA_VALS)),
  )
  marker(head, 0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0])
  const out = new Uint8Array(head.length + bits.out.length + 2)
  out.set(head, 0)
  out.set(bits.out, head.length)
  out[out.length - 2] = 0xff
  out[out.length - 1] = 0xd9
  return out
}
