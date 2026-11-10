/** 把预览像素打成一页 A4 PDF。激光机认 PDF，不认热敏指令。 */

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0
  for (let i = 0; i < parts.length; i++) n += parts[i].length
  const out = new Uint8Array(n)
  let o = 0
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i], o)
    o += parts[i].length
  }
  return out
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255
  return out
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < data.length; i++) {
    a += data[i]
    if (a >= 65521) a -= 65521
    b += a
    if (b >= 65521) b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

function zlibStore(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])]
  let off = 0
  if (!data.length) {
    parts.push(new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff]))
  }
  while (off < data.length) {
    const n = Math.min(65535, data.length - off)
    const last = off + n >= data.length
    const block = new Uint8Array(5 + n)
    block[0] = last ? 1 : 0
    block[1] = n & 255
    block[2] = (n >> 8) & 255
    block[3] = (~n) & 255
    block[4] = ((~n) >> 8) & 255
    block.set(data.subarray(off, off + n), 5)
    parts.push(block)
    off += n
  }
  const sum = adler32(data)
  parts.push(new Uint8Array([(sum >>> 24) & 255, (sum >>> 16) & 255, (sum >>> 8) & 255, sum & 255]))
  return concat(parts)
}

function fitRgb(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): { rgb: Uint8Array; w: number; h: number } {
  const maxW = 640
  const w = width > maxW ? maxW : width
  const h = width > maxW ? Math.max(1, Math.round((height * maxW) / width)) : height
  const rgb = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / h))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / w))
      const i = (sy * width + sx) * 4
      const o = (y * w + x) * 3
      const alpha = (rgba[i + 3] || 255) / 255
      rgb[o] = Math.round(rgba[i] * alpha + 255 * (1 - alpha))
      rgb[o + 1] = Math.round(rgba[i + 1] * alpha + 255 * (1 - alpha))
      rgb[o + 2] = Math.round(rgba[i + 2] * alpha + 255 * (1 - alpha))
    }
  }
  return { rgb, w, h }
}

export function pdfFromRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const fitted = fitRgb(rgba, width, height)
  const flate = zlibStore(fitted.rgb)
  const pageW = 595
  const pageH = 842
  const margin = 28
  let dw = pageW - margin * 2
  let dh = (dw * fitted.h) / fitted.w
  const maxH = pageH - margin * 2
  if (dh > maxH) {
    dh = maxH
    dw = (dh * fitted.w) / fitted.h
  }
  const x = (pageW - dw) / 2
  const y = (pageH - dh) / 2
  const content = ascii(
    `q\n${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im Do\nQ\n`,
  )
  const objects = [
    ascii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    ascii('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
    ascii(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /XObject << /Im 5 0 R >> >> >>\nendobj\n`,
    ),
    concat([
      ascii(`4 0 obj\n<< /Length ${content.length} >>\nstream\n`),
      content,
      ascii('\nendstream\nendobj\n'),
    ]),
    concat([
      ascii(
        `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${fitted.w} /Height ${fitted.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${flate.length} >>\nstream\n`,
      ),
      flate,
      ascii('\nendstream\nendobj\n'),
    ]),
  ]
  const header = ascii('%PDF-1.4\n')
  const offsets = [0]
  let cursor = header.length
  const parts: Uint8Array[] = [header]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(cursor)
    parts.push(objects[i])
    cursor += objects[i].length
  }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`
  parts.push(ascii(xref))
  return concat(parts)
}
